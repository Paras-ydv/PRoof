import type { Deps, Workspace } from "../deps.js";
import type { SessionUser } from "./session.js";

/**
 * Who may do what is always decided by GitHub, never by PRoof's own tables:
 * - view a workspace: the user can see the app installation on GitHub
 * - change org settings: org admin (or the account owner, for personal accounts)
 * - change a repo's overrides: admin on that repo
 * Answers are cached for a few minutes so a removed admin loses access quickly.
 */
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: boolean | number[]; at: number }>();

async function cached<T extends boolean | number[]>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { value, at: Date.now() });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return value;
}

export function clearAccessCache() {
  cache.clear();
}

/** Installation ids this user can see on GitHub. `fresh` skips the cache, e.g. right after an install. */
export function visibleInstallations(deps: Deps, user: SessionUser, opts: { fresh?: boolean } = {}): Promise<number[]> {
  if (opts.fresh) cache.delete(`inst:${user.tokenHash}`);
  return cached(`inst:${user.tokenHash}`, async () => {
    const gh = deps.userGithub(user.githubToken);
    const all = await gh.paginate(gh.rest.apps.listInstallationsForAuthenticatedUser, { per_page: 100 });
    return all.map((i) => i.id);
  });
}

export async function canView(deps: Deps, user: SessionUser, ws: Workspace): Promise<boolean> {
  return (await visibleInstallations(deps, user)).includes(ws.installationId);
}

export function canAdminWorkspace(deps: Deps, user: SessionUser, ws: Workspace): Promise<boolean> {
  if (ws.accountType === "User") return Promise.resolve(ws.githubAccountId === user.githubUserId);
  return cached(`org:${user.tokenHash}:${ws.githubAccountId}`, async () => {
    try {
      const gh = deps.userGithub(user.githubToken);
      const { data } = await gh.rest.orgs.getMembershipForAuthenticatedUser({ org: ws.login });
      return data.state === "active" && data.role === "admin";
    } catch {
      return false;
    }
  });
}

export async function canAdminRepo(deps: Deps, user: SessionUser, ws: Workspace, fullName: string): Promise<boolean> {
  if (await canAdminWorkspace(deps, user, ws)) return true;
  return cached(`repo:${user.tokenHash}:${fullName}`, async () => {
    try {
      const [owner, repo] = fullName.split("/") as [string, string];
      const { data } = await deps.userGithub(user.githubToken).rest.repos.get({ owner, repo });
      return Boolean(data.permissions?.admin);
    } catch {
      return false;
    }
  });
}
