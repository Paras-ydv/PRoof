import { and, count, eq, inArray } from "@proof/db";
import {
  buildReport,
  buildSymbolIndex,
  externalCheck,
  langForPath,
  questionsPrompt,
  resolveSettings,
  summaryPrompt,
  validQuestions,
  type Check,
  type PrContext,
  type QuestionState,
  type Settings,
  type SettingsPatch,
  type SymbolIndex,
} from "@proof/core";
import { claims, questions, reports, repos, secrets, workspaces } from "@proof/db";
import { AiUnavailableError } from "../ai/gateway.js";
import type { Deps, Workspace } from "../deps.js";
import type { Octokit } from "../github/app.js";
import {
  fetchAuthorActivity,
  fetchChangedFiles,
  fetchCi,
  fetchHeadSources,
  fetchLinkedIssues,
  fetchTemplate,
  toAssociation,
  type PullPayload,
} from "../github/context.js";
import { postJson } from "../notify/http.js";
import { deliver } from "./deliver.js";

export interface AnalyzeJob {
  installationId: number;
  repo: { id: number; fullName: string; private: boolean };
  number: number;
  /** The webhook's copy of the PR. The job re-fetches the PR, since queued payloads can be stale. */
  pull?: PullPayload;
}

/** Small in-process cache: re-runs on the same commit (CI finishing, answers) reuse the index. */
const indexCache = new Map<string, { index: SymbolIndex; contents: Map<string, string> }>();
function remember(key: string, value: { index: SymbolIndex; contents: Map<string, string> }) {
  indexCache.set(key, value);
  if (indexCache.size > 20) indexCache.delete(indexCache.keys().next().value!);
}

export function effectiveSettings(ws: Workspace, repoSettings: unknown, onError: (err: unknown) => void): Settings {
  try {
    return resolveSettings(ws.settings as SettingsPatch, repoSettings as SettingsPatch);
  } catch (err) {
    onError(err);
    try {
      return resolveSettings(ws.settings as SettingsPatch);
    } catch {
      return resolveSettings();
    }
  }
}

/** Find or create the repo row. New repos inherit the workspace defaults. */
export async function ensureRepo(deps: Deps, ws: Workspace, repo: AnalyzeJob["repo"]) {
  const [row] = await deps.db
    .insert(repos)
    .values({ workspaceId: ws.id, githubRepoId: repo.id, fullName: repo.fullName, private: repo.private })
    .onConflictDoUpdate({ target: repos.githubRepoId, set: { fullName: repo.fullName, private: repo.private, workspaceId: ws.id } })
    .returning();
  return row!;
}

export async function analyzePr(deps: Deps, job: AnalyzeJob): Promise<void> {
  const { db, log } = deps;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.installationId, job.installationId)).limit(1);
  if (!ws || ws.status !== "active") return;
  const repo = await ensureRepo(deps, ws, job.repo);
  if (!repo.enabled) return;

  const [owner, name] = job.repo.fullName.split("/") as [string, string];
  const r = { owner, repo: name };
  const gh = await deps.github(job.installationId);
  const latest = await gh.rest.pulls.get({ ...r, pull_number: job.number }).catch(() => null);
  const pull = (latest?.data as PullPayload & { state?: string } | undefined) ?? job.pull;
  if (!pull || (pull as { state?: string }).state === "closed") return;
  if (pull.draft) return;
  if (pull.user.type === "Bot") return;

  const settings = effectiveSettings(ws, repo.settings, (err) => log.warn("Invalid stored settings, using fallback", { repo: repo.fullName, err: String(err) }));
  const login = pull.user.login;

  const [files, linkedIssues, template, ci] = await Promise.all([
    fetchChangedFiles(gh, r, pull.number),
    fetchLinkedIssues(gh, r, pull.number).catch(() => []),
    fetchTemplate(gh, r, pull.base.repo.default_branch).catch(() => null),
    fetchCi(gh, r, pull.head.sha, deps.env.GITHUB_APP_SLUG).catch(() => ({ state: "none" as const, failing: [] })),
  ]);

  const pr: PrContext = {
    repo: { owner, name, defaultBranch: pull.base.repo.default_branch, language: pull.base.repo.language ?? undefined, topics: pull.base.repo.topics },
    number: pull.number,
    title: pull.title,
    body: pull.body ?? "",
    labels: pull.labels.map((l) => l.name),
    url: pull.html_url,
    headSha: pull.head.sha,
    author: { login, association: toAssociation(pull.author_association) },
    files,
    linkedIssues,
    template,
    ci,
    claimedIssues: await activeClaims(deps, repo.id, login),
    now: new Date().toISOString(),
  };

  if (settings.checks.spray !== "off") {
    const activity = await fetchAuthorActivity(gh, login);
    pr.authorRecentPrs = activity.prs;
    pr.authorKnownRepos = activity.ownRepos;
  }
  if (settings.checks.history !== "off") pr.authorHistory = await authorHistory(deps, ws.id, login);
  if (settings.checks.ghostCode !== "off" && files.some((f) => langForPath(f.path) && f.patch)) {
    await attachIndex(gh, pr, pull);
  }

  // AI: summary and understanding questions. Failures never block the report.
  const ai = await deps.gateway(ws);
  let summary: string | undefined;
  if (ai && settings.summary.enabled) {
    try {
      const res = await ai.gateway.run(summaryPrompt(pr));
      await ai.record("summary", res.usage);
      summary = res.output.summary;
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) log.error("Summary failed", { repo: repo.fullName, pr: pull.number, err: String(err) });
      else log.warn(err.message, { repo: repo.fullName });
    }
  }
  if (settings.questions.mode !== "off") {
    pr.questions = await loadQuestions(deps, repo.id, pull.number);
    if (pr.questions.length === 0 && ai) {
      pr.questions = await askQuestions(deps, gh, r, pr, repo.id, settings.questions.count, ai).catch((err) => {
        log.warn("Could not post questions", { repo: repo.fullName, err: String(err) });
        return [];
      });
    }
  }

  const extra = await externalChecks(deps, ws.id, settings);
  const report = await buildReport({ pr, settings }, extra, summary);

  const [stored] = await db
    .insert(reports)
    .values({
      repoId: repo.id,
      prNumber: pull.number,
      headSha: pull.head.sha,
      title: pull.title,
      authorLogin: login,
      scorePublic: report.publicScore?.value ?? null,
      scoreFull: report.fullScore?.value ?? null,
      band: report.fullScore?.band ?? null,
      pending: report.pending,
      report,
      settings,
    })
    .onConflictDoUpdate({
      target: [reports.repoId, reports.prNumber, reports.headSha],
      set: {
        title: pull.title,
        scorePublic: report.publicScore?.value ?? null,
        scoreFull: report.fullScore?.value ?? null,
        band: report.fullScore?.band ?? null,
        pending: report.pending,
        report,
        settings,
        updatedAt: new Date(),
      },
    })
    .returning();

  await deliver(deps, { gh, ws, repo, reportId: stored!.id, report, pull });
  log.info("Report built", { repo: repo.fullName, pr: pull.number, score: report.fullScore?.value ?? null, pending: report.pending });
}

async function activeClaims(deps: Deps, repoId: string, login: string): Promise<number[]> {
  const rows = await deps.db
    .select({ issue: claims.issueNumber })
    .from(claims)
    .where(and(eq(claims.repoId, repoId), eq(claims.login, login), eq(claims.status, "active")));
  return rows.map((r) => r.issue);
}

async function authorHistory(deps: Deps, workspaceId: string, login: string) {
  const repoIds = (await deps.db.select({ id: repos.id }).from(repos).where(eq(repos.workspaceId, workspaceId))).map((r) => r.id);
  if (repoIds.length === 0) return { mergedPrs: 0, closedPrs: 0, claims: 0, claimsExpired: 0, claimsWithPr: 0 };
  const rows = await deps.db
    .select({ status: claims.status, n: count() })
    .from(claims)
    .where(and(inArray(claims.repoId, repoIds), eq(claims.login, login)))
    .groupBy(claims.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const total = rows.reduce((n, r) => n + r.n, 0);
  // Merged/closed PR counts come from GitHub's author_association for now; PRoof only tracks claims itself.
  return { mergedPrs: 0, closedPrs: 0, claims: total, claimsExpired: by.released ?? 0, claimsWithPr: by.done ?? 0 };
}

async function attachIndex(gh: Octokit, pr: PrContext, pull: PullPayload) {
  const headRepo = pull.head.repo?.full_name;
  if (!headRepo) return;
  const key = `${headRepo}@${pull.head.sha}`;
  let entry = indexCache.get(key);
  if (!entry) {
    const sources = await fetchHeadSources(gh, headRepo, pull.head.sha);
    if (!sources) return;
    entry = { index: await buildSymbolIndex(sources), contents: new Map(sources.map((s) => [s.path, s.content])) };
    remember(key, entry);
  }
  pr.symbolIndex = entry.index;
  for (const f of pr.files) f.headContent = entry.contents.get(f.path);
}

async function loadQuestions(deps: Deps, repoId: string, prNumber: number): Promise<QuestionState[]> {
  const rows = await deps.db.select().from(questions).where(and(eq(questions.repoId, repoId), eq(questions.prNumber, prNumber)));
  return rows.map((q) => ({
    id: q.id,
    path: q.path,
    line: q.line,
    question: q.question,
    askedAt: q.askedAt.toISOString(),
    answer: q.answer ?? undefined,
    review: (q.review as QuestionState["review"]) ?? undefined,
  }));
}

/** Ask the model for questions on added lines and post them as one PR review. */
async function askQuestions(
  deps: Deps,
  gh: Octokit,
  r: { owner: string; repo: string },
  pr: PrContext,
  repoId: string,
  count: number,
  ai: NonNullable<Awaited<ReturnType<Deps["gateway"]>>>,
): Promise<QuestionState[]> {
  const res = await ai.gateway.run(questionsPrompt(pr, count));
  await ai.record("questions", res.usage);
  const qs = validQuestions(pr, res.output, count);
  if (qs.length === 0) return [];

  const review = await gh.rest.pulls.createReview({
    ...r,
    pull_number: pr.number,
    commit_id: pr.headSha,
    event: "COMMENT",
    body: `A couple of quick questions about this change. Reply in each thread; short answers are fine. This helps maintainers review faster.`,
    comments: qs.map((q) => ({ path: q.path, line: q.line, side: "RIGHT" as const, body: q.question })),
  });
  const posted = await gh.rest.pulls.listCommentsForReview({ ...r, pull_number: pr.number, review_id: review.data.id });
  const now = new Date();
  const rows = await deps.db
    .insert(questions)
    .values(
      qs.map((q) => ({
        repoId,
        prNumber: pr.number,
        path: q.path,
        line: q.line,
        question: q.question,
        askedAt: now,
        githubCommentId: posted.data.find((c) => c.path === q.path && c.line === q.line)?.id ?? null,
      })),
    )
    .returning();
  return rows.map((q) => ({ id: q.id, path: q.path, line: q.line, question: q.question, askedAt: now.toISOString() }));
}

/** The org's external checks, each calling out with its own signing secret. */
async function externalChecks(deps: Deps, workspaceId: string, settings: Settings): Promise<Check[]> {
  if (settings.externalChecks.length === 0) return [];
  const rows = await deps.db
    .select()
    .from(secrets)
    .where(and(eq(secrets.workspaceId, workspaceId), eq(secrets.kind, "external-check")));
  const byName = new Map(rows.map((s) => [s.name, s.cipher]));
  return settings.externalChecks.map((def) =>
    externalCheck(def, (d, payload) => {
      const cipher = byName.get(d.id);
      return postJson(d.url, payload, { timeoutMs: d.timeoutMs, signingSecret: cipher ? deps.vault.decrypt(cipher) : undefined });
    }),
  );
}
