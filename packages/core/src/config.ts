import { z } from "zod";

/**
 * How a check runs for a repo.
 * - off:    the check does not run.
 * - shadow: the check runs, but results only go to maintainer-only destinations.
 * - live:   results can also appear publicly on the PR.
 */
export const Mode = z.enum(["off", "shadow", "live"]);
export type Mode = z.infer<typeof Mode>;

/** Rubric weights for the PR readiness score (Part A). Keys match check ids. */
export const Weights = z.object({
  issue: z.number().min(0).max(100),
  template: z.number().min(0).max(100),
  ci: z.number().min(0).max(100),
  tests: z.number().min(0).max(100),
  ghostCode: z.number().min(0).max(100),
  size: z.number().min(0).max(100),
  questions: z.number().min(0).max(100),
});
export type Weights = z.infer<typeof Weights>;

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Use lowercase letters, numbers and dashes");

/** The condition a custom rule checks. */
export const RuleCondition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("titleMatches"), pattern: z.string().min(1).max(200) }),
  z.object({ type: z.literal("bodyContains"), text: z.string().min(1).max(200) }),
  z.object({ type: z.literal("requireLabel"), anyOf: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("forbidPaths"), globs: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("pathsNeedTests"), globs: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("maxFiles"), max: z.number().int().min(1) }),
]);
export type RuleCondition = z.infer<typeof RuleCondition>;

/** An org-defined rule, configured in the dashboard. No code needed. */
export const CustomRule = z.object({
  id: Slug,
  title: z.string().min(1).max(60),
  mode: Mode,
  /** Scored rules add to the readiness score; context rules only show evidence to maintainers. */
  kind: z.enum(["scored", "context"]),
  weight: z.number().min(0).max(100),
  condition: RuleCondition,
  /** Shown to the contributor when the rule isn't met. */
  howToFix: z.string().max(500),
});
export type CustomRule = z.infer<typeof CustomRule>;

/**
 * A check run by the org's own service. PRoof POSTs a signed PR summary to `url`
 * and shows the response as a row on the card.
 */
export const ExternalCheck = z.object({
  id: Slug,
  title: z.string().min(1).max(60),
  mode: Mode,
  kind: z.enum(["scored", "context"]),
  weight: z.number().min(0).max(100),
  url: z.string().url().refine((u) => u.startsWith("https://"), "Must use https"),
  timeoutMs: z.number().int().min(500).max(15000),
});
export type ExternalCheck = z.infer<typeof ExternalCheck>;

export const Settings = z.object({
  checks: z.object({
    issue: Mode,
    template: Mode,
    ci: Mode,
    tests: Mode,
    ghostCode: Mode,
    size: Mode,
    spray: Mode,
    history: Mode,
    claims: Mode,
  }),
  summary: z.object({ enabled: z.boolean() }),
  questions: z.object({
    /** off · askOnly (maintainer judges) · askAndReview (AI reviews answers too) */
    mode: z.enum(["off", "askOnly", "askAndReview"]),
    count: z.number().int().min(1).max(3),
    /** Days an unanswered question stays "awaiting answer" with no penalty. */
    graceDays: z.number().int().min(0).max(30),
  }),
  weights: Weights,
  thresholds: z.object({
    /** Spray: flag at this many unrelated repos ... */
    sprayRepos: z.number().int().min(2),
    /** ... within this many hours. */
    sprayWindowHours: z.number().int().min(1).max(24 * 30),
    /** Size: changed lines above which the size check starts losing points. */
    sizeSoftLimit: z.number().int().min(1),
    /** Size: changed lines at which the size check scores zero. */
    sizeHardLimit: z.number().int().min(1),
    /** Diffs at or below this many changed lines skip the issue check. */
    trivialChangeLines: z.number().int().min(0),
  }),
  claims: z.object({
    remindAfterDays: z.number().int().min(1),
    releaseAfterDays: z.number().int().min(1),
    /** Assign the issue on GitHub when someone claims it. */
    assignOnClaim: z.boolean(),
  }),
  /** Labels a maintainer can put on a PR to skip a check. */
  skipLabels: z.object({
    issue: z.string(),
    size: z.string(),
  }),
  /** Path patterns that count as tests. Extends the built-in list. */
  testPatterns: z.array(z.string()),
  customRules: z.array(CustomRule).max(50),
  externalChecks: z.array(ExternalCheck).max(10),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  checks: {
    issue: "shadow",
    template: "shadow",
    ci: "shadow",
    tests: "shadow",
    ghostCode: "shadow",
    size: "shadow",
    spray: "shadow",
    history: "shadow",
    claims: "off",
  },
  summary: { enabled: true },
  questions: { mode: "off", count: 2, graceDays: 3 },
  weights: { issue: 15, template: 10, ci: 15, tests: 15, ghostCode: 20, size: 10, questions: 15 },
  thresholds: {
    sprayRepos: 8,
    sprayWindowHours: 48,
    sizeSoftLimit: 400,
    sizeHardLimit: 1500,
    trivialChangeLines: 10,
  },
  claims: { remindAfterDays: 7, releaseAfterDays: 14, assignOnClaim: true },
  skipLabels: { issue: "proof:no-issue-ok", size: "proof:large-ok" },
  testPatterns: [],
  customRules: [],
  externalChecks: [],
};

const BUILTIN_IDS = new Set(["issue", "template", "ci", "tests", "ghostcode", "size", "questions", "spray", "history", "claims"]);

/** A partial settings object, as stored for an org default or a repo override. */
export type SettingsPatch = DeepPartial<Settings>;
type DeepPartial<T> = T extends unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function merge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(patch)) out[k] = merge(base[k], v);
    return out;
  }
  return patch;
}

/**
 * Resolve the effective settings for a repo:
 * built-in defaults, then the org's defaults, then the repo's overrides.
 * Throws a ZodError if the result is invalid.
 */
export function resolveSettings(orgPatch: SettingsPatch = {}, repoPatch: SettingsPatch = {}): Settings {
  const merged = merge(merge(DEFAULT_SETTINGS, orgPatch), repoPatch);
  const settings = Settings.parse(merged);
  if (settings.thresholds.sizeHardLimit <= settings.thresholds.sizeSoftLimit) {
    throw new Error("thresholds.sizeHardLimit must be greater than thresholds.sizeSoftLimit");
  }
  const ids = [...settings.customRules, ...settings.externalChecks].map((c) => c.id);
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i || BUILTIN_IDS.has(id));
  if (dupe) throw new Error(`Check id "${dupe}" is already in use`);
  return settings;
}
