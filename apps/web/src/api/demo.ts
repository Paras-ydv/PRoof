/**
 * Demo mode: answers API calls in the browser with sample data, so the dashboard
 * can be explored (and developed) without a GitHub App or a server.
 * Everything here is invented and shown under a "Demo data" banner.
 */
import { DEFAULT_SETTINGS, resolveSettings, type SettingsPatch } from "@proof/core/config";
import type { Report, ReportItem } from "@proof/core";
import { ApiError } from "./client";
import type { AuditEntry, Destination, ReportDetail, ReportRow, Repo, WorkspaceDetail } from "./types";

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

const repos: Repo[] = [
  { id: "r1", fullName: "lumen-labs/lumen", private: false, enabled: true, settings: {} },
  { id: "r2", fullName: "lumen-labs/lumen-docs", private: false, enabled: true, settings: { checks: { tests: "off" } } },
  { id: "r3", fullName: "lumen-labs/lumen-cli", private: false, enabled: true, settings: {} },
  { id: "r4", fullName: "lumen-labs/infra", private: true, enabled: false, settings: {} },
];

let orgSettings: SettingsPatch = {
  checks: { issue: "live", template: "live", ci: "live", tests: "live", ghostCode: "shadow", size: "live", spray: "shadow", history: "shadow", claims: "live" },
  questions: { mode: "askAndReview" },
  customRules: [
    {
      id: "conventional-title",
      title: "Conventional title",
      mode: "live",
      kind: "scored",
      weight: 5,
      condition: { type: "titleMatches", pattern: "^(feat|fix|docs|chore|refactor|test)(\\(.+\\))?: " },
      howToFix: 'Start the title with a type, like "fix(parser): handle empty input".',
    },
  ],
};

let ai: WorkspaceDetail["workspace"]["ai"] = { provider: "anthropic", model: "claude-opus-5-5", monthlyTokenCap: 4_000_000, keyHint: "••••9f2c" };

let destinations: Destination[] = [
  { id: "d1", type: "github", audience: "public", repoId: null, enabled: true, config: {}, secretHint: null },
  { id: "d2", type: "slack", audience: "maintainers", repoId: null, enabled: true, config: { channel: "C04PRTRIAGE" }, secretHint: "••••a81k" },
  { id: "d3", type: "email", audience: "maintainers", repoId: "r1", enabled: true, config: { to: ["maintainers@lumen.dev"] }, secretHint: null },
];

const item = (o: Partial<ReportItem> & Pick<ReportItem, "id" | "title" | "status" | "summary">): ReportItem => ({
  kind: "scored",
  evidence: [],
  mode: "live",
  weight: 0,
  visibility: "public",
  ...o,
});

function report(items: ReportItem[], summary: string, newcomer = false): Report {
  const scored = (vis?: "public") => {
    const xs = items.filter((i) => i.kind === "scored" && i.ratio !== undefined && i.weight > 0 && (!vis || i.visibility === vis));
    const counted = xs.reduce((n, i) => n + i.weight, 0);
    if (!counted) return null;
    const value = Math.round((xs.reduce((n, i) => n + i.ratio! * i.weight, 0) / counted) * 100);
    return { value, band: (value >= 80 ? "ready" : value >= 60 ? "small-fixes" : "needs-work") as "ready", counted };
  };
  return { publicScore: scored("public"), fullScore: scored(), items, newcomer, pending: items.some((i) => i.status === "pending"), summary };
}

const R: Record<string, ReportDetail["report"] & { row: Omit<ReportRow, "scorePublic" | "scoreFull" | "band" | "pending" | "flags"> }> = {};

function add(id: string, repo: Repo, pr: number, title: string, author: string, minutes: number, rep: Report) {
  R[id] = {
    id,
    repo: repo.fullName,
    prNumber: pr,
    title,
    author,
    headSha: "4e1c9a7d0b3f52e8a61c7d904f2b6e18c3a5d7f0",
    url: `https://github.com/${repo.fullName}/pull/${pr}`,
    createdAt: ago(minutes + 40),
    updatedAt: ago(minutes),
    data: rep,
    settings: resolveSettings(orgSettings, repo.settings),
    row: { id, repo: repo.fullName, repoId: repo.id, prNumber: pr, title, author, updatedAt: ago(minutes) },
  };
}

add(
  "rep-1042",
  repos[0]!,
  1042,
  "feat(storage): retry uploads with exponential backoff",
  "mira-okafor",
  14,
  report(
    [
      item({ id: "issue", title: "Linked issue", status: "pass", ratio: 1, weight: 15, points: 15, summary: "Linked to #981, claimed by the author", rule: "issue" }),
      item({ id: "template", title: "PR template", status: "warn", ratio: 0.67, weight: 10, points: 6.7, summary: "1 of 3 template sections empty", evidence: [{ text: '"how was this tested?" is empty' }], rule: "template" }),
      item({ id: "ci", title: "CI", status: "pass", ratio: 1, weight: 15, points: 15, summary: "All checks passed", rule: "ci" }),
      item({ id: "tests", title: "Tests", status: "warn", ratio: 0.33, weight: 15, points: 5, summary: "Code changed with no test changes", evidence: [{ text: "src/storage/upload.ts changed", path: "src/storage/upload.ts" }], rule: "tests" }),
      item({
        id: "ghostCode",
        title: "Ghost code",
        status: "fail",
        ratio: 0.67,
        weight: 20,
        points: 13.4,
        mode: "shadow",
        visibility: "maintainers",
        summary: "1 name called that exists nowhere",
        evidence: [{ text: "`retryWithJitter` imported from ./backoff, which doesn't define it", path: "src/storage/upload.ts", line: 4 }],
        rule: "ghost-code",
      }),
      item({ id: "size", title: "Size", status: "pass", ratio: 1, weight: 10, points: 10, summary: "+142 / −18 lines in 3 files", rule: "size" }),
      item({
        id: "questions",
        title: "Questions",
        status: "warn",
        ratio: 0.5,
        weight: 15,
        points: 7.5,
        summary: "2 of 2 answered",
        evidence: [
          { text: "Q: What happens when maxAttempts is 0? — good: Correctly says the first call still runs once.", path: "src/storage/upload.ts", line: 31 },
          { text: "Q: Why is the jitter added before the cap? — off: Answer describes a different function.", path: "src/storage/upload.ts", line: 44 },
        ],
        rule: "questions",
      }),
      item({ id: "conventional-title", title: "Conventional title", status: "pass", ratio: 1, weight: 5, points: 5, summary: "Title matches the format", rule: "custom/conventional-title" }),
      item({
        id: "spray",
        title: "Spray pattern",
        kind: "context",
        status: "warn",
        mode: "shadow",
        visibility: "maintainers",
        summary: "11 PRs to 9 unrelated repos in 2 d",
        evidence: [{ text: "quillhq/quill (2)" }, { text: "openmaps/tiler (2)" }, { text: "fern-ui/fern (1)" }, { text: "and 6 more" }],
        rule: "spray",
      }),
      item({ id: "history", title: "History", kind: "context", status: "pass", mode: "shadow", visibility: "maintainers", summary: "First-time contributor to this repo", evidence: [], rule: "history" }),
    ],
    "Adds exponential backoff with jitter to failed S3 uploads in src/storage/upload.ts and a maxAttempts option to the storage config.",
    true,
  ),
);

add(
  "rep-1039",
  repos[0]!,
  1039,
  "fix(parser): handle empty frontmatter blocks",
  "dev-sato",
  95,
  report(
    [
      item({ id: "issue", title: "Linked issue", status: "pass", ratio: 1, weight: 15, points: 15, summary: "Linked to #1012, assigned to the author", rule: "issue" }),
      item({ id: "template", title: "PR template", status: "pass", ratio: 1, weight: 10, points: 10, summary: "All template sections filled in", rule: "template" }),
      item({ id: "ci", title: "CI", status: "pass", ratio: 1, weight: 15, points: 15, summary: "All checks passed", rule: "ci" }),
      item({ id: "tests", title: "Tests", status: "pass", ratio: 1, weight: 15, points: 15, summary: "Tests updated in 1 file", rule: "tests" }),
      item({ id: "ghostCode", title: "Ghost code", status: "pass", ratio: 1, weight: 20, points: 20, mode: "shadow", visibility: "maintainers", summary: "Every called name exists in the repo", rule: "ghost-code" }),
      item({ id: "size", title: "Size", status: "pass", ratio: 1, weight: 10, points: 10, summary: "+24 / −3 lines in 2 files", rule: "size" }),
      item({ id: "questions", title: "Questions", status: "pass", ratio: 1, weight: 15, points: 15, summary: "1 of 1 answered", rule: "questions" }),
      item({ id: "history", title: "History", kind: "context", status: "pass", mode: "shadow", visibility: "maintainers", summary: "Has contributed before", evidence: [{ text: "6 merged, 0 closed without merge in this org" }], rule: "history" }),
    ],
    "Treats an empty --- block at the top of a markdown file as no frontmatter instead of throwing.",
  ),
);

add(
  "rep-1037",
  repos[2]!,
  212,
  "Add support for config profiles",
  "jules-r",
  260,
  report(
    [
      item({ id: "issue", title: "Linked issue", status: "fail", ratio: 0, weight: 15, points: 0, summary: "No linked issue", evidence: [{ text: 'Add "Fixes #123" to the description to link the issue this PR solves.' }], rule: "issue" }),
      item({ id: "template", title: "PR template", status: "fail", ratio: 0, weight: 10, points: 0, summary: "Description left as the template", rule: "template" }),
      item({ id: "ci", title: "CI", status: "fail", ratio: 0, weight: 15, points: 0, summary: "2 checks failing", evidence: [{ text: "lint" }, { text: "test (node 22)" }], rule: "ci" }),
      item({ id: "tests", title: "Tests", status: "fail", ratio: 0, weight: 15, points: 0, summary: "Tests were removed", evidence: [{ text: "Test file deleted: test/config.test.ts", path: "test/config.test.ts" }], rule: "tests" }),
      item({
        id: "ghostCode",
        title: "Ghost code",
        status: "fail",
        ratio: 0,
        weight: 20,
        points: 0,
        mode: "shadow",
        visibility: "maintainers",
        summary: "4 names called that exist nowhere",
        evidence: [
          { text: "`loadProfileFromKeychain` called, but not defined or imported anywhere", path: "src/config/profiles.ts", line: 18 },
          { text: "`config.mergeDeep` src/config doesn't define mergeDeep", path: "src/config/profiles.ts", line: 27 },
          { text: "`this.validateSchema` method not defined anywhere in the repo", path: "src/config/profiles.ts", line: 40 },
        ],
        rule: "ghost-code",
      }),
      item({ id: "size", title: "Size", status: "warn", ratio: 0.61, weight: 10, points: 6.1, summary: "Large PR: +842 / −310 lines in 19 files", rule: "size" }),
      item({ id: "conventional-title", title: "Conventional title", status: "fail", ratio: 0, weight: 5, points: 0, summary: "Title doesn't match the required format", rule: "custom/conventional-title" }),
      item({ id: "spray", title: "Spray pattern", kind: "context", status: "warn", mode: "shadow", visibility: "maintainers", summary: "23 PRs to 21 unrelated repos in 2 d", rule: "spray" }),
    ],
    "Adds named config profiles loaded from ~/.lumen/profiles and a --profile flag, and rewrites the config loader.",
    true,
  ),
);

add(
  "rep-1036",
  repos[1]!,
  388,
  "docs: clarify plugin lifecycle hooks",
  "ana-lindqvist",
  540,
  report(
    [
      item({ id: "issue", title: "Linked issue", status: "na", summary: "Small change, no issue needed", rule: "issue" }),
      item({ id: "template", title: "PR template", status: "pass", ratio: 1, weight: 10, points: 10, summary: "All template sections filled in", rule: "template" }),
      item({ id: "ci", title: "CI", status: "pending", summary: "CI is running", rule: "ci" }),
      item({ id: "size", title: "Size", status: "pass", ratio: 1, weight: 10, points: 10, summary: "+9 / −4 lines in 1 file", rule: "size" }),
    ],
    "Rewords the plugin lifecycle section to say when onLoad runs relative to config resolution.",
  ),
);

const rows = (): ReportRow[] =>
  Object.values(R).map((r) => ({
    ...r.row,
    scorePublic: r.data.publicScore?.value ?? null,
    scoreFull: r.data.fullScore?.value ?? null,
    band: r.data.fullScore?.band ?? null,
    pending: r.data.pending,
    flags: r.data.items.filter((i) => i.status === "warn" || i.status === "fail").length,
  }));

const audit: AuditEntry[] = [
  { action: "settings.update", target: null, before: null, after: null, at: ago(60 * 26), actor: "priya-n", avatar: null },
  { action: "destination.create", target: "slack", before: null, after: { channel: "C04PRTRIAGE" }, at: ago(60 * 50), actor: "priya-n", avatar: null },
  { action: "ai.update+key", target: null, before: null, after: { provider: "anthropic" }, at: ago(60 * 51), actor: "priya-n", avatar: null },
  { action: "repo.disable", target: "lumen-labs/infra", before: null, after: null, at: ago(60 * 52), actor: "tom-baker", avatar: null },
];

const feedback: ReportDetail["feedback"] = [{ checkId: "spray", verdict: "correct", note: null, mine: false }];

function detail(): WorkspaceDetail {
  return {
    workspace: {
      login: "lumen-labs",
      accountType: "Organization",
      status: "active",
      settings: orgSettings,
      effective: resolveSettings(orgSettings),
      defaults: DEFAULT_SETTINGS,
      ai,
      canAdmin: true,
      installUrl: "https://github.com/apps/proof/installations/new",
    },
    repos,
    destinations,
    externalCheckSecrets: [],
    stats: { last30Days: { reports: 186, avgScore: 74, prs: 131 } },
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function demoRequest<T>(path: string, init: { method?: string; body?: unknown }): Promise<T> {
  await wait(160 + Math.random() * 200);
  const method = init.method ?? "GET";
  const [p] = path.split("?");
  const body = init.body as any;
  const ok = { ok: true } as T;

  if (p === "/meta")
    return { appSlug: "proof", installUrl: "https://github.com/apps/proof/installations/new", contactEmail: "hello@example.com", rulesUrl: "https://github.com/proof-dev/proof/blob/main/docs/rules", repoUrl: "https://github.com/proof-dev/proof" } as T;
  if (p === "/me") return { user: { login: "priya-n", name: "Priya Nair", avatarUrl: null } } as T;
  if (p === "/workspaces") return { workspaces: [{ login: "lumen-labs", accountType: "Organization", status: "active" }] } as T;
  if (p === "/workspaces/lumen-labs" && method === "GET") return detail() as T;
  if (p === "/workspaces/lumen-labs/settings" && method === "PUT") {
    try {
      resolveSettings(body);
    } catch (err) {
      throw new ApiError("Some settings are invalid", 400);
    }
    orgSettings = body;
    audit.unshift({ action: "settings.update", target: null, before: null, after: null, at: new Date().toISOString(), actor: "priya-n", avatar: null });
    return ok;
  }
  const repoSettings = p?.match(/^\/workspaces\/lumen-labs\/repos\/(\w+)\/settings$/);
  if (repoSettings && method === "PUT") {
    const r = repos.find((x) => x.id === repoSettings[1]);
    if (r) r.settings = body;
    return ok;
  }
  const repoPatch = p?.match(/^\/workspaces\/lumen-labs\/repos\/(\w+)$/);
  if (repoPatch && method === "PATCH") {
    const r = repos.find((x) => x.id === repoPatch[1]);
    if (r) r.enabled = body.enabled;
    return ok;
  }
  if (p === "/workspaces/lumen-labs/ai" && method === "PUT") {
    ai = { provider: body.provider, model: body.model, baseUrl: body.baseUrl, monthlyTokenCap: body.monthlyTokenCap, keyHint: body.apiKey ? `••••${String(body.apiKey).slice(-4)}` : ai?.keyHint ?? null };
    return ok;
  }
  if (p === "/workspaces/lumen-labs/ai" && method === "DELETE") {
    ai = null;
    return ok;
  }
  if (p === "/workspaces/lumen-labs/destinations" && method === "POST") {
    const id = `d${Date.now()}`;
    destinations = [
      ...destinations,
      {
        id,
        type: body.type,
        audience: body.type === "github" ? "public" : body.audience,
        repoId: body.repoId ?? null,
        enabled: true,
        config: body.type === "slack" ? { channel: body.channel } : body.type === "email" ? { to: body.to } : body.type === "webhook" ? { url: body.url } : {},
        secretHint: body.token || body.webhookUrl || body.signingSecret ? "••••demo" : null,
      },
    ];
    return { ok: true, id } as T;
  }
  const dest = p?.match(/^\/workspaces\/lumen-labs\/destinations\/(\w+)$/);
  if (dest && method === "PATCH") {
    destinations = destinations.map((d) => (d.id === dest[1] ? { ...d, ...body } : d));
    return ok;
  }
  if (dest && method === "DELETE") {
    destinations = destinations.filter((d) => d.id !== dest[1]);
    return ok;
  }
  if (p === "/workspaces/lumen-labs/repos/sync" && method === "POST") return { ok: true, count: repos.length } as T;
  if (p === "/workspaces/lumen-labs/reports") return { reports: rows() } as T;
  const rep = p?.match(/^\/workspaces\/lumen-labs\/reports\/([\w-]+)$/);
  if (rep) {
    const r = R[rep[1]!];
    if (!r) throw new ApiError("Report not found", 404);
    const { row: _row, ...report } = r;
    return {
      report,
      feedback,
      deliveries: [
        { type: "github", status: "sent", error: null, at: r.updatedAt },
        { type: "slack", status: "sent", error: null, at: r.updatedAt },
      ],
    } as T;
  }
  const fb = p?.match(/^\/workspaces\/lumen-labs\/reports\/([\w-]+)\/feedback$/);
  if (fb && method === "POST") {
    const i = feedback.findIndex((f) => f.mine && f.checkId === body.checkId);
    if (i >= 0) feedback.splice(i, 1);
    feedback.push({ checkId: body.checkId, verdict: body.verdict, note: body.note ?? null, mine: true });
    return ok;
  }
  if (p === "/workspaces/lumen-labs/accuracy")
    return { checks: [{ checkId: "ghostCode", correct: 17, falseFlag: 2 }, { checkId: "spray", correct: 9, falseFlag: 3 }, { checkId: "tests", correct: 22, falseFlag: 1 }] } as T;
  if (p === "/workspaces/lumen-labs/audit") return { entries: audit } as T;
  if (p === "/workspaces/lumen-labs/usage")
    return {
      since: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
      cap: ai?.monthlyTokenCap ?? null,
      tasks: [
        { task: "summary", calls: 131, inputTokens: 612_000, outputTokens: 18_400 },
        { task: "questions", calls: 88, inputTokens: 401_000, outputTokens: 21_900 },
        { task: "review", calls: 140, inputTokens: 96_000, outputTokens: 11_200 },
        { task: "ask", calls: 12, inputTokens: 71_000, outputTokens: 6_100 },
      ],
    } as T;
  if (p === "/support/feature-requests" && method === "POST") return { ok: true, id: "fr1" } as T;
  throw new ApiError("Not found in demo data", 404);
}
