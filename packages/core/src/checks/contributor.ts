import type { AuthorAssociation, Check, CheckResult } from "../types.js";

const HOUR = 60 * 60 * 1000;

/** B1 · Spray pattern. Context only: evidence, never a score. */
export const sprayCheck: Check = {
  id: "spray",
  title: "Spray pattern",
  kind: "context",
  weight: () => 0,
  mode: (s) => s.checks.spray,
  run({ pr, settings }): CheckResult {
    const base = { id: "spray", title: "Spray pattern", kind: "context" as const, rule: "spray" };
    if (!pr.authorRecentPrs) {
      return { ...base, status: "na", summary: "No public activity data", evidence: [] };
    }
    const { sprayRepos, sprayWindowHours } = settings.thresholds;
    const since = Date.parse(pr.now) - sprayWindowHours * HOUR;
    const known = new Set((pr.authorKnownRepos ?? []).map((r) => r.toLowerCase()));
    const owner = pr.repo.owner.toLowerCase();
    const self = `${owner}/${pr.repo.name.toLowerCase()}`;

    const counts = new Map<string, number>();
    for (const e of pr.authorRecentPrs) {
      if (Date.parse(e.createdAt) < since) continue;
      const repo = e.repo.toLowerCase();
      // Related: this repo, another repo in the same org, or a repo they've contributed to before.
      if (repo === self || repo.startsWith(`${owner}/`) || known.has(repo)) continue;
      counts.set(e.repo, (counts.get(e.repo) ?? 0) + 1);
    }
    const repos = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const prs = repos.reduce((n, [, c]) => n + c, 0);
    const window = sprayWindowHours % 24 === 0 ? `${sprayWindowHours / 24} d` : `${sprayWindowHours} h`;
    const summary = `${prs} PR${prs === 1 ? "" : "s"} to ${repos.length} unrelated repo${repos.length === 1 ? "" : "s"} in ${window}`;
    const evidence = repos.slice(0, 10).map(([repo, n]) => ({
      text: `${repo} (${n})`,
      url: `https://github.com/${repo}/pulls?q=author%3A${encodeURIComponent(pr.author.login)}`,
    }));
    if (repos.length > 10) evidence.push({ text: `and ${repos.length - 10} more`, url: undefined as never });

    return { ...base, status: repos.length >= sprayRepos ? "warn" : "pass", summary, evidence };
  },
};

const ASSOCIATION_LABEL: Record<AuthorAssociation, string> = {
  OWNER: "Repo owner",
  MEMBER: "Org member",
  COLLABORATOR: "Collaborator",
  CONTRIBUTOR: "Has contributed before",
  FIRST_TIME_CONTRIBUTOR: "First-time contributor to this repo",
  FIRST_TIMER: "First contribution on GitHub",
  MANNEQUIN: "Imported account",
  NONE: "No prior contributions here",
};

/** B2 + B3 · History with this repo and claim track record. Context only. */
export const historyCheck: Check = {
  id: "history",
  title: "History",
  kind: "context",
  weight: () => 0,
  mode: (s) => s.checks.history,
  run({ pr }): CheckResult {
    const base = { id: "history", title: "History", kind: "context" as const, rule: "history" };
    const evidence = [];
    const h = pr.authorHistory;
    if (h) {
      evidence.push({ text: `${h.mergedPrs} merged, ${h.closedPrs} closed without merge in this org` });
      // Claim history is only shown once there's enough of it to mean something.
      if (h.claims >= 3) {
        evidence.push({ text: `${h.claims} claims: ${h.claimsWithPr} led to a PR, ${h.claimsExpired} expired` });
      }
    }
    return { ...base, status: "pass", summary: ASSOCIATION_LABEL[pr.author.association], evidence };
  },
};

/** True when the author is new here; renderers use this to choose a more welcoming tone. */
export function isNewcomer(association: AuthorAssociation): boolean {
  return association === "FIRST_TIME_CONTRIBUTOR" || association === "FIRST_TIMER" || association === "NONE";
}
