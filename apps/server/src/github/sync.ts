import { and, eq, notInArray, repos } from "@proof/db";
import type { Deps, Workspace } from "../deps.js";

/**
 * Make the repo list match what the installation can see on GitHub.
 * Webhooks normally keep it current; this covers installs that happened while
 * PRoof wasn't receiving them. Repos no longer included are paused, never deleted,
 * so their settings survive being re-added. Repos someone paused stay paused.
 */
export async function syncRepos(deps: Deps, ws: Pick<Workspace, "id" | "installationId">): Promise<number> {
  const gh = await deps.github(ws.installationId);
  const all = await gh.paginate(gh.rest.apps.listReposAccessibleToInstallation, { per_page: 100 });
  for (const r of all) {
    await deps.db
      .insert(repos)
      .values({ workspaceId: ws.id, githubRepoId: r.id, fullName: r.full_name, private: r.private })
      .onConflictDoUpdate({ target: repos.githubRepoId, set: { fullName: r.full_name, private: r.private, workspaceId: ws.id } });
  }
  const ids = all.map((r) => r.id);
  await deps.db
    .update(repos)
    .set({ enabled: false })
    .where(ids.length ? and(eq(repos.workspaceId, ws.id), notInArray(repos.githubRepoId, ids)) : eq(repos.workspaceId, ws.id));
  return all.length;
}
