import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq, gt, and, sessions, users } from "@proof/db";
import { randomToken, sha256 } from "../crypto.js";
import type { Deps } from "../deps.js";

export const SESSION_COOKIE = "proof_session";
const SESSION_DAYS = 14;

export interface SessionUser {
  id: string;
  login: string;
  githubUserId: number;
  name: string | null;
  avatarUrl: string | null;
  /** The user's GitHub token, decrypted, for role checks. Never sent to the browser. */
  githubToken: string;
  tokenHash: string;
}

export type AppEnv = { Variables: { user: SessionUser } };

export async function createSession(deps: Deps, c: Context, userId: string, githubToken: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await deps.db.insert(sessions).values({ tokenHash: sha256(token), userId, githubTokenCipher: deps.vault.encrypt(githubToken), expiresAt });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: deps.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(deps: Deps, c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deps.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function readSession(deps: Deps, c: Context): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = sha256(token);
  const [row] = await deps.db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return {
    id: row.u.id,
    login: row.u.login,
    githubUserId: row.u.githubUserId,
    name: row.u.name,
    avatarUrl: row.u.avatarUrl,
    githubToken: deps.vault.decrypt(row.s.githubTokenCipher),
    tokenHash,
  };
}

/** Require a signed-in user. */
export function requireUser(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await readSession(deps, c);
    if (!user) return c.json({ error: "Sign in to continue" }, 401);
    c.set("user", user);
    await next();
  };
}
