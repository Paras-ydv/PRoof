import type { CustomRule, ExternalCheck, Report, Settings, SettingsPatch } from "@proof/core";

export type { CustomRule, ExternalCheck, Report, Settings, SettingsPatch };
export type { ReportItem } from "@proof/core";

export interface Me {
  user: { login: string; name: string | null; avatarUrl: string | null };
}

export interface Meta {
  appSlug: string;
  installUrl: string;
  contactEmail: string | null;
  rulesUrl: string;
}

export interface WorkspaceSummary {
  login: string;
  accountType: "Organization" | "User";
  status: "active" | "suspended" | "uninstalled";
}

export type Provider = "anthropic" | "openai" | "openai-compatible";

export interface AiConfig {
  provider: Provider;
  model: string;
  baseUrl?: string;
  monthlyTokenCap?: number;
  keyHint: string | null;
}

export interface Repo {
  id: string;
  fullName: string;
  private: boolean;
  enabled: boolean;
  settings: SettingsPatch;
}

export type DestinationType = "github" | "slack" | "discord" | "email" | "webhook";

export interface Destination {
  id: string;
  type: DestinationType;
  audience: "public" | "maintainers";
  repoId: string | null;
  enabled: boolean;
  config: { channel?: string; to?: string[]; url?: string };
  secretHint: string | null;
}

export interface WorkspaceDetail {
  workspace: {
    login: string;
    accountType: "Organization" | "User";
    status: WorkspaceSummary["status"];
    settings: SettingsPatch;
    effective: Settings;
    defaults: Settings;
    ai: AiConfig | null;
    canAdmin: boolean;
    installUrl: string;
  };
  repos: Repo[];
  destinations: Destination[];
  externalCheckSecrets: { id: string; hint: string }[];
  stats: { last30Days: { reports: number; avgScore: number | null; prs: number } };
}

export interface ReportRow {
  id: string;
  repo: string;
  repoId: string;
  prNumber: number;
  title: string;
  author: string;
  scorePublic: number | null;
  scoreFull: number | null;
  band: string | null;
  pending: boolean;
  updatedAt: string;
  flags: number;
}

export interface ReportDetail {
  report: {
    id: string;
    repo: string;
    prNumber: number;
    title: string;
    author: string;
    headSha: string;
    url: string;
    createdAt: string;
    updatedAt: string;
    data: Report;
    settings: Settings;
  };
  feedback: { checkId: string; verdict: "correct" | "false-flag"; note: string | null; mine: boolean }[];
  deliveries: { type: DestinationType; status: "sent" | "failed"; error: string | null; at: string }[];
}

export interface AuditEntry {
  action: string;
  target: string | null;
  before: unknown;
  after: unknown;
  at: string;
  actor: string | null;
  avatar: string | null;
}

export interface Usage {
  since: string;
  cap: number | null;
  tasks: { task: string; calls: number; inputTokens: number; outputTokens: number }[];
}

export interface Accuracy {
  checks: { checkId: string; correct: number; falseFlag: number }[];
}

export type DestinationInput =
  | { type: "github"; repoId?: string | null; enabled?: boolean }
  | { type: "slack"; repoId?: string | null; audience: "public" | "maintainers"; channel: string; token: string }
  | { type: "discord"; repoId?: string | null; audience: "public" | "maintainers"; webhookUrl: string }
  | { type: "email"; repoId?: string | null; audience: "public" | "maintainers"; to: string[] }
  | { type: "webhook"; repoId?: string | null; audience: "public" | "maintainers"; url: string; signingSecret?: string };
