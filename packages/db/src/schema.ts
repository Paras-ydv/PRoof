import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ghId = (name: string) => bigint(name, { mode: "number" });

/**
 * One workspace per GitHub account (org or user), keyed on GitHub's numeric id.
 * The unique index is what guarantees a second workspace for the same org can't exist,
 * and the numeric id survives org renames.
 */
export const workspaces = pgTable("workspaces", {
  id: id(),
  githubAccountId: ghId("github_account_id").notNull().unique(),
  login: text("login").notNull(),
  accountType: text("account_type", { enum: ["Organization", "User"] }).notNull(),
  installationId: ghId("installation_id").notNull().unique(),
  status: text("status", { enum: ["active", "suspended", "uninstalled"] }).notNull().default("active"),
  /** Org-level settings patch (see @proof/core SettingsPatch). */
  settings: jsonb("settings").notNull().default({}),
  settingsVersion: integer("settings_version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const repos = pgTable(
  "repos",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    githubRepoId: ghId("github_repo_id").notNull().unique(),
    fullName: text("full_name").notNull(),
    private: boolean("private").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    /** Repo-level settings patch, applied over the workspace settings. */
    settings: jsonb("settings").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("repos_workspace_idx").on(t.workspaceId)],
);

export const users = pgTable("users", {
  id: id(),
  githubUserId: ghId("github_user_id").notNull().unique(),
  login: text("login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/** Dashboard sessions. Only a hash of the session token is stored. */
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** The user's GitHub token, encrypted. Used to re-check their roles on GitHub. */
  githubTokenCipher: text("github_token_cipher").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Encrypted credentials: AI keys, Slack tokens, Discord and webhook URLs, SMTP passwords. Never returned by the API. */
export const secrets = pgTable(
  "secrets",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["ai", "slack", "discord", "email", "webhook", "external-check"] }).notNull(),
    name: text("name").notNull(),
    cipher: text("cipher").notNull(),
    /** Last 4 characters, so people can tell keys apart. */
    hint: text("hint").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("secrets_workspace_kind_name_idx").on(t.workspaceId, t.kind, t.name)],
);

/** Where reports go. A null repo means the destination applies to every repo in the workspace. */
export const destinations = pgTable(
  "destinations",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id").references(() => repos.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["github", "slack", "discord", "email", "webhook"] }).notNull(),
    /** public = PR-safe part only; maintainers = full report. GitHub is always public. */
    audience: text("audience", { enum: ["public", "maintainers"] }).notNull(),
    /** Non-secret settings: Slack channel, email addresses, digest frequency. */
    config: jsonb("config").notNull().default({}),
    secretId: uuid("secret_id").references(() => secrets.id, { onDelete: "set null" }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("destinations_workspace_idx").on(t.workspaceId)],
);

export const reports = pgTable(
  "reports",
  {
    id: id(),
    repoId: uuid("repo_id").notNull().references(() => repos.id, { onDelete: "cascade" }),
    prNumber: integer("pr_number").notNull(),
    headSha: text("head_sha").notNull(),
    title: text("title").notNull(),
    authorLogin: text("author_login").notNull(),
    scorePublic: integer("score_public"),
    scoreFull: integer("score_full"),
    band: text("band"),
    pending: boolean("pending").notNull().default(false),
    /** The full report (@proof/core Report). */
    report: jsonb("report").notNull(),
    /** Settings the report ran with, so "why was this flagged?" has an answer later. */
    settings: jsonb("settings").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reports_repo_pr_sha_idx").on(t.repoId, t.prNumber, t.headSha),
    index("reports_repo_created_idx").on(t.repoId, t.createdAt),
  ],
);

/** The PRoof comment on each PR, so it can be edited in place. */
export const prCards = pgTable(
  "pr_cards",
  {
    repoId: uuid("repo_id").notNull().references(() => repos.id, { onDelete: "cascade" }),
    prNumber: integer("pr_number").notNull(),
    commentId: ghId("comment_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pr_cards_repo_pr_idx").on(t.repoId, t.prNumber)],
);

export const questions = pgTable(
  "questions",
  {
    id: id(),
    repoId: uuid("repo_id").notNull().references(() => repos.id, { onDelete: "cascade" }),
    prNumber: integer("pr_number").notNull(),
    path: text("path").notNull(),
    line: integer("line").notNull(),
    question: text("question").notNull(),
    /** The review comment PRoof posted; replies in its thread are the answer. */
    githubCommentId: ghId("github_comment_id"),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
    answer: text("answer"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    review: jsonb("review"),
  },
  (t) => [index("questions_repo_pr_idx").on(t.repoId, t.prNumber), index("questions_comment_idx").on(t.githubCommentId)],
);

export const claims = pgTable(
  "claims",
  {
    id: id(),
    repoId: uuid("repo_id").notNull().references(() => repos.id, { onDelete: "cascade" }),
    issueNumber: integer("issue_number").notNull(),
    login: text("login").notNull(),
    status: text("status", { enum: ["active", "released", "unclaimed", "done"] }).notNull().default("active"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    // At most one active claim per issue.
    uniqueIndex("claims_one_active_idx").on(t.repoId, t.issueNumber).where(sql`${t.status} = 'active'`),
    index("claims_login_idx").on(t.login),
  ],
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    reportId: uuid("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
    destinationId: uuid("destination_id").notNull().references(() => destinations.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    error: text("error"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deliveries_report_idx").on(t.reportId)],
);

/** GitHub webhook deliveries already accepted, keyed on X-GitHub-Delivery, to drop duplicates. */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** e.g. "settings.update", "secret.create", "destination.delete" */
    action: text("action").notNull(),
    target: text("target"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_workspace_created_idx").on(t.workspaceId, t.createdAt)],
);

/** Maintainer verdicts on individual flags. This is how the false-positive rate is measured. */
export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    reportId: uuid("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
    checkId: text("check_id").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    verdict: text("verdict", { enum: ["correct", "false-flag"] }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("feedback_one_per_user_idx").on(t.reportId, t.checkId, t.userId)],
);

export const featureRequests = pgTable("feature_requests", {
  id: id(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: ["new", "triaged", "planned", "done", "declined"] }).notNull().default("new"),
  createdAt: createdAt(),
});

/** Token usage per AI call, for spend caps and the usage page. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    task: text("task").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_workspace_created_idx").on(t.workspaceId, t.createdAt)],
);
