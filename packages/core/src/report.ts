import type { Mode, Settings } from "./config.js";
import { ciCheck, issueCheck, templateCheck } from "./checks/hygiene.js";
import { sizeCheck, testsCheck } from "./checks/code.js";
import { questionsCheck } from "./checks/questions.js";
import { historyCheck, isNewcomer, sprayCheck } from "./checks/contributor.js";
import { customRuleCheck } from "./checks/custom.js";
import { ghostCodeCheck } from "./ghost/index.js";
import type { Check, CheckInput, CheckResult } from "./types.js";

export const BUILTIN_CHECKS: Check[] = [
  issueCheck,
  templateCheck,
  ciCheck,
  testsCheck,
  ghostCodeCheck,
  sizeCheck,
  questionsCheck,
  sprayCheck,
  historyCheck,
];

/**
 * Every check that applies to these settings: built-ins, the org's custom rules,
 * and any extra checks (external checks, self-hosted plugins).
 */
export function checksFor(settings: Settings, extra: Check[] = []): Check[] {
  return [...BUILTIN_CHECKS, ...settings.customRules.map(customRuleCheck), ...extra];
}

/** Who can see a result. */
export type Visibility = "public" | "maintainers";

export interface ReportItem extends CheckResult {
  mode: Exclude<Mode, "off">;
  weight: number;
  visibility: Visibility;
  /** Points earned, when scored. */
  points?: number;
}

export type Band = "ready" | "small-fixes" | "needs-work";

export interface Score {
  value: number;
  band: Band;
  /** Points available from the checks that counted. */
  counted: number;
}

export interface Report {
  /** Score from live checks only: safe to show on the PR. Null when nothing live is scored. */
  publicScore: Score | null;
  /** Score from every enabled check, including shadow ones. Maintainers only. */
  fullScore: Score | null;
  items: ReportItem[];
  newcomer: boolean;
  /** True while any check is still waiting (CI running, questions unanswered). */
  pending: boolean;
  summary?: string;
}

export function band(value: number): Band {
  return value >= 80 ? "ready" : value >= 60 ? "small-fixes" : "needs-work";
}

/**
 * Score a set of results. Checks that are n/a, pending, or unscored drop out,
 * and the rest are scaled back to 100, so a repo without CI isn't penalised for it.
 */
export function score(items: ReportItem[]): Score | null {
  const scored = items.filter((i) => i.kind === "scored" && i.ratio !== undefined && i.weight > 0);
  const counted = scored.reduce((n, i) => n + i.weight, 0);
  if (counted === 0) return null;
  const earned = scored.reduce((n, i) => n + i.ratio! * i.weight, 0);
  const value = Math.round((earned / counted) * 100);
  return { value, band: band(value), counted };
}

/** Run checks one by one. A check that throws becomes an n/a row instead of failing the report. */
export async function runChecks(input: CheckInput, checks: Check[], onError?: (check: Check, err: unknown) => void): Promise<ReportItem[]> {
  const items: ReportItem[] = [];
  for (const check of checks) {
    const mode = check.mode(input.settings);
    if (mode === "off") continue;
    let result: CheckResult;
    try {
      result = await check.run(input);
    } catch (err) {
      onError?.(check, err);
      result = { id: check.id, title: check.title, kind: check.kind, status: "na", summary: "This check couldn't run", evidence: [] };
    }
    const weight = check.kind === "scored" ? check.weight(input.settings) : 0;
    // Context checks describe the person, so they are never public, whatever their mode.
    const visibility: Visibility = mode === "live" && result.kind === "scored" ? "public" : "maintainers";
    const points = result.ratio !== undefined && weight > 0 ? Math.round(result.ratio * weight * 10) / 10 : undefined;
    items.push({ ...result, mode, weight, visibility, points });
  }
  return items;
}

export async function buildReport(input: CheckInput, extra: Check[] = [], summary?: string): Promise<Report> {
  const items = await runChecks(input, checksFor(input.settings, extra));
  return {
    publicScore: score(items.filter((i) => i.visibility === "public")),
    fullScore: score(items),
    items,
    newcomer: isNewcomer(input.pr.author.association),
    pending: items.some((i) => i.status === "pending"),
    summary,
  };
}

/** The part of a report that may be shown on the PR. */
export function publicView(report: Report): Report {
  return {
    ...report,
    fullScore: report.publicScore,
    items: report.items.filter((i) => i.visibility === "public"),
  };
}
