import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, eq, repos, secrets, workspaces } from "@proof/db";
import { clearAccessCache } from "../src/api/access.js";
import { safeReturnTo } from "../src/api/auth.js";
import { createApp } from "../src/app.js";
import { baseDeps, testDb } from "./helpers.js";

/** Two GitHub users: maya is an org admin of acme, rob is a plain member. Both can see installation 51. */
const PEOPLE: Record<string, { id: number; login: string; role: "admin" | "member"; installs: number[] }> = {
  "tok-maya": { id: 1, login: "maya", role: "admin", installs: [51] },
  "tok-rob": { id: 2, login: "rob", role: "member", installs: [51] },
  "tok-eve": { id: 3, login: "eve", role: "member", installs: [] },
};

function fakeUserGithub(token: string) {
  const p = PEOPLE[token]!;
  return {
    paginate: async () => p.installs.map((id) => ({ id })),
    rest: {
      apps: { listInstallationsForAuthenticatedUser: () => {} },
      users: { getAuthenticated: async () => ({ data: { id: p.id, login: p.login, name: p.login, avatar_url: "a" } }) },
      orgs: { getMembershipForAuthenticatedUser: async () => ({ data: { state: "active", role: p.role } }) },
      repos: { get: async () => ({ data: { permissions: { admin: false } } }) },
    },
  } as any;
}

describe("dashboard API", async () => {
  const { db, client } = await testDb();
  afterAll(() => client.end());
  let nextToken = "";
  const deps = baseDeps(db, {
    userGithub: fakeUserGithub,
    exchangeCode: async () => nextToken,
    getInstallation: async (id) => ({ id, account: { id: 900, login: "acme", type: "Organization" } }),
    github: async () => ({ paginate: async () => installRepos, rest: { apps: { listReposAccessibleToInstallation: () => {} } } }) as any,
  });
  /** Repos the fake installation can see. */
  let installRepos = [
    { id: 701, full_name: "acme/api", private: false },
    { id: 702, full_name: "acme/web", private: true },
  ];
  const app = createApp(deps, async () => true);
  beforeEach(() => clearAccessCache());

  async function signIn(token: string): Promise<string> {
    nextToken = token;
    const start = await app.request("/auth/github/login?return_to=/w/acme");
    const stateCookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const state = new URL(start.headers.get("location")!).searchParams.get("state");
    const cb = await app.request(`/auth/github/callback?code=c&state=${state}`, { headers: { cookie: stateCookie } });
    expect(cb.headers.get("location")).toBe("https://app.example/w/acme");
    return cb.headers.getSetCookie().find((c) => c.startsWith("proof_session="))!.split(";")[0]!;
  }
  const call = (cookie: string, path: string, init: RequestInit = {}) =>
    app.request(`/api${path}`, { ...init, headers: { cookie, "content-type": "application/json", "x-proof-client": "web", ...(init.headers ?? {}) } });

  it("only allows relative return paths", () => {
    expect(safeReturnTo("/w/acme")).toBe("/w/acme");
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("https://evil.com")).toBe("/");
  });

  it("never uses a code with the wrong state", async () => {
    let exchanged = false;
    const strict = createApp(baseDeps(db, { exchangeCode: async () => ((exchanged = true), "gho_x") }), async () => true);
    const res = await strict.request("/auth/github/callback?code=c&state=forged");
    expect(res.headers.get("location")).toMatch(/^https:\/\/app\.example\/signin\?error=/);
    expect(exchanged).toBe(false);
  });

  it("restarts sign-in once when GitHub returns from an install without state", async () => {
    const res = await app.request("/auth/github/callback?code=c&installation_id=51&setup_action=install");
    expect(res.headers.get("location")).toBe(`/auth/github/login?return_to=${encodeURIComponent("/github/setup?installation_id=51&setup_action=install")}`);
  });

  it("sends a spoofed installation id to the not-yours page", async () => {
    const eve = await signIn("tok-eve");
    const res = await app.request("/github/setup?installation_id=51&setup_action=install", { headers: { cookie: eve } });
    expect(res.headers.get("location")).toBe("https://app.example/setup/not-yours");
    expect(await db.select().from(workspaces)).toHaveLength(0);
  });

  it("creates the workspace for a real installation", async () => {
    const maya = await signIn("tok-maya");
    const res = await app.request("/github/setup?installation_id=51&setup_action=install", { headers: { cookie: maya } });
    expect(res.headers.get("location")).toBe("https://app.example/w/acme?welcome=1");
    expect(await db.select().from(workspaces)).toHaveLength(1);
    expect((await db.select().from(repos)).map((r) => r.fullName).sort()).toEqual(["acme/api", "acme/web"]);
  });

  it("syncs repos from GitHub without un-pausing paused ones", async () => {
    const maya = await signIn("tok-maya");
    await db.update(repos).set({ enabled: false }).where(eq(repos.githubRepoId, 701));
    installRepos = [
      { id: 701, full_name: "acme/api", private: false },
      { id: 703, full_name: "acme/cli", private: false },
    ];
    const res = await call(maya, "/workspaces/acme/repos/sync", { method: "POST" });
    expect(res.status).toBe(200);
    const rows = Object.fromEntries((await db.select().from(repos)).map((r) => [r.fullName, r.enabled]));
    expect(rows).toEqual({ "acme/api": false, "acme/web": false, "acme/cli": true });
  });

  it("lets org admins change settings and logs it, but not members", async () => {
    const rob = await signIn("tok-rob");
    const denied = await call(rob, "/workspaces/acme/settings", { method: "PUT", body: JSON.stringify({ checks: { ci: "live" } }) });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: string }).error).toBe("Only acme org owners can change this");

    const maya = await signIn("tok-maya");
    const bad = await call(maya, "/workspaces/acme/settings", { method: "PUT", body: JSON.stringify({ checks: { ci: "loud" } }) });
    expect(bad.status).toBe(400);
    const ok = await call(maya, "/workspaces/acme/settings", { method: "PUT", body: JSON.stringify({ checks: { ci: "live" } }) });
    expect(ok.status).toBe(200);
    const [entry] = await db.select().from(auditLog);
    expect(entry!.action).toBe("settings.update");
  });

  it("hides workspaces from people who can't see the installation", async () => {
    const eve = await signIn("tok-eve");
    expect((await call(eve, "/workspaces/acme")).status).toBe(404);
    expect(await (await call(eve, "/workspaces")).json()).toEqual({ workspaces: [] });
  });

  it("stores the AI key encrypted and never returns it", async () => {
    const maya = await signIn("tok-maya");
    const res = await call(maya, "/workspaces/acme/ai", {
      method: "PUT",
      body: JSON.stringify({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-api03-secretvalue9876" }),
    });
    expect(res.status).toBe(200);
    const [s] = await db.select().from(secrets).where(eq(secrets.kind, "ai"));
    expect(s!.cipher).not.toContain("secretvalue");
    expect(deps.vault.decrypt(s!.cipher)).toBe("sk-ant-api03-secretvalue9876");
    const body = await (await call(maya, "/workspaces/acme")).text();
    expect(body).not.toContain("secretvalue");
    expect(JSON.parse(body).workspace.ai.keyHint).toBe("••••9876");
  });

  it("validates destinations", async () => {
    const maya = await signIn("tok-maya");
    const bad = await call(maya, "/workspaces/acme/destinations", { method: "POST", body: JSON.stringify({ type: "discord", webhookUrl: "https://evil.example/hook" }) });
    expect(bad.status).toBe(400);
    const ok = await call(maya, "/workspaces/acme/destinations", { method: "POST", body: JSON.stringify({ type: "email", to: ["team@acme.dev"] }) });
    expect(ok.status).toBe(201);
  });

  it("requires the client header on writes", async () => {
    const maya = await signIn("tok-maya");
    const res = await app.request("/api/workspaces/acme/settings", { method: "PUT", headers: { cookie: maya }, body: "{}" });
    expect(res.status).toBe(403);
  });

  it("accepts feature requests", async () => {
    const rob = await signIn("tok-rob");
    const res = await call(rob, "/support/feature-requests", { method: "POST", body: JSON.stringify({ title: "GitLab support", body: "We mirror to GitLab and would love this there.", workspace: "acme" }) });
    expect(res.status).toBe(201);
  });
});

describe("sign-in without a GitHub App", () => {
  it("explains what to configure instead of redirecting", async () => {
    const { db, client } = await testDb();
    const deps = baseDeps(db);
    deps.env.GITHUB_CLIENT_ID = "";
    const res = await createApp(deps, async () => true).request("/auth/github/login");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("GITHUB_CLIENT_ID");
    await client.end();
  });
});
