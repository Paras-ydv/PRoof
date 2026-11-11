import { describe, expect, it } from "vitest";
import { ciCheck, issueCheck, templateCheck } from "../src/checks/hygiene.js";
import { input } from "./fixtures.js";

describe("issue check", () => {
  it("passes when the linked issue is assigned to the author", async () => {
    const r = await issueCheck.run(input({ linkedIssues: [{ number: 4, title: "Retry", assignees: ["Dana"] }] }));
    expect(r.status).toBe("pass");
    expect(r.ratio).toBe(1);
  });

  it("passes when the author claimed the issue", async () => {
    const r = await issueCheck.run(
      input({ linkedIssues: [{ number: 4, title: "Retry", assignees: [] }], claimedIssues: [4] }),
    );
    expect(r.summary).toContain("claimed");
  });

  it("gives half credit when linked but not assigned", async () => {
    const r = await issueCheck.run(input({ linkedIssues: [{ number: 4, title: "Retry", assignees: ["sam"] }] }));
    expect(r).toMatchObject({ status: "warn", ratio: 0.5 });
  });

  it("fails with a how-to when nothing is linked", async () => {
    const r = await issueCheck.run(input());
    expect(r).toMatchObject({ status: "fail", ratio: 0 });
    expect(r.evidence[0]?.text).toContain("Fixes #123");
  });

  it("skips trivial changes and the skip label", async () => {
    const tiny = await issueCheck.run(input({ files: [{ path: "README.md", status: "modified", additions: 1, deletions: 1 }] }));
    expect(tiny.status).toBe("na");
    const labelled = await issueCheck.run(input({ labels: ["proof:no-issue-ok"] }));
    expect(labelled.status).toBe("na");
  });
});

describe("template check", () => {
  const template = [
    "## What does this change?",
    "<!-- describe it -->",
    "## How was this tested?",
    "",
    "## Checklist",
    "- [ ] I read CONTRIBUTING.md",
  ].join("\n");

  it("is n/a without a template", async () => {
    expect((await templateCheck.run(input())).status).toBe("na");
  });

  it("passes when every section has content", async () => {
    const body = [
      "## What does this change?",
      "Adds retry with backoff.",
      "## How was this tested?",
      "Unit tests.",
      "## Checklist",
      "- [x] I read CONTRIBUTING.md",
    ].join("\n");
    const r = await templateCheck.run(input({ template, body }));
    expect(r).toMatchObject({ status: "pass", ratio: 1 });
  });

  it("names the empty sections", async () => {
    const body = [
      "## What does this change?",
      "Adds retry with backoff.",
      "## How was this tested?",
      "<!-- nothing -->",
      "## Checklist",
      "- [ ] I read CONTRIBUTING.md",
    ].join("\n");
    const r = await templateCheck.run(input({ template, body }));
    expect(r.status).toBe("fail");
    expect(r.ratio).toBeCloseTo(1 / 3);
    expect(r.evidence.map((e) => e.text)).toEqual(['"how was this tested?" is empty', '"checklist" is empty']);
  });

  it("handles templates without headings", async () => {
    const r = await templateCheck.run(input({ template: "Describe your change", body: "Describe your change" }));
    expect(r.status).toBe("fail");
  });
});

describe("ci check", () => {
  it("maps CI states", async () => {
    expect((await ciCheck.run(input({ ci: { state: "none", failing: [] } }))).status).toBe("na");
    expect((await ciCheck.run(input({ ci: { state: "success", failing: [] } }))).ratio).toBe(1);
    const pending = await ciCheck.run(input({ ci: { state: "pending", awaitingApproval: true, failing: [] } }));
    expect(pending.summary).toContain("approve");
    const failed = await ciCheck.run(input({ ci: { state: "failure", failing: [{ name: "lint" }] } }));
    expect(failed).toMatchObject({ status: "fail", ratio: 0, summary: "1 check failing" });
  });
});
