import { afterAll, describe, expect, it } from "vitest";
import { claims, eq, repos, workspaces } from "@proof/db";
import { handleClaimCommand } from "../src/jobs/claims.js";
import { webhookRoutes } from "../src/webhooks/http.js";
import { baseDeps, testDb } from "./helpers.js";

describe("webhooks", async () => {
  const { db, client } = await testDb();
  afterAll(() => client.end());
  const jobs: { name: string; data: any }[] = [];
  const comments: string[] = [];
  const deps = baseDeps(db, {
    enqueue: async (name, data) => void jobs.push({ name, data }),
    github: async () =>
      ({
        rest: {
          issues: {
            createComment: async (p: any) => void comments.push(p.body),
            addAssignees: async () => ({}),
            removeAssignees: async () => ({}),
          },
        },
      }) as any,
  });
  const app = webhookRoutes(deps, async (_b, sig) => sig === "sha256=good");
  const send = (event: string, delivery: string, payload: unknown, sig = "sha256=good") =>
    app.request("/github", {
      method: "POST",
      headers: { "x-hub-signature-256": sig, "x-github-event": event, "x-github-delivery": delivery, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  const account = { id: 4242, login: "acme", type: "Organization" };
  const repo = { id: 7001, full_name: "acme/app", private: false };

  it("rejects bad signatures", async () => {
    expect((await send("ping", "d0", {}, "sha256=bad")).status).toBe(401);
  });

  it("creates one workspace per account from the installation event", async () => {
    const res = await send("installation", "d1", { action: "created", installation: { id: 31, account }, repositories: [repo] });
    expect(res.status).toBe(202);
    // A reinstall with a new installation id updates the same workspace.
    await send("installation", "d2", { action: "created", installation: { id: 32, account }, repositories: [] });
    const rows = await db.select().from(workspaces).where(eq(workspaces.githubAccountId, 4242));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.installationId).toBe(32);
    expect(await db.select().from(repos).where(eq(repos.githubRepoId, 7001))).toHaveLength(1);
  });

  it("drops duplicate deliveries", async () => {
    const pr = { number: 5, user: { login: "dana" } };
    await send("pull_request", "d3", { action: "opened", installation: { id: 32 }, repository: repo, pull_request: pr });
    const dup = await send("pull_request", "d3", { action: "opened", installation: { id: 32 }, repository: repo, pull_request: pr });
    expect(await dup.json()).toMatchObject({ duplicate: true });
    expect(jobs.filter((j) => j.name === "pr.analyze")).toHaveLength(1);
  });

  it("routes claims only for issues, and @proof only from maintainers", async () => {
    const base = { action: "created", installation: { id: 32 }, repository: repo };
    await send("issue_comment", "d4", { ...base, issue: { number: 9, state: "open" }, comment: { id: 1, body: "/claim", user: { login: "dana" }, author_association: "NONE" } });
    await send("issue_comment", "d5", { ...base, issue: { number: 5, state: "open", pull_request: {} }, comment: { id: 2, body: "@proof what changed?", user: { login: "rando" }, author_association: "NONE" } });
    await send("issue_comment", "d6", { ...base, issue: { number: 5, state: "open", pull_request: {} }, comment: { id: 3, body: "@proof what changed?", user: { login: "maya" }, author_association: "MEMBER" } });
    expect(jobs.map((j) => j.name)).toEqual(["pr.analyze", "claim.command", "pr.ask"]);
  });

  it("marks the workspace uninstalled", async () => {
    await send("installation", "d7", { action: "deleted", installation: { id: 32, account } });
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.githubAccountId, 4242));
    expect(ws!.status).toBe("uninstalled");
    await send("installation", "d8", { action: "unsuspend", installation: { id: 32, account } });
  });

  it("handles a claim command end to end", async () => {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.githubAccountId, 4242));
    await db.update(workspaces).set({ status: "active", settings: { checks: { claims: "live" } } }).where(eq(workspaces.id, ws!.id));
    const job = { installationId: 32, repo: { id: 7001, fullName: "acme/app", private: false }, issue: 9, issueOpen: true, actor: "dana", actorIsMaintainer: false, command: "claim" as const };
    await handleClaimCommand(deps, job);
    await handleClaimCommand(deps, { ...job, actor: "sam" });
    const active = await db.select().from(claims).where(eq(claims.status, "active"));
    expect(active.map((c) => c.login)).toEqual(["dana"]);
    expect(comments[0]).toContain("this issue is yours");
    expect(comments[1]).toContain("already claimed by @dana");
  });
});
