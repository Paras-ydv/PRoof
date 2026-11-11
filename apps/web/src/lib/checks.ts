/** Names and plain-language descriptions for every built-in check. One source for every screen. */
export const CHECK_NAMES: Record<string, string> = {
  issue: "Linked issue",
  template: "PR template",
  ci: "CI",
  tests: "Tests",
  ghostCode: "Ghost code",
  size: "Size",
  questions: "Questions",
  spray: "Spray pattern",
  history: "History",
  claims: "Claims",
};

export type ScoredCheckId = "issue" | "template" | "ci" | "tests" | "ghostCode" | "size";

export const SCORED_CHECKS: { id: ScoredCheckId; title: string; desc: string }[] = [
  { id: "issue", title: "Linked issue", desc: "The PR links an issue, and that issue is assigned to or claimed by the author." },
  { id: "template", title: "PR template", desc: "Every section of the repo's PR template has real content." },
  { id: "ci", title: "CI", desc: "Required checks pass on the latest commit. Waiting for approval isn't counted as failing." },
  { id: "tests", title: "Tests", desc: "Code changes come with test changes, and no tests or assertions are removed." },
  { id: "ghostCode", title: "Ghost code", desc: "Functions and imports on added lines exist somewhere in the repo. Catches invented APIs." },
  { id: "size", title: "Size", desc: "The PR stays a reviewable size. Lockfiles and generated files don't count." },
];

export const CONTEXT_CHECKS: { id: "spray" | "history"; title: string; desc: string }[] = [
  { id: "spray", title: "Spray pattern", desc: "Many PRs to unrelated repos in a short window. Shown as a list of repos, never as a score." },
  { id: "history", title: "History", desc: "First-time contributor or regular, and how their claims went. Used to pick a friendlier tone." },
];
