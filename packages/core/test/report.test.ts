import { describe, expect, it } from "vitest";
import { buildReport, publicView, runChecks, score, type ReportItem } from "../src/report.js";
import type { Check } from "../src/types.js";
import { input } from "./fixtures.js";

const item = (o: Partial<ReportItem>): ReportItem => ({
  id: "x",
  title: "X",
  kind: "scored",
  status: "pass",
  summary: "",
  evidence: [],
  mode: "live",
  weight: 10,
  visibility: "public",
  ...o,
});

describe("score", () => {
  it("weights ratios and rescales to 100", () => {
    const s = score([item({ ratio: 1, weight: 15 }), item({ ratio: 0, weight: 5 })]);
    expect(s).toEqual({ value: 75, band: "small-fixes", counted: 20 });
  });

  it("drops n/a, pending and context items", () => {
    const s = score([
      item({ ratio: 1, weight: 10 }),
      item({ status: "na", weight: 15 }),
      item({ status: "pending", weight: 15 }),
      item({ kind: "context", weight: 0 }),
    ]);
    expect(s?.value).toBe(100);
    expect(s?.counted).toBe(10);
  });

  it("is null when nothing is scored", () => {
    expect(score([item({ status: "na" })])).toBeNull();
  });
});

describe("buildReport", () => {
  it("keeps shadow results and person context away from the public view", async () => {
    const report = await buildReport(
      input(
        { linkedIssues: [{ number: 4, title: "Retry", assignees: ["dana"] }], authorRecentPrs: [] },
        { checks: { issue: "live", ci: "live", spray: "live" } },
      ),
    );
    const byId = Object.fromEntries(report.items.map((i) => [i.id, i]));
    expect(byId.issue?.visibility).toBe("public");
    expect(byId.tests?.visibility).toBe("maintainers"); // shadow by default
    expect(byId.spray?.visibility).toBe("maintainers"); // context, even when live
    expect(report.publicScore?.value).toBe(100);
    expect(report.fullScore!.value).toBeLessThan(100);

    const pub = publicView(report);
    expect(pub.items.map((i) => i.id).sort()).toEqual(["ci", "issue"]);
    expect(pub.fullScore).toEqual(pub.publicScore);
  });

  it("includes custom rules and extra checks", async () => {
    const extra: Check = {
      id: "acme-cla",
      title: "CLA signed",
      kind: "scored",
      weight: () => 10,
      mode: () => "live",
      run: () => ({ id: "acme-cla", title: "CLA signed", kind: "scored", status: "pass", ratio: 1, summary: "Signed", evidence: [] }),
    };
    const report = await buildReport(
      input({}, {
        customRules: [
          { id: "max-files", title: "Max files", mode: "live", kind: "scored", weight: 5, condition: { type: "maxFiles", max: 20 }, howToFix: "" },
        ],
      }),
      [extra],
    );
    expect(report.items.map((i) => i.id)).toEqual(expect.arrayContaining(["max-files", "acme-cla"]));
  });

  it("turns a crashing check into an n/a row", async () => {
    const boom: Check = {
      id: "boom",
      title: "Boom",
      kind: "scored",
      weight: () => 10,
      mode: () => "live",
      run: () => {
        throw new Error("bad");
      },
    };
    const errors: string[] = [];
    const items = await runChecks(input(), [boom], (c) => errors.push(c.id));
    expect(items[0]).toMatchObject({ status: "na", summary: "This check couldn't run" });
    expect(errors).toEqual(["boom"]);
  });
});
