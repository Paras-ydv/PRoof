import { parseCommand } from "@proof/core";
import { and, claims, eq, repos, workspaces } from "@proof/db";
import type { Deps } from "../deps.js";
import type { PullPayload } from "../github/context.js";

/* Only the payload fields PRoof reads. GitHub sends much more. */
interface Account {
  id: number;
  login: string;
  type: string;
}
interface RepoLite {
  id: number;
  full_name: string;
  private: boolean;
}
interface Payload {
  action?: string;
  installation?: { id: number; account?: Account };
  repository?: RepoLite;
  repositories?: RepoLite[];
  repositories_added?: RepoLite[];
  repositories_removed?: RepoLite[];
  pull_request?: PullPayload;
  issue?: { number: number; state: string; pull_request?: unknown };
  comment?: { id: number; body: string; user: { login: string; type?: string }; author_association: string; in_reply_to_id?: number };
  check_suite?: { pull_requests: { number: number }[] };
  account?: Account;
  changes?: { login?: { from: string } };
}

const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review", "edited", "labeled", "unlabeled"]);

const repoRef = (r: RepoLite) => ({ id: r.id, fullName: r.full_name, private: r.private });

/**
 * Turn one verified GitHub webhook into queue jobs or small DB updates.
 * Slow work never happens here: GitHub expects a reply within 10 seconds.
 */
export async function routeEvent(deps: Deps, event: string, p: Payload): Promise<void> {
  const installationId = p.installation?.id;

  switch (event) {
    case "installation":
      return onInstallation(deps, p);

    case "installation_repositories": {
      if (!installationId) return;
      const [ws] = await deps.db.select().from(workspaces).where(eq(workspaces.installationId, installationId)).limit(1);
      if (!ws) return;
      for (const r of p.repositories_added ?? []) {
        await deps.db
          .insert(repos)
          .values({ workspaceId: ws.id, githubRepoId: r.id, fullName: r.full_name, private: r.private })
          .onConflictDoUpdate({ target: repos.githubRepoId, set: { enabled: true, fullName: r.full_name, workspaceId: ws.id } });
      }
      for (const r of p.repositories_removed ?? []) {
        await deps.db.update(repos).set({ enabled: false }).where(eq(repos.githubRepoId, r.id));
      }
      return;
    }

    case "installation_target":
      // The org or user account was renamed. The numeric id is unchanged, so only the login updates.
      if (p.action === "renamed" && p.account) {
        await deps.db.update(workspaces).set({ login: p.account.login, updatedAt: new Date() }).where(eq(workspaces.githubAccountId, p.account.id));
      }
      return;

    case "pull_request": {
      if (!installationId || !p.repository || !p.pull_request || !PR_ACTIONS.has(p.action ?? "")) return;
      await deps.enqueue(
        "pr.analyze",
        { installationId, repo: repoRef(p.repository), number: p.pull_request.number, pull: p.pull_request },
        { singletonKey: `${p.repository.id}:${p.pull_request.number}` },
      );
      return;
    }

    case "check_suite": {
      if (p.action !== "completed" || !installationId || !p.repository) return;
      for (const pr of p.check_suite?.pull_requests ?? []) {
        await deps.enqueue("pr.analyze", { installationId, repo: repoRef(p.repository), number: pr.number }, { singletonKey: `${p.repository.id}:${pr.number}` });
      }
      return;
    }

    case "pull_request_review_comment": {
      const c = p.comment;
      if (p.action !== "created" || !installationId || !p.repository || !p.pull_request || !c?.in_reply_to_id) return;
      if (c.user.type === "Bot") return;
      await deps.enqueue("pr.answer", {
        installationId,
        repo: repoRef(p.repository),
        number: p.pull_request.number,
        prAuthor: p.pull_request.user.login,
        commenter: c.user.login,
        inReplyTo: c.in_reply_to_id,
        body: c.body,
      });
      return;
    }

    case "issue_comment": {
      const c = p.comment;
      if (p.action !== "created" || !installationId || !p.repository || !p.issue || !c || c.user.type === "Bot") return;
      const cmd = parseCommand(c.body);
      const isPr = Boolean(p.issue.pull_request);

      if (cmd?.type === "ask" && isPr && MAINTAINER.has(c.author_association)) {
        await deps.enqueue("pr.ask", { installationId, repo: repoRef(p.repository), number: p.issue.number, question: cmd.question, asker: c.user.login });
        return;
      }
      if ((cmd?.type === "claim" || cmd?.type === "unclaim") && !isPr) {
        await deps.enqueue("claim.command", {
          installationId,
          repo: repoRef(p.repository),
          issue: p.issue.number,
          issueOpen: p.issue.state === "open",
          actor: c.user.login,
          actorIsMaintainer: MAINTAINER.has(c.author_association),
          command: cmd.type,
        });
        return;
      }
      // Any comment by the claimer counts as activity and keeps the claim alive.
      if (!isPr) await touchClaim(deps, p.repository.id, p.issue.number, c.user.login);
      return;
    }

    case "issues": {
      if (!p.repository || !p.issue) return;
      if (p.action === "closed") {
        const [repo] = await deps.db.select().from(repos).where(eq(repos.githubRepoId, p.repository.id)).limit(1);
        if (repo) {
          await deps.db
            .update(claims)
            .set({ status: "done", endedAt: new Date() })
            .where(and(eq(claims.repoId, repo.id), eq(claims.issueNumber, p.issue.number), eq(claims.status, "active")));
        }
      }
      return;
    }
  }
}

async function onInstallation(deps: Deps, p: Payload) {
  const inst = p.installation;
  const account = inst?.account;
  if (!inst || !account) return;
  const status = { created: "active", unsuspend: "active", new_permissions_accepted: "active", deleted: "uninstalled", suspend: "suspended" }[p.action ?? ""] as
    | "active"
    | "uninstalled"
    | "suspended"
    | undefined;
  if (!status) return;

  // GitHub only sends this event for a real install by someone allowed to install,
  // so this is where a workspace is created. Keyed on the account id: one per org, ever.
  const [ws] = await deps.db
    .insert(workspaces)
    .values({
      githubAccountId: account.id,
      login: account.login,
      accountType: account.type === "User" ? "User" : "Organization",
      installationId: inst.id,
      status,
    })
    .onConflictDoUpdate({ target: workspaces.githubAccountId, set: { installationId: inst.id, login: account.login, status, updatedAt: new Date() } })
    .returning();

  if (p.action === "created") {
    for (const r of p.repositories ?? []) {
      await deps.db
        .insert(repos)
        .values({ workspaceId: ws!.id, githubRepoId: r.id, fullName: r.full_name, private: r.private })
        .onConflictDoUpdate({ target: repos.githubRepoId, set: { enabled: true, workspaceId: ws!.id } });
    }
  }
  deps.log.info("Installation event", { action: p.action, account: account.login });
}

async function touchClaim(deps: Deps, githubRepoId: number, issue: number, login: string) {
  const [repo] = await deps.db.select().from(repos).where(eq(repos.githubRepoId, githubRepoId)).limit(1);
  if (!repo) return;
  await deps.db
    .update(claims)
    .set({ lastActivityAt: new Date() })
    .where(and(eq(claims.repoId, repo.id), eq(claims.issueNumber, issue), eq(claims.login, login), eq(claims.status, "active")));
}
