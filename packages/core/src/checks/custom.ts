import { z } from "zod";
import type { CustomRule, ExternalCheck } from "../config.js";
import { matchesAny } from "../diff.js";
import type { Check, CheckResult, Evidence, PrContext } from "../types.js";
import { DEFAULT_TEST_PATTERNS } from "./code.js";

interface Outcome {
  ok: boolean;
  summary: string;
  evidence: Evidence[];
}

function evaluate(rule: CustomRule, pr: PrContext, testPatterns: string[]): Outcome | null {
  const c = rule.condition;
  switch (c.type) {
    case "titleMatches": {
      let re: RegExp;
      try {
        re = new RegExp(c.pattern);
      } catch {
        return null;
      }
      const ok = re.test(pr.title);
      return { ok, summary: ok ? "Title matches the format" : "Title doesn't match the required format", evidence: [] };
    }
    case "bodyContains": {
      const ok = pr.body.toLowerCase().includes(c.text.toLowerCase());
      return { ok, summary: ok ? `Description includes "${c.text}"` : `Description is missing "${c.text}"`, evidence: [] };
    }
    case "requireLabel": {
      const has = c.anyOf.filter((l) => pr.labels.includes(l));
      return has.length
        ? { ok: true, summary: `Has label ${has.join(", ")}`, evidence: [] }
        : { ok: false, summary: `Needs one of these labels: ${c.anyOf.join(", ")}`, evidence: [] };
    }
    case "forbidPaths": {
      const hits = pr.files.filter((f) => matchesAny(f.path, c.globs));
      return {
        ok: hits.length === 0,
        summary: hits.length ? `Changes ${hits.length} protected file${hits.length === 1 ? "" : "s"}` : "No protected files changed",
        evidence: hits.slice(0, 10).map((f) => ({ text: f.path, path: f.path })),
      };
    }
    case "pathsNeedTests": {
      const touched = pr.files.filter((f) => matchesAny(f.path, c.globs));
      if (touched.length === 0) return { ok: true, summary: "No covered paths changed", evidence: [] };
      const tests = pr.files.some((f) => matchesAny(f.path, [...DEFAULT_TEST_PATTERNS, ...testPatterns]));
      return {
        ok: tests,
        summary: tests ? "Tests updated for covered paths" : "Covered paths changed without tests",
        evidence: touched.slice(0, 5).map((f) => ({ text: f.path, path: f.path })),
      };
    }
    case "maxFiles": {
      const ok = pr.files.length <= c.max;
      return { ok, summary: `${pr.files.length} files changed (limit ${c.max})`, evidence: [] };
    }
  }
}

/** Turn an org-defined rule into a check. */
export function customRuleCheck(rule: CustomRule): Check {
  return {
    id: rule.id,
    title: rule.title,
    kind: rule.kind,
    weight: () => (rule.kind === "scored" ? rule.weight : 0),
    mode: () => rule.mode,
    run({ pr, settings }): CheckResult {
      const base = { id: rule.id, title: rule.title, kind: rule.kind, rule: `custom/${rule.id}` };
      const out = evaluate(rule, pr, settings.testPatterns);
      if (!out) return { ...base, status: "na", summary: "Rule is misconfigured", evidence: [] };
      const evidence = out.ok || !rule.howToFix ? out.evidence : [...out.evidence, { text: rule.howToFix }];
      if (rule.kind === "context") return { ...base, status: out.ok ? "pass" : "warn", summary: out.summary, evidence };
      return { ...base, status: out.ok ? "pass" : "fail", ratio: out.ok ? 1 : 0, summary: out.summary, evidence };
    },
  };
}

/** What an org's external check service must return. */
export const ExternalCheckResponse = z.object({
  status: z.enum(["pass", "warn", "fail", "na"]),
  /** 0..1, required for scored checks unless status is "na". */
  ratio: z.number().min(0).max(1).optional(),
  summary: z.string().max(200),
  evidence: z
    .array(z.object({ text: z.string().max(500), path: z.string().optional(), line: z.number().int().optional(), url: z.string().url().optional() }))
    .max(20)
    .default([]),
});
export type ExternalCheckResponse = z.infer<typeof ExternalCheckResponse>;

/** The PR summary sent to an external check. Deliberately excludes contributor history. */
export function externalCheckPayload(pr: PrContext) {
  return {
    repo: `${pr.repo.owner}/${pr.repo.name}`,
    number: pr.number,
    url: pr.url,
    title: pr.title,
    body: pr.body,
    labels: pr.labels,
    headSha: pr.headSha,
    author: pr.author.login,
    files: pr.files.map((f) => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch })),
  };
}

/**
 * Turn an org's external check into a check. The caller supplies `call`,
 * which does the signed HTTP request; core stays free of I/O.
 */
export function externalCheck(def: ExternalCheck, call: (def: ExternalCheck, payload: unknown) => Promise<unknown>): Check {
  return {
    id: def.id,
    title: def.title,
    kind: def.kind,
    weight: () => (def.kind === "scored" ? def.weight : 0),
    mode: () => def.mode,
    async run({ pr }): Promise<CheckResult> {
      const base = { id: def.id, title: def.title, kind: def.kind, rule: `custom/${def.id}` };
      let parsed: ExternalCheckResponse;
      try {
        parsed = ExternalCheckResponse.parse(await call(def, externalCheckPayload(pr)));
      } catch (err) {
        const reason = err instanceof z.ZodError ? "returned an invalid response" : "did not respond";
        return { ...base, status: "na", summary: `${def.title} ${reason}`, evidence: [] };
      }
      const ratio = def.kind === "scored" && parsed.status !== "na" ? (parsed.ratio ?? (parsed.status === "pass" ? 1 : 0)) : undefined;
      return { ...base, status: parsed.status, ratio, summary: parsed.summary, evidence: parsed.evidence };
    },
  };
}
