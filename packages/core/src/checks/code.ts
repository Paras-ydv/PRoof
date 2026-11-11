import { matchesAny, parsePatch } from "../diff.js";
import type { ChangedFile, Check, CheckResult } from "../types.js";

/** Built-in test path patterns. Repos can add more with settings.testPatterns. */
export const DEFAULT_TEST_PATTERNS = [
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/spec/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_test.go",
  "**/test_*.py",
  "**/*_test.py",
  "**/*Test.java",
  "**/*Tests.cs",
  "**/*_spec.rb",
];

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|c|cc|cpp|h|hpp|swift|scala|ex|exs|dart|lua)$/;

/** Files that are machine-generated and shouldn't count toward PR size. */
const GENERATED = [
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lock",
  "**/Cargo.lock",
  "**/go.sum",
  "**/poetry.lock",
  "**/uv.lock",
  "**/composer.lock",
  "**/Gemfile.lock",
  "**/*.min.js",
  "**/*.snap",
];

const TEST_DEF =
  /\b(it|test|describe)\s*\(|\bdef\s+test_|\bfunc\s+Test|@Test\b|\bassert\w*\s*[(.]|\bexpect\s*\(|#\[test\]/;

function isTest(f: ChangedFile, extra: string[]): boolean {
  return matchesAny(f.path, [...DEFAULT_TEST_PATTERNS, ...extra]);
}

/** A4 · Tests updated, none deleted */
export const testsCheck: Check = {
  id: "tests",
  title: "Tests",
  kind: "scored",
  weight: (s) => s.weights.tests,
  mode: (s) => s.checks.tests,
  run({ pr, settings }): CheckResult {
    const base = { id: "tests", title: "Tests", kind: "scored" as const, rule: "tests" };
    const tests = pr.files.filter((f) => isTest(f, settings.testPatterns));
    const source = pr.files.filter((f) => !isTest(f, settings.testPatterns) && SOURCE_EXT.test(f.path));

    // Tests removed: deleted test files, or test files losing more test definitions than they gain.
    const removedEvidence = [];
    for (const f of tests) {
      if (f.status === "removed") {
        removedEvidence.push({ text: `Test file deleted: ${f.path}`, path: f.path });
        continue;
      }
      const { added, removed } = parsePatch(f.patch);
      const lost = removed.filter((l) => TEST_DEF.test(l.text)).length - added.filter((l) => TEST_DEF.test(l.text)).length;
      if (lost > 0) {
        removedEvidence.push({ text: `${lost} test or assertion line${lost === 1 ? "" : "s"} removed in ${f.path}`, path: f.path });
      }
    }
    if (removedEvidence.length > 0) {
      return { ...base, status: "fail", ratio: 0, summary: "Tests were removed", evidence: removedEvidence };
    }

    if (source.length === 0) {
      return { ...base, status: "na", summary: "No source code changed", evidence: [] };
    }
    if (tests.length > 0) {
      return {
        ...base,
        status: "pass",
        ratio: 1,
        summary: `Tests updated in ${tests.length} file${tests.length === 1 ? "" : "s"}`,
        evidence: tests.slice(0, 5).map((f) => ({ text: f.path, path: f.path })),
      };
    }
    return {
      ...base,
      status: "warn",
      ratio: 1 / 3,
      summary: "Code changed with no test changes",
      evidence: source.slice(0, 5).map((f) => ({ text: `${f.path} changed`, path: f.path })),
    };
  },
};

/** A6 · Size and focus */
export const sizeCheck: Check = {
  id: "size",
  title: "Size",
  kind: "scored",
  weight: (s) => s.weights.size,
  mode: (s) => s.checks.size,
  run({ pr, settings }): CheckResult {
    const base = { id: "size", title: "Size", kind: "scored" as const, rule: "size" };
    if (pr.labels.includes(settings.skipLabels.size)) {
      return { ...base, status: "na", summary: `Skipped by the "${settings.skipLabels.size}" label`, evidence: [] };
    }
    const counted = pr.files.filter((f) => !matchesAny(f.path, GENERATED));
    const additions = counted.reduce((n, f) => n + f.additions, 0);
    const deletions = counted.reduce((n, f) => n + f.deletions, 0);
    const lines = additions + deletions;
    const dirs = new Set(counted.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : ".")));

    const { sizeSoftLimit: soft, sizeHardLimit: hard } = settings.thresholds;
    const ratio = lines <= soft ? 1 : lines >= hard ? 0 : 1 - (lines - soft) / (hard - soft);
    const rounded = Math.round(ratio * 100) / 100;
    const stats = `+${additions} / −${deletions} lines in ${counted.length} file${counted.length === 1 ? "" : "s"}`;
    const evidence = [{ text: stats }, { text: `Touches ${dirs.size} top-level folder${dirs.size === 1 ? "" : "s"}` }];

    if (ratio === 1) return { ...base, status: "pass", ratio: 1, summary: stats, evidence };
    return {
      ...base,
      status: ratio >= 0.5 ? "warn" : "fail",
      ratio: rounded,
      summary: `Large PR: ${stats}`,
      evidence: [...evidence, { text: "Consider splitting it into smaller PRs that can be reviewed one at a time." }],
    };
  },
};
