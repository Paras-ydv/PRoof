import { askPrompt, hunkAround, reviewPrompt, type PrContext } from "@proof/core";
import { and, eq, questions, repos, workspaces } from "@proof/db";
import { AiUnavailableError } from "../ai/gateway.js";
import type { Deps } from "../deps.js";
import { fetchChangedFiles, toAssociation, type PullPayload } from "../github/context.js";
import { effectiveSettings } from "../pipeline/analyze.js";

export interface AnswerJob {
  installationId: number;
  repo: { id: number; fullName: string; private: boolean };
  number: number;
  prAuthor: string;
  commenter: string;
  inReplyTo: number;
  body: string;
}

/** The PR author replied to one of PRoof's questions. Store it, review it if enabled, then re-score. */
export async function handleAnswer(deps: Deps, job: AnswerJob): Promise<void> {
  if (job.commenter.toLowerCase() !== job.prAuthor.toLowerCase()) return;
  const { db } = deps;
  const [row] = await db
    .select({ q: questions, repo: repos, ws: workspaces })
    .from(questions)
    .innerJoin(repos, eq(questions.repoId, repos.id))
    .innerJoin(workspaces, eq(repos.workspaceId, workspaces.id))
    .where(and(eq(questions.githubCommentId, job.inReplyTo), eq(repos.githubRepoId, job.repo.id)))
    .limit(1);
  if (!row) return;

  // A later reply replaces the earlier one: the author may clarify.
  await db.update(questions).set({ answer: job.body.slice(0, 4000), answeredAt: new Date(), review: null }).where(eq(questions.id, row.q.id));

  const settings = effectiveSettings(row.ws, row.repo.settings, () => {});
  if (settings.questions.mode === "askAndReview") {
    const ai = await deps.gateway(row.ws);
    if (ai) {
      try {
        const gh = await deps.github(job.installationId);
        const [owner, name] = row.repo.fullName.split("/") as [string, string];
        const files = await fetchChangedFiles(gh, { owner, repo: name }, job.number);
        const hunk = hunkAround(files.find((f) => f.path === row.q.path)?.patch, row.q.line);
        const res = await ai.gateway.run(
          reviewPrompt({ id: row.q.id, path: row.q.path, line: row.q.line, question: row.q.question, askedAt: row.q.askedAt.toISOString(), answer: job.body }, hunk),
        );
        await ai.record("review", res.usage);
        await db.update(questions).set({ review: res.output }).where(eq(questions.id, row.q.id));
      } catch (err) {
        deps.log.warn(err instanceof AiUnavailableError ? err.message : "Answer review failed", { err: String(err) });
      }
    }
  }
  await deps.enqueue("pr.analyze", { installationId: job.installationId, repo: job.repo, number: job.number }, { singletonKey: `${job.repo.id}:${job.number}` });
}

export interface AskJob {
  installationId: number;
  repo: { id: number; fullName: string; private: boolean };
  number: number;
  question: string;
  asker: string;
}

/** A maintainer asked "@proof ..." on a PR. Answer from the PR's own code. */
export async function handleAsk(deps: Deps, job: AskJob): Promise<void> {
  const [ws] = await deps.db.select().from(workspaces).where(eq(workspaces.installationId, job.installationId)).limit(1);
  if (!ws || ws.status !== "active") return;
  const gh = await deps.github(job.installationId);
  const [owner, name] = job.repo.fullName.split("/") as [string, string];
  const reply = (body: string) => gh.rest.issues.createComment({ owner, repo: name, issue_number: job.number, body });

  const ai = await deps.gateway(ws);
  if (!ai) {
    await reply(`@${job.asker} PRoof can't answer questions here yet: no AI provider is set up for this workspace.`);
    return;
  }
  const { data: pull } = await gh.rest.pulls.get({ owner, repo: name, pull_number: job.number });
  const p = pull as unknown as PullPayload;
  const pr: PrContext = {
    repo: { owner, name, defaultBranch: p.base.repo.default_branch },
    number: job.number,
    title: p.title,
    body: p.body ?? "",
    labels: p.labels.map((l) => l.name),
    url: p.html_url,
    headSha: p.head.sha,
    author: { login: p.user.login, association: toAssociation(p.author_association) },
    files: await fetchChangedFiles(gh, { owner, repo: name }, job.number),
    linkedIssues: [],
    template: null,
    ci: { state: "none", failing: [] },
    claimedIssues: [],
    now: new Date().toISOString(),
  };
  try {
    const res = await ai.gateway.run(askPrompt(pr, job.question));
    await ai.record("ask", res.usage);
    await reply(`@${job.asker} ${res.output.answer}\n\n<sub>Answered by PRoof from this PR's code. Check the cited lines before relying on it.</sub>`);
  } catch (err) {
    await reply(`@${job.asker} PRoof couldn't answer that right now.`);
    deps.log.warn("Ask failed", { err: String(err) });
  }
}
