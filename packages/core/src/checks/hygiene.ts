import type { Check, CheckResult, PrContext } from "../types.js";

function changedLines(pr: PrContext): number {
  return pr.files.reduce((n, f) => n + f.additions + f.deletions, 0);
}

/** A1 · Linked and assigned issue */
export const issueCheck: Check = {
  id: "issue",
  title: "Linked issue",
  kind: "scored",
  weight: (s) => s.weights.issue,
  mode: (s) => s.checks.issue,
  run({ pr, settings }): CheckResult {
    const base = { id: "issue", title: "Linked issue", kind: "scored" as const, rule: "issue" };
    if (pr.labels.includes(settings.skipLabels.issue)) {
      return { ...base, status: "na", summary: `Skipped by the "${settings.skipLabels.issue}" label`, evidence: [] };
    }
    if (pr.linkedIssues.length === 0 && changedLines(pr) <= settings.thresholds.trivialChangeLines) {
      return { ...base, status: "na", summary: "Small change, no issue needed", evidence: [] };
    }
    if (pr.linkedIssues.length === 0) {
      return {
        ...base,
        status: "fail",
        ratio: 0,
        summary: "No linked issue",
        evidence: [{ text: 'Add "Fixes #123" to the description to link the issue this PR solves.' }],
      };
    }
    const login = pr.author.login.toLowerCase();
    const owned = pr.linkedIssues.find(
      (i) => i.assignees.some((a) => a.toLowerCase() === login) || pr.claimedIssues.includes(i.number),
    );
    if (owned) {
      const how = pr.claimedIssues.includes(owned.number) ? "claimed by" : "assigned to";
      return {
        ...base,
        status: "pass",
        ratio: 1,
        summary: `Linked to #${owned.number}, ${how} the author`,
        evidence: [{ text: `#${owned.number} ${owned.title}` }],
      };
    }
    const first = pr.linkedIssues[0]!;
    return {
      ...base,
      status: "warn",
      ratio: 0.5,
      summary: `Linked to #${first.number}, but not assigned to the author`,
      evidence: [{ text: "Ask on the issue to be assigned, or comment /claim if the repo uses claims." }],
    };
  },
};

const COMMENT = /<!--[\s\S]*?-->/g;
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;

interface Section {
  heading: string;
  content: string;
}

function sections(markdown: string): Section[] {
  const out: Section[] = [];
  let current: Section | null = null;
  for (const line of markdown.replace(COMMENT, "").split("\n")) {
    const h = HEADING.exec(line.trim());
    if (h) {
      current = { heading: h[1]!.toLowerCase(), content: "" };
      out.push(current);
    } else if (current) {
      current.content += line + "\n";
    }
  }
  return out;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const UNCHECKED = /^\s*[-*]\s+\[ \]/gm;
const CHECKED = /^\s*[-*]\s+\[[xX]\]/gm;

/** A2 · PR template filled in */
export const templateCheck: Check = {
  id: "template",
  title: "PR template",
  kind: "scored",
  weight: (s) => s.weights.template,
  mode: (s) => s.checks.template,
  run({ pr }): CheckResult {
    const base = { id: "template", title: "PR template", kind: "scored" as const, rule: "template" };
    if (!pr.template) return { ...base, status: "na", summary: "Repo has no PR template", evidence: [] };

    const tpl = sections(pr.template);
    if (tpl.length === 0) {
      const body = normalize(pr.body.replace(COMMENT, ""));
      const filled = body.length >= 20 && body !== normalize(pr.template.replace(COMMENT, ""));
      return filled
        ? { ...base, status: "pass", ratio: 1, summary: "Description filled in", evidence: [] }
        : { ...base, status: "fail", ratio: 0, summary: "Description left as the template", evidence: [] };
    }

    const body = sections(pr.body);
    const empty: string[] = [];
    for (const t of tpl) {
      const match = body.find((b) => b.heading === t.heading);
      const content = match ? normalize(match.content.replace(UNCHECKED, "").replace(CHECKED, "")) : "";
      const tplContent = normalize(t.content.replace(UNCHECKED, "").replace(CHECKED, ""));
      const filled = content.length > 0 && content !== tplContent;
      const hasCheckedBox = match ? CHECKED.test(match.content) : false;
      CHECKED.lastIndex = 0;
      if (!filled && !hasCheckedBox) empty.push(t.heading);
    }

    const ratio = (tpl.length - empty.length) / tpl.length;
    if (empty.length === 0) {
      return { ...base, status: "pass", ratio: 1, summary: "All template sections filled in", evidence: [] };
    }
    return {
      ...base,
      status: ratio >= 0.5 ? "warn" : "fail",
      ratio,
      summary: `${empty.length} of ${tpl.length} template sections empty`,
      evidence: empty.map((h) => ({ text: `"${h}" is empty` })),
    };
  },
};

/** A3 · CI status */
export const ciCheck: Check = {
  id: "ci",
  title: "CI",
  kind: "scored",
  weight: (s) => s.weights.ci,
  mode: (s) => s.checks.ci,
  run({ pr }): CheckResult {
    const base = { id: "ci", title: "CI", kind: "scored" as const, rule: "ci" };
    switch (pr.ci.state) {
      case "none":
        return { ...base, status: "na", summary: "No CI configured", evidence: [] };
      case "pending":
        return {
          ...base,
          status: "pending",
          summary: pr.ci.awaitingApproval ? "Waiting for a maintainer to approve the CI run" : "CI is running",
          evidence: [],
        };
      case "success":
        return { ...base, status: "pass", ratio: 1, summary: "All checks passed", evidence: [] };
      case "failure":
        return {
          ...base,
          status: "fail",
          ratio: 0,
          summary: `${pr.ci.failing.length || "Some"} check${pr.ci.failing.length === 1 ? "" : "s"} failing`,
          evidence: pr.ci.failing.map((f) => ({ text: f.name, url: f.url })),
        };
    }
  },
};
