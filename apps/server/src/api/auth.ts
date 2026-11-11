import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { users, workspaces, eq } from "@proof/db";
import { randomToken } from "../crypto.js";
import type { Deps } from "../deps.js";
import { visibleInstallations } from "./access.js";
import { createSession, endSession, readSession } from "./session.js";

const STATE_COOKIE = "proof_oauth_state";

/** Only same-site relative paths, so the login flow can't redirect somewhere else. */
export function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

export function authRoutes(deps: Deps) {
  const app = new Hono();
  const secure = deps.env.NODE_ENV === "production";

  /** Start GitHub sign-in. */
  app.get("/github/login", (c) => {
    if (!deps.env.GITHUB_CLIENT_ID || !deps.env.GITHUB_CLIENT_SECRET) {
      return c.text(
        "Sign-in isn't set up on this server yet. Create a GitHub App (see github-app.yml), then set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env and restart the server.",
        503,
      );
    }
    const state = randomToken(16);
    const returnTo = safeReturnTo(c.req.query("return_to"));
    setCookie(c, STATE_COOKIE, `${state}|${returnTo}`, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: 600 });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", deps.env.GITHUB_CLIENT_ID);
    url.searchParams.set("redirect_uri", `${deps.env.API_URL}/auth/github/callback`);
    url.searchParams.set("state", state);
    // Let people signed into several GitHub accounts choose which one to use.
    url.searchParams.set("prompt", "select_account");
    return c.redirect(url.toString());
  });

  /** GitHub sends the user back here with a one-time code. */
  app.get("/github/callback", async (c) => {
    const [expected, returnTo] = (getCookie(c, STATE_COOKIE) ?? "").split("|");
    deleteCookie(c, STATE_COOKIE, { path: "/" });
    if (c.req.query("error")) {
      return c.redirect(`${deps.env.APP_URL}/signin?error=${encodeURIComponent(c.req.query("error_description") ?? "GitHub sign-in was cancelled.")}`);
    }

    const code = c.req.query("code");
    if (!code || !expected || c.req.query("state") !== expected) {
      // Without our state the code can't be trusted (login CSRF), so it is never used.
      // Right after an install GitHub can send people here with no state: restart sign-in once and
      // continue the setup. The retry has no installation_id, so it can't loop.
      const inst = c.req.query("installation_id");
      if (inst) {
        const back = `/github/setup?${new URLSearchParams({ installation_id: inst, setup_action: c.req.query("setup_action") ?? "install" })}`;
        return c.redirect(`/auth/github/login?return_to=${encodeURIComponent(back)}`);
      }
      // Otherwise the 10-minute window passed or the page was reloaded.
      return c.redirect(`${deps.env.APP_URL}/signin?error=${encodeURIComponent("That sign-in link expired. Sign in again to continue.")}`);
    }

    let token: string;
    let gu: { id: number; login: string; name: string | null; avatar_url: string };
    try {
      token = await deps.exchangeCode(code);
      gu = (await deps.userGithub(token).rest.users.getAuthenticated()).data;
    } catch (err) {
      deps.log.error("GitHub sign-in failed", { err: String(err) });
      const reason = "GitHub didn't accept the sign-in. Check GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env, then try again.";
      return c.redirect(`${deps.env.APP_URL}/signin?error=${encodeURIComponent(reason)}`);
    }
    const [user] = await deps.db
      .insert(users)
      .values({ githubUserId: gu.id, login: gu.login, name: gu.name, avatarUrl: gu.avatar_url, lastLoginAt: new Date() })
      .onConflictDoUpdate({ target: users.githubUserId, set: { login: gu.login, name: gu.name, avatarUrl: gu.avatar_url, lastLoginAt: new Date() } })
      .returning();
    await createSession(deps, c, user!.id, token);
    return c.redirect(`${deps.env.APP_URL}${safeReturnTo(returnTo)}`);
  });

  app.post("/logout", async (c) => {
    await endSession(deps, c);
    return c.json({ ok: true });
  });

  return app;
}

/**
 * GitHub's "Setup URL": where people land after installing the app.
 * GitHub's docs warn that installation_id can be spoofed, so it is only trusted
 * after confirming, with the user's own token, that they can see that installation.
 */
export function setupRoutes(deps: Deps) {
  const app = new Hono();

  app.get("/setup", async (c) => {
    const action = c.req.query("setup_action");
    const user = await readSession(deps, c);
    if (!user) {
      const back = `/github/setup?${new URLSearchParams(c.req.queries() as never).toString()}`;
      return c.redirect(`/auth/github/login?return_to=${encodeURIComponent(back)}`);
    }
    if (action === "request") return c.redirect(`${deps.env.APP_URL}/setup/requested`);

    const id = Number(c.req.query("installation_id"));
    if (!Number.isInteger(id) || id <= 0) return c.redirect(`${deps.env.APP_URL}/`);
    // Fresh lookup: a list cached before the install wouldn't include it yet.
    const visible = await visibleInstallations(deps, user, { fresh: true });
    if (!visible.includes(id)) return c.redirect(`${deps.env.APP_URL}/setup/not-yours`);

    // The installation webhook normally creates the workspace; if it hasn't arrived yet, read it from GitHub.
    let [ws] = await deps.db.select().from(workspaces).where(eq(workspaces.installationId, id)).limit(1);
    if (!ws) {
      const inst = await deps.getInstallation(id);
      if (!inst) return c.redirect(`${deps.env.APP_URL}/`);
      [ws] = await deps.db
        .insert(workspaces)
        .values({
          githubAccountId: inst.account.id,
          login: inst.account.login,
          accountType: inst.account.type === "User" ? "User" : "Organization",
          installationId: inst.id,
        })
        .onConflictDoUpdate({ target: workspaces.githubAccountId, set: { installationId: inst.id, status: "active", updatedAt: new Date() } })
        .returning();
    }
    return c.redirect(`${deps.env.APP_URL}/w/${ws!.login}?welcome=1`);
  });

  return app;
}
