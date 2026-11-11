import { and, eq, gte, sql } from "@proof/db";
import { aiUsage, secrets, workspaces, type Db } from "@proof/db";
import type { Vault } from "./crypto.js";
import type { Env } from "./env.js";
import { createGateway, DEFAULT_MODELS, type ModelGateway, type Usage } from "./ai/gateway.js";
import type { Octokit } from "./github/app.js";
import type { Channels } from "./notify/channels.js";

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info: (msg, data) => console.log(JSON.stringify({ level: "info", msg, ...data })),
  warn: (msg, data) => console.warn(JSON.stringify({ level: "warn", msg, ...data })),
  error: (msg, data) => console.error(JSON.stringify({ level: "error", msg, ...data })),
};

export type Workspace = typeof workspaces.$inferSelect;

/** Everything jobs and routes need, passed in so tests can swap any piece. */
export interface Deps {
  env: Env;
  db: Db;
  vault: Vault;
  log: Logger;
  channels: Channels;
  /** A GitHub client acting as the app installation. */
  github(installationId: number): Promise<Octokit>;
  /** The workspace's model, or null if AI isn't set up or the monthly cap is reached. */
  gateway(ws: Workspace): Promise<{ gateway: ModelGateway; record(task: string, usage: Usage): Promise<void> } | null>;
  /** Hand a job to the queue. */
  enqueue(name: JobName, data: unknown, opts?: { singletonKey?: string; startAfter?: number }): Promise<void>;
  /** A GitHub client acting as a signed-in user. */
  userGithub(token: string): Octokit;
  /** GitHub sign-in: turn an OAuth code into a user access token. */
  exchangeCode(code: string): Promise<string>;
  /** Read an installation with the app's own credentials (used during setup). */
  getInstallation(id: number): Promise<{ id: number; account: { id: number; login: string; type: string } } | null>;
}

export type JobName = "pr.analyze" | "pr.answer" | "pr.ask" | "claim.command" | "claims.sweep";

/** Default gateway factory: reads the workspace's AI config and decrypts its key. */
export function gatewayFactory(db: Db, vault: Vault, log: Logger): Deps["gateway"] {
  return async (ws) => {
    const cfg = ws.aiConfig;
    if (!cfg) return null;
    const [secret] = await db
      .select()
      .from(secrets)
      .where(and(eq(secrets.workspaceId, ws.id), eq(secrets.kind, "ai")))
      .limit(1);
    if (!secret) return null;

    if (cfg.monthlyTokenCap) {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const [row] = await db
        .select({ used: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int` })
        .from(aiUsage)
        .where(and(eq(aiUsage.workspaceId, ws.id), gte(aiUsage.createdAt, monthStart)));
      if ((row?.used ?? 0) >= cfg.monthlyTokenCap) {
        log.warn("AI monthly token cap reached", { workspace: ws.login });
        return null;
      }
    }

    const gateway = createGateway({
      provider: cfg.provider,
      model: cfg.model || DEFAULT_MODELS[cfg.provider],
      baseUrl: cfg.baseUrl,
      apiKey: vault.decrypt(secret.cipher),
    });
    return {
      gateway,
      record: async (task, usage) => {
        await db.insert(aiUsage).values({ workspaceId: ws.id, task, ...usage });
      },
    };
  };
}
