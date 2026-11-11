import { claimMessage, decide, sweep, type Claim } from "@proof/core";
import { and, claims, eq, repos, workspaces } from "@proof/db";
import type { Deps } from "../deps.js";
import { effectiveSettings, ensureRepo } from "../pipeline/analyze.js";

export interface ClaimCommandJob {
  installationId: number;
  repo: { id: number; fullName: string; private: boolean };
  issue: number;
  issueOpen: boolean;
  actor: string;
  actorIsMaintainer: boolean;
  command: "claim" | "unclaim";
}

export async function handleClaimCommand(deps: Deps, job: ClaimCommandJob): Promise<void> {
  const { db } = deps;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.installationId, job.installationId)).limit(1);
  if (!ws || ws.status !== "active") return;
  const repo = await ensureRepo(deps, ws, job.repo);
  const settings = effectiveSettings(ws, repo.settings, () => {});
  if (settings.checks.claims === "off" || !repo.enabled) return;

  const [active] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.repoId, repo.id), eq(claims.issueNumber, job.issue), eq(claims.status, "active")))
    .limit(1);
  const current: Claim | null = active
    ? { issue: active.issueNumber, login: active.login, claimedAt: active.claimedAt.toISOString(), lastActivityAt: active.lastActivityAt.toISOString() }
    : null;

  const decision = decide({ type: job.command }, { actor: job.actor, active: current, issueOpen: job.issueOpen, actorIsMaintainer: job.actorIsMaintainer });
  const [owner, name] = repo.fullName.split("/") as [string, string];
  const gh = await deps.github(job.installationId);

  if (decision.type === "claimed") {
    try {
      await db.insert(claims).values({ repoId: repo.id, issueNumber: job.issue, login: job.actor });
    } catch {
      // Someone else claimed it a moment earlier; the unique index decides.
      return;
    }
    if (settings.claims.assignOnClaim) {
      await gh.rest.issues.addAssignees({ owner, repo: name, issue_number: job.issue, assignees: [job.actor] }).catch(() => {});
    }
  }
  if (decision.type === "unclaimed" && active) {
    await db.update(claims).set({ status: "unclaimed", endedAt: new Date() }).where(eq(claims.id, active.id));
    if (settings.claims.assignOnClaim) {
      await gh.rest.issues.removeAssignees({ owner, repo: name, issue_number: job.issue, assignees: [active.login] }).catch(() => {});
    }
  }

  const message = claimMessage(decision, { login: job.actor, settings });
  if (message) await gh.rest.issues.createComment({ owner, repo: name, issue_number: job.issue, body: message });
}

/** Scheduled: remind quiet claimers, release claims that have gone silent. */
export async function sweepClaims(deps: Deps): Promise<void> {
  const { db } = deps;
  const rows = await db
    .select({ claim: claims, repo: repos, ws: workspaces })
    .from(claims)
    .innerJoin(repos, eq(claims.repoId, repos.id))
    .innerJoin(workspaces, eq(repos.workspaceId, workspaces.id))
    .where(and(eq(claims.status, "active"), eq(workspaces.status, "active")));

  const now = new Date().toISOString();
  for (const { claim, repo, ws } of rows) {
    const settings = effectiveSettings(ws, repo.settings, () => {});
    if (settings.checks.claims === "off") continue;
    const c: Claim = {
      issue: claim.issueNumber,
      login: claim.login,
      claimedAt: claim.claimedAt.toISOString(),
      lastActivityAt: claim.lastActivityAt.toISOString(),
      remindedAt: claim.remindedAt?.toISOString(),
    };
    const [action] = sweep([c], settings, now);
    if (!action) continue;

    const [owner, name] = repo.fullName.split("/") as [string, string];
    try {
      const gh = await deps.github(ws.installationId);
      if (action.action === "release") {
        await db.update(claims).set({ status: "released", endedAt: new Date() }).where(eq(claims.id, claim.id));
        if (settings.claims.assignOnClaim) {
          await gh.rest.issues.removeAssignees({ owner, repo: name, issue_number: claim.issueNumber, assignees: [claim.login] }).catch(() => {});
        }
      } else {
        await db.update(claims).set({ remindedAt: new Date() }).where(eq(claims.id, claim.id));
      }
      const body = claimMessage({ type: action.action }, { login: claim.login, settings });
      if (body) await gh.rest.issues.createComment({ owner, repo: name, issue_number: claim.issueNumber, body });
    } catch (err) {
      deps.log.warn("Claim sweep failed for one claim", { repo: repo.fullName, issue: claim.issueNumber, err: String(err) });
    }
  }
}
