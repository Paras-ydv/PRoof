import { describe, expect, it } from "vitest";
import { resolveSettings, type CustomRule, type ExternalCheck } from "../src/config.js";
import { customRuleCheck, externalCheck } from "../src/checks/custom.js";
import { input } from "./fixtures.js";

const rule = (o: Partial<CustomRule>): CustomRule => ({
  id: "conventional-title",
  title: "Conventional title",
  mode: "live",
  kind: "scored",
  weight: 5,
  condition: { type: "titleMatches", pattern: "^(feat|fix|docs|chore)(\\(.+\\))?: " },
  howToFix: 'Start the title with a type, like "fix: ..."',
  ...o,
});

describe("custom rules", () => {
  it("validates inside settings and rejects clashing ids", () => {
    expect(resolveSettings({ customRules: [rule({})] }).customRules).toHaveLength(1);
    expect(() => resolveSettings({ customRules: [rule({ id: "ci" })] })).toThrow(/already in use/);
    expect(() => resolveSettings({ customRules: [rule({ id: "Bad Id" })] })).toThrow();
  });

  it("checks the title format and adds the how-to on failure", async () => {
    const check = customRuleCheck(rule({}));
    expect((await check.run(input({ title: "fix(api): handle 404" }))).ratio).toBe(1);
    const r = await check.run(input({ title: "Handle 404" }));
    expect(r).toMatchObject({ status: "fail", ratio: 0 });
    expect(r.evidence.at(-1)?.text).toContain("fix: ...");
  });

  it("flags protected paths as context", async () => {
    const check = customRuleCheck(
      rule({ id: "no-vendor", kind: "context", condition: { type: "forbidPaths", globs: ["vendor/**"] } }),
    );
    const r = await check.run(input({ files: [{ path: "vendor/x.js", status: "modified", additions: 1, deletions: 0 }] }));
    expect(r.status).toBe("warn");
    expect(r.ratio).toBeUndefined();
    expect(check.weight(resolveSettings())).toBe(0);
  });

  it("requires tests for covered paths", async () => {
    const check = customRuleCheck(rule({ id: "api-tests", condition: { type: "pathsNeedTests", globs: ["src/api/**"] } }));
    const r = await check.run(input({ files: [{ path: "src/api/users.ts", status: "modified", additions: 1, deletions: 0 }] }));
    expect(r.status).toBe("fail");
  });

  it("reports a broken regex as misconfigured instead of throwing", async () => {
    const r = await customRuleCheck(rule({ condition: { type: "titleMatches", pattern: "(" } })).run(input());
    expect(r.status).toBe("na");
  });
});

describe("external checks", () => {
  const def: ExternalCheck = {
    id: "license-scan",
    title: "License scan",
    mode: "live",
    kind: "scored",
    weight: 10,
    url: "https://checks.example.com/license",
    timeoutMs: 5000,
  };

  it("maps a valid response and sends no contributor history", async () => {
    let sent: any;
    const check = externalCheck(def, async (_d, payload) => {
      sent = payload;
      return { status: "warn", ratio: 0.5, summary: "1 GPL dependency", evidence: [{ text: "left-pad@1.0.0" }] };
    });
    const r = await check.run(input({ authorHistory: { mergedPrs: 1, closedPrs: 0, claims: 0, claimsExpired: 0, claimsWithPr: 0 } }));
    expect(r).toMatchObject({ status: "warn", ratio: 0.5, summary: "1 GPL dependency" });
    expect(sent.repo).toBe("acme/widgets");
    expect(JSON.stringify(sent)).not.toContain("mergedPrs");
  });

  it("treats errors and bad responses as n/a", async () => {
    const down = externalCheck(def, async () => {
      throw new Error("timeout");
    });
    expect(await down.run(input())).toMatchObject({ status: "na", summary: "License scan did not respond" });
    const bad = externalCheck(def, async () => ({ nope: true }));
    expect((await bad.run(input())).summary).toBe("License scan returned an invalid response");
  });
});
