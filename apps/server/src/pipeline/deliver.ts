import { and, eq, isNull, or } from "@proof/db";
import { publicView, renderGithub, type RenderContext, type Report } from "@proof/core";
import { deliveries, destinations, prCards, secrets, type repos } from "@proof/db";
import type { Deps, Workspace } from "../deps.js";
import type { Octokit } from "../github/app.js";
import type { PullPayload } from "../github/context.js";
import type { DestinationConfig } from "../notify/channels.js";

interface DeliverInput {
  gh: Octokit;
  ws: Workspace;
  repo: typeof repos.$inferSelect;
  reportId: string;
  report: Report;
  pull: PullPayload;
}

/**
 * Send a report where the repo's settings say.
 * - The PR card holds only the public part, and is edited in place on every run.
 * - Private destinations get one message per commit, once nothing they'd care about is still running.
 */
export async function deliver(deps: Deps, input: DeliverInput): Promise<void> {
  const { db, log } = deps;
  const { gh, repo, report, pull } = input;
  const [owner, name] = repo.fullName.split("/") as [string, string];
  const ctx: RenderContext = {
    repo: repo.fullName,
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    author: pull.user.login,
    rulesUrl: deps.env.RULES_URL,
    dashboardUrl: `${deps.env.APP_URL}/w/${input.ws.login}/reports/${input.reportId}`,
  };

  const dests = await db
    .select()
    .from(destinations)
    .where(and(eq(destinations.workspaceId, input.ws.id), eq(destinations.enabled, true), or(isNull(destinations.repoId), eq(destinations.repoId, repo.id))));

  // PR card: on by default unless the workspace has turned off its GitHub destination.
  const githubDest = dests.find((d) => d.type === "github");
  const githubOff = await db
    .select({ id: destinations.id })
    .from(destinations)
    .where(and(eq(destinations.workspaceId, input.ws.id), eq(destinations.type, "github"), eq(destinations.enabled, false)))
    .limit(1);
  const pub = publicView(report);
  if (pub.items.length > 0 && (githubDest || githubOff.length === 0)) {
    try {
      await upsertCard(deps, gh, { owner, repo: name }, repo.id, pull.number, renderGithub(pub, ctx));
    } catch (err) {
      log.error("Could not post PR card", { repo: repo.fullName, pr: pull.number, err: String(err) });
    }
  }

  // Private destinations: wait until checks that would change the result have finished.
  // Questions are excluded because they depend on the author, who may never reply.
  const waiting = report.items.some((i) => i.status === "pending" && i.id !== "questions");
  if (waiting) return;

  for (const d of dests) {
    if (d.type === "github") continue;
    const already = await db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.reportId, input.reportId), eq(deliveries.destinationId, d.id), eq(deliveries.status, "sent")))
      .limit(1);
    if (already.length) continue;

    const view = d.audience === "public" ? pub : report;
    try {
      const secret = d.secretId ? await secretValue(deps, d.secretId) : undefined;
      const config = d.config as DestinationConfig & { url?: string };
      await deps.channels[d.type]({ report: view, ctx, config, secret, url: config.url });
      await db.insert(deliveries).values({ reportId: input.reportId, destinationId: d.id, status: "sent" });
    } catch (err) {
      await db.insert(deliveries).values({ reportId: input.reportId, destinationId: d.id, status: "failed", error: String(err).slice(0, 500) });
      log.warn("Delivery failed", { destination: d.type, repo: repo.fullName, err: String(err) });
    }
  }
}

async function secretValue(deps: Deps, id: string): Promise<string | undefined> {
  const [s] = await deps.db.select().from(secrets).where(eq(secrets.id, id)).limit(1);
  return s ? deps.vault.decrypt(s.cipher) : undefined;
}

/** Create PRoof's comment on the PR, or edit it if it already exists. */
async function upsertCard(deps: Deps, gh: Octokit, r: { owner: string; repo: string }, repoId: string, prNumber: number, body: string) {
  const [card] = await deps.db
    .select()
    .from(prCards)
    .where(and(eq(prCards.repoId, repoId), eq(prCards.prNumber, prNumber)))
    .limit(1);
  if (card) {
    try {
      await gh.rest.issues.updateComment({ ...r, comment_id: card.commentId, body });
      await deps.db.update(prCards).set({ updatedAt: new Date() }).where(and(eq(prCards.repoId, repoId), eq(prCards.prNumber, prNumber)));
      return;
    } catch (err) {
      // Comment was deleted by a maintainer: post a new one.
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }
  const created = await gh.rest.issues.createComment({ ...r, issue_number: prNumber, body });
  await deps.db
    .insert(prCards)
    .values({ repoId, prNumber, commentId: created.data.id })
    .onConflictDoUpdate({ target: [prCards.repoId, prCards.prNumber], set: { commentId: created.data.id, updatedAt: new Date() } });
}
