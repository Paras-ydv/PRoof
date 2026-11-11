import { resolveSettings, type SettingsPatch } from "../src/config.js";
import type { CheckInput, PrContext } from "../src/types.js";

export function pr(overrides: Partial<PrContext> = {}): PrContext {
  return {
    repo: { owner: "acme", name: "widgets", defaultBranch: "main" },
    number: 7,
    title: "Add retry to uploader",
    body: "",
    labels: [],
    url: "https://github.com/acme/widgets/pull/7",
    headSha: "abc123",
    author: { login: "dana", association: "CONTRIBUTOR" },
    files: [{ path: "src/uploader.ts", status: "modified", additions: 40, deletions: 5 }],
    linkedIssues: [],
    template: null,
    ci: { state: "success", failing: [] },
    claimedIssues: [],
    now: "2026-11-11T12:00:00Z",
    ...overrides,
  };
}

export function input(prOverrides: Partial<PrContext> = {}, settings: SettingsPatch = {}): CheckInput {
  return { pr: pr(prOverrides), settings: resolveSettings(settings) };
}
