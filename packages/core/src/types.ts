import type { Settings } from "./config.js";

/** How the author is related to the repo, as GitHub reports it in webhook payloads. */
export type AuthorAssociation =
  | "OWNER"
  | "MEMBER"
  | "COLLABORATOR"
  | "CONTRIBUTOR"
  | "FIRST_TIME_CONTRIBUTOR"
  | "FIRST_TIMER"
  | "MANNEQUIN"
  | "NONE";

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  /** Unified diff for this file. GitHub omits it for very large or binary files. */
  patch?: string;
  /** Full file content at the PR head, when fetched (used by ghost-code). */
  headContent?: string;
}

export interface LinkedIssue {
  number: number;
  title: string;
  assignees: string[];
}

export interface CiState {
  state: "success" | "failure" | "pending" | "none";
  /** True when fork CI is waiting for a maintainer to approve the run. */
  awaitingApproval?: boolean;
  failing: { name: string; url?: string }[];
}

/** One public PR opened by the author, from their recent activity. */
export interface AuthorPrEvent {
  repo: string; // "owner/name"
  createdAt: string; // ISO timestamp
}

/** Everything a check may look at. Built once per PR run by the server. */
export interface PrContext {
  repo: { owner: string; name: string; defaultBranch: string; language?: string; topics?: string[] };
  number: number;
  title: string;
  body: string;
  labels: string[];
  url: string;
  headSha: string;
  author: { login: string; association: AuthorAssociation };
  files: ChangedFile[];
  linkedIssues: LinkedIssue[];
  /** PR template text, or null if the repo has none. */
  template: string | null;
  ci: CiState;
  /** Issue numbers the author has an active PRoof claim on. */
  claimedIssues: number[];
  /** The author's recent public PRs elsewhere, when spray detection is on. */
  authorRecentPrs?: AuthorPrEvent[];
  /** Repos the author has contributed to before (owner/name), to tell related from unrelated. */
  authorKnownRepos?: string[];
  /** Stats from PRoof's own records for this author in this org. */
  authorHistory?: { mergedPrs: number; closedPrs: number; claims: number; claimsExpired: number; claimsWithPr: number };
  /** Understanding questions asked on this PR and their answers so far. */
  questions?: QuestionState[];
  /** Symbols that resolve, from the repo index (filled by the ghost-code indexer). */
  symbolIndex?: SymbolIndex;
  /** When this run happened. Checks must use this instead of Date.now(). */
  now: string;
}

export interface QuestionState {
  id: string;
  path: string;
  line: number;
  question: string;
  askedAt: string;
  answer?: string;
  /** Set by the AI reviewer in askAndReview mode. */
  review?: { verdict: "good" | "partial" | "off"; reason: string; quote?: string };
}

export interface SymbolIndex {
  /** Names defined anywhere in the repo at base or head. */
  defined: Set<string>;
  /** Names that come from outside the repo and are known to exist (stdlib, builtins). */
  known: Set<string>;
  /** Module specifiers that are external dependencies; members of these are "unknown", never "ghost". */
  externalModules: Set<string>;
}

export type CheckStatus = "pass" | "warn" | "fail" | "pending" | "na";

export interface Evidence {
  text: string;
  /** Optional location in the PR this evidence points at. */
  path?: string;
  line?: number;
  url?: string;
}

/**
 * Result of one check.
 * - Scored checks (Part A) set `ratio` (0..1). The score applies weights.
 * - Context checks (Part B) never set `ratio`. They only carry evidence.
 */
export interface CheckResult {
  id: string;
  title: string;
  kind: "scored" | "context";
  status: CheckStatus;
  /** Share of this check's weight earned, 0..1. Absent for context checks, "na" and "pending". */
  ratio?: number;
  /** One-line summary shown on the card. */
  summary: string;
  evidence: Evidence[];
  /** Id of the rule doc that explains this check and how to fix it. Renderers turn it into a link. */
  rule?: string;
}

export interface CheckInput {
  pr: PrContext;
  settings: Settings;
}

/**
 * A check. Built-in checks and org-specific checks share this shape,
 * so new checks can be added without touching the scoring or rendering.
 */
export interface Check {
  id: string;
  title: string;
  kind: "scored" | "context";
  /** Rubric weight, read from settings for built-ins or from the custom rule. 0 for context checks. */
  weight(settings: Settings): number;
  /** The mode this check runs in for these settings. */
  mode(settings: Settings): "off" | "shadow" | "live";
  run(input: CheckInput): CheckResult | Promise<CheckResult>;
}
