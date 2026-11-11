import { describe, expect, it } from "vitest";
import { CARD_MARKER, renderDiscord, renderEmail, renderGithub, renderSlack, renderWebhook, type RenderContext } from "../src/render/index.js";
import type { Report } from "../src/report.js";

const ctx: RenderContext = {
  repo: "acme/widgets",
  number: 7,
  title: "Add retry | backoff",
  url: "https://github.com/acme/widgets/pull/7",
  author: "dana",
  rulesUrl: "https://proof.example/rules/",
  dashboardUrl: "https://proof.example/r/1",
};

const report: Report = {
  publicScore: { value: 76, band: "small-fixes", counted: 100 },
  fullScore: { value: 76, band: "small-fixes", counted: 100 },
  newcomer: true,
  pending: false,
  summary: "Adds retry with backoff to the uploader.",
  items: [
    { id: "issue", title: "Linked issue", kind: "scored", status: "pass", ratio: 1, summary: "Linked to #4", evidence: [], rule: "issue", mode: "live", weight: 15, visibility: "public", points: 15 },
    {
      id: "tests",
      title: "Tests",
      kind: "scored",
      status: "warn",
      ratio: 1 / 3,
      summary: "Code changed with no test changes",
      evidence: [{ text: "src/a.ts changed", path: "src/a.ts" }],
      rule: "tests",
      mode: "live",
      weight: 15,
      visibility: "public",
      points: 5,
    },
    { id: "spray", title: "Spray pattern", kind: "context", status: "warn", summary: "9 PRs to 9 repos", evidence: [], rule: "spray", mode: "shadow", weight: 0, visibility: "maintainers" },
  ],
};

describe("renderGithub", () => {
  const md = renderGithub(report, ctx);

  it("starts with the marker so the comment can be edited in place", () => {
    expect(md.startsWith(CARD_MARKER)).toBe(true);
  });

  it("shows score, rows, fix links and the newcomer note", () => {
    expect(md).toContain("### PRoof · 76/100 · Small fixes");
    expect(md).toContain("| ✅ | Linked issue | Linked to #4 | 15/15 |");
    expect(md).toContain("[How to fix](https://proof.example/rules/tests.md)");
    expect(md).toContain("Thanks for your contribution, @dana!");
    expect(md).toContain("`src/a.ts`");
  });
});

describe("maintainer renderers", () => {
  it("builds Slack blocks and marks private rows", () => {
    const msg = renderSlack(report, ctx);
    expect(msg.text).toBe("acme/widgets #7: 76/100 · Small fixes");
    expect(JSON.stringify(msg.blocks)).toContain("`private`");
  });

  it("builds a Discord embed coloured by band", () => {
    const e = renderDiscord(report, ctx).embeds[0]!;
    expect(e.color).toBe(0xbf8700);
    expect(e.fields).toHaveLength(3);
  });

  it("escapes HTML in email", () => {
    const m = renderEmail({ ...report, summary: "<script>x</script>" }, ctx);
    expect(m.subject).toBe("[acme/widgets] #7 Add retry | backoff · 76/100 · Small fixes");
    expect(m.html).not.toContain("<script>");
    expect(m.text).toContain("Full report: https://proof.example/r/1");
  });

  it("produces a versioned webhook body", () => {
    const w = renderWebhook(report, ctx);
    expect(w.version).toBe(1);
    expect(w.items[2]).toMatchObject({ id: "spray", visibility: "maintainers", points: null });
  });
});
