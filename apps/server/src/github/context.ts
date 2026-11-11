import type { AuthorAssociation, AuthorPrEvent, ChangedFile, CiState, LinkedIssue, SourceFile } from "@proof/core";
import type { Octokit } from "./app.js";
import { extractSources } from "./tarball.js";

export interface RepoRef {
  owner: string;
  repo: string;
}

/** The parts of a pull_request webhook payload PRoof reads. */
export interface PullPayload {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  draft?: boolean;
  user: { login: string; type?: string };
  author_association: string;
  labels: { name: string }[];
  head: { sha: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { default_branch: string; language?: string | null; topics?: string[] } };
}

const MAX_FILES = 3000;

export async function fetchChangedFiles(gh: Octokit, r: RepoRef, number: number): Promise<ChangedFile[]> {
  const files = await gh.paginate(gh.rest.pulls.listFiles, { ...r, pull_number: number, per_page: 100 }, (res, done) => {
    if (res.data.length < 100) done();
    return res.data;
  });
  return files.slice(0, MAX_FILES).map((f) => ({
    path: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));
}

/** Issues the PR will close, via GitHub's own link tracking (covers "Fixes #n" and manual links). */
export async function fetchLinkedIssues(gh: Octokit, r: RepoRef, number: number): Promise<LinkedIssue[]> {
  const data = await gh.graphql<{
    repository: {
      pullRequest: {
        closingIssuesReferences: { nodes: { number: number; title: string; assignees: { nodes: { login: string }[] } }[] };
      } | null;
    };
  }>(
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          closingIssuesReferences(first: 10) { nodes { number title assignees(first: 10) { nodes { login } } } }
        }
      }
    }`,
    { owner: r.owner, repo: r.repo, number },
  );
  return (data.repository.pullRequest?.closingIssuesReferences.nodes ?? []).map((n) => ({
    number: n.number,
    title: n.title,
    assignees: n.assignees.nodes.map((a) => a.login),
  }));
}

const TEMPLATE_PATHS = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
];

export async function fetchTemplate(gh: Octokit, r: RepoRef, ref: string): Promise<string | null> {
  for (const path of TEMPLATE_PATHS) {
    try {
      const res = await gh.rest.repos.getContent({ ...r, path, ref, mediaType: { format: "raw" } });
      if (typeof res.data === "string") return res.data;
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }
  return null;
}

const FAILED = new Set(["failure", "timed_out", "cancelled", "startup_failure"]);

/** CI state for the head commit, ignoring PRoof's own check runs. */
export async function fetchCi(gh: Octokit, r: RepoRef, sha: string, appSlug: string): Promise<CiState> {
  const [checks, status, waiting] = await Promise.all([
    gh.rest.checks.listForRef({ ...r, ref: sha, per_page: 100 }),
    gh.rest.repos.getCombinedStatusForRef({ ...r, ref: sha, per_page: 100 }),
    gh.rest.actions.listWorkflowRunsForRepo({ ...r, head_sha: sha, status: "action_required", per_page: 1 }).catch(() => null),
  ]);
  const runs = checks.data.check_runs.filter((c) => c.app?.slug !== appSlug);
  const failing = [
    ...runs.filter((c) => c.conclusion && FAILED.has(c.conclusion)).map((c) => ({ name: c.name, url: c.html_url ?? undefined })),
    ...status.data.statuses.filter((s) => s.state === "failure" || s.state === "error").map((s) => ({ name: s.context, url: s.target_url ?? undefined })),
  ];
  if (failing.length) return { state: "failure", failing };
  if ((waiting?.data.total_count ?? 0) > 0) return { state: "pending", awaitingApproval: true, failing: [] };
  const anyPending = runs.some((c) => c.status !== "completed") || status.data.statuses.some((s) => s.state === "pending");
  if (anyPending) return { state: "pending", failing: [] };
  if (runs.length === 0 && status.data.statuses.length === 0) return { state: "none", failing: [] };
  return { state: "success", failing: [] };
}

/**
 * The author's recent public PRs, from GitHub's public events feed.
 * The feed can lag (30 s to 6 h) and only covers recent events; spray detection is evidence, not a verdict.
 */
export async function fetchAuthorActivity(gh: Octokit, login: string): Promise<{ prs: AuthorPrEvent[]; ownRepos: string[] }> {
  const prs: AuthorPrEvent[] = [];
  const own = new Set<string>();
  for (let page = 1; page <= 3; page++) {
    const res = await gh.rest.activity.listPublicEventsForUser({ username: login, per_page: 100, page }).catch(() => null);
    if (!res || res.data.length === 0) break;
    for (const e of res.data) {
      const repo = e.repo.name;
      if (repo.toLowerCase().startsWith(`${login.toLowerCase()}/`)) own.add(repo);
      const action = (e.payload as { action?: string }).action;
      if (e.type === "PullRequestEvent" && action === "opened" && e.created_at) prs.push({ repo, createdAt: e.created_at });
    }
    if (res.data.length < 100) break;
  }
  return { prs, ownRepos: [...own] };
}

/** Source files at the PR head, from one tarball download. Returns null if the code can't be read. */
export async function fetchHeadSources(gh: Octokit, headRepo: string, sha: string): Promise<SourceFile[] | null> {
  const [owner, repo] = headRepo.split("/");
  try {
    const res = await gh.rest.repos.downloadTarballArchive({ owner: owner!, repo: repo!, ref: sha });
    const { files } = await extractSources(Buffer.from(res.data as ArrayBuffer));
    return files;
  } catch {
    return null;
  }
}

export function toAssociation(value: string): AuthorAssociation {
  const known: AuthorAssociation[] = ["OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "MANNEQUIN", "NONE"];
  return known.includes(value as AuthorAssociation) ? (value as AuthorAssociation) : "NONE";
}
