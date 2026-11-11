import { Hono, type Context } from "hono";
import { z } from "zod";
import { DEFAULT_SETTINGS, resolveSettings, type SettingsPatch } from "@proof/core";
import {
  aiUsage,
  and,
  auditLog,
  count,
  deliveries,
  desc,
  destinations,
  eq,
  feedback,
  gte,
  inArray,
  reports,
  repos,
  secrets,
  sql,
  users,
  workspaces,
} from "@proof/db";
import { hint } from "../crypto.js";
import type { Deps, Workspace } from "../deps.js";
import { canAdminRepo, canAdminWorkspace, canView, visibleInstallations } from "./access.js";
import type { AppEnv, SessionUser } from "./session.js";

type C = Context<AppEnv>;

const AiInput = z.object({
  provider: z.enum(["anthropic", "openai", "openai-compatible"]),
  model: z.string().min(1).max(100),
  baseUrl: z.string().url().optional(),
  monthlyTokenCap: z.number().int().positive().optional(),
  /** Only sent when setting or replacing the key. Never returned. */
  apiKey: z.string().min(8).max(500).optional(),
});

const DestinationInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("github"), repoId: z.string().uuid().nullable().default(null), enabled: z.boolean().default(true) }),
  z.object({
    type: z.literal("slack"),
    repoId: z.string().uuid().nullable().default(null),
    audience: z.enum(["public", "maintainers"]).default("maintainers"),
    channel: z.string().min(1).max(40),
    token: z.string().startsWith("xoxb-").optional(),
  }),
  z.object({
    type: z.literal("discord"),
    repoId: z.string().uuid().nullable().default(null),
    audience: z.enum(["public", "maintainers"]).default("maintainers"),
    webhookUrl: z.string().url().regex(/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//, "Must be a Discord webhook URL").optional(),
  }),
  z.object({
    type: z.literal("email"),
    repoId: z.string().uuid().nullable().default(null),
    audience: z.enum(["public", "maintainers"]).default("maintainers"),
    to: z.array(z.string().email()).min(1).max(20),
  }),
  z.object({
    type: z.literal("webhook"),
    repoId: z.string().uuid().nullable().default(null),
    audience: z.enum(["public", "maintainers"]).default("maintainers"),
    url: z.string().url().startsWith("https://"),
    signingSecret: z.string().min(16).max(200).optional(),
  }),
]);

const FeedbackInput = z.object({ checkId: z.string().min(1).max(60), verdict: z.enum(["correct", "false-flag"]), note: z.string().max(500).optional() });

async function audit(deps: Deps, ws: Workspace, user: SessionUser, action: string, target: string | null, before: unknown, after: unknown) {
  await deps.db.insert(auditLog).values({ workspaceId: ws.id, actorId: user.id, action, target, before: before ?? null, after: after ?? null });
}

function badRequest(c: C, err: unknown) {
  if (err instanceof z.ZodError) {
    return c.json({ error: "Some fields are invalid", fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
  }
  return c.json({ error: err instanceof Error ? err.message : "Invalid request" }, 400);
}

export function workspaceRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const { db } = deps;

  /** Load the workspace and confirm the user can at least see it on GitHub. */
  async function load(c: C): Promise<Workspace | Response> {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.login, c.req.param("login")!)).limit(1);
    if (!ws || !(await canView(deps, c.get("user"), ws))) return c.json({ error: "Workspace not found" }, 404);
    return ws;
  }
  async function loadAdmin(c: C): Promise<Workspace | Response> {
    const ws = await load(c);
    if (ws instanceof Response) return ws;
    if (!(await canAdminWorkspace(deps, c.get("user"), ws))) {
      return c.json({ error: ws.accountType === "User" ? "Only the account owner can change this" : `Only ${ws.login} org owners can change this` }, 403);
    }
    return ws;
  }

  /** Workspaces this user can see: installations visible to them that PRoof knows about. */
  app.get("/", async (c) => {
    const ids = await visibleInstallations(deps, c.get("user"));
    if (ids.length === 0) return c.json({ workspaces: [] });
    const rows = await db.select().from(workspaces).where(inArray(workspaces.installationId, ids));
    return c.json({
      workspaces: rows.map((w) => ({ login: w.login, accountType: w.accountType, status: w.status })),
    });
  });

  app.get("/:login", async (c) => {
    const ws = await load(c);
    if (ws instanceof Response) return ws;
    const user = c.get("user");
    const repoRows = await db.select().from(repos).where(eq(repos.workspaceId, ws.id)).orderBy(repos.fullName);
    const dests = await db.select().from(destinations).where(eq(destinations.workspaceId, ws.id));
    const secretRows = await db.select({ id: secrets.id, kind: secrets.kind, name: secrets.name, hint: secrets.hint }).from(secrets).where(eq(secrets.workspaceId, ws.id));
    const since = new Date(Date.now() - 30 * 86400_000);
    const repoIds = repoRows.map((r) => r.id);
    const [stats] = repoIds.length
      ? await db
          .select({
            reports: count(),
            avgScore: sql<number | null>`round(avg(${reports.scoreFull}))::int`,
            prs: sql<number>`count(distinct (${reports.repoId}, ${reports.prNumber}))::int`,
          })
          .from(reports)
          .where(and(inArray(reports.repoId, repoIds), gte(reports.createdAt, since)))
      : [{ reports: 0, avgScore: null, prs: 0 }];

    return c.json({
      workspace: {
        login: ws.login,
        accountType: ws.accountType,
        status: ws.status,
        settings: ws.settings,
        effective: resolveSettings(ws.settings as SettingsPatch),
        defaults: DEFAULT_SETTINGS,
        ai: ws.aiConfig ? { ...ws.aiConfig, keyHint: secretRows.find((s) => s.kind === "ai")?.hint ?? null } : null,
        canAdmin: await canAdminWorkspace(deps, user, ws),
        installUrl: `https://github.com/apps/${deps.env.GITHUB_APP_SLUG}/installations/new`,
      },
      repos: repoRows.map((r) => ({ id: r.id, fullName: r.fullName, private: r.private, enabled: r.enabled, settings: r.settings })),
      destinations: dests.map((d) => ({
        id: d.id,
        type: d.type,
        audience: d.audience,
        repoId: d.repoId,
        enabled: d.enabled,
        config: d.config,
        secretHint: secretRows.find((s) => s.id === d.secretId)?.hint ?? null,
      })),
      externalCheckSecrets: secretRows.filter((s) => s.kind === "external-check").map((s) => ({ id: s.name, hint: s.hint })),
      stats: { last30Days: stats },
    });
  });

  app.put("/:login/settings", async (c) => {
    const ws = await loadAdmin(c);
    if (ws instanceof Response) return ws;
    const patch = (await c.req.json().catch(() => null)) as SettingsPatch | null;
    if (!patch || typeof patch !== "object") return c.json({ error: "Send a settings object" }, 400);
    try {
      resolveSettings(patch);
    } catch (err) {
      return badRequest(c, err);
    }
    await db.update(workspaces).set({ settings: patch, settingsVersion: sql`${workspaces.settingsVersion} + 1`, updatedAt: new Date() }).where(eq(workspaces.id, ws.id));
    await audit(deps, ws, c.get("user"), "settings.update", null, ws.settings, patch);
    return c.json({ ok: true, effective: resolveSettings(patch) });
  });

  app.put("/:login/repos/:repoId/settings", async (c) => {
    const ws = await load(c);
    if (ws instanceof Response) return ws;
    const [repo] = await db.select().from(repos).where(and(eq(repos.id, c.req.param("repoId")), eq(repos.workspaceId, ws.id))).limit(1);
    if (!repo) return c.json({ error: "Repo not found" }, 404);
    if (!(await canAdminRepo(deps, c.get("user"), ws, repo.fullName))) return c.json({ error: `Only admins of ${repo.fullName} can change this` }, 403);
    const patch = (await c.req.json().catch(() => null)) as SettingsPatch | null;
    if (!patch || typeof patch !== "object") return c.json({ error: "Send a settings object" }, 400);
    try {
      resolveSettings(ws.settings as SettingsPatch, patch);
    } catch (err) {
      return badRequest(c, err);
    }
    await db.update(repos).set({ settings: patch }).where(eq(repos.id, repo.id));
    await audit(deps, ws, c.get("user"), "repo.settings.update", repo.fullName, repo.settings, patch);
    return c.json({ ok: true, effective: resolveSettings(ws.settings as SettingsPatch, patch) });
  });

  app.patch("/:login/repos/:repoId", async (c) => {
    const ws = await load(c);
    if (ws instanceof Response) return ws;
    const [repo] = await db.select().from(repos).where(and(eq(repos.id, c.req.param("repoId")), eq(repos.workspaceId, ws.id))).limit(1);
    if (!repo) return c.json({ error: "Repo not found" }, 404);
    if (!(await canAdminRepo(deps, c.get("user"), ws, repo.fullName))) return c.json({ error: `Only admins of ${repo.fullName} can change this` }, 403);
    const parsed = z.object({ enabled: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return badRequest(c, parsed.error);
    await db.update(repos).set({ enabled: parsed.data.enabled }).where(eq(repos.id, repo.id));
    await audit(deps, ws, c.get("user"), parsed.data.enabled ? "repo.enable" : "repo.disable", repo.fullName, null, null);
    return c.json({ ok: true });
  });

  app.put("/:login/ai", async (c) => {
    const ws = await loadAdmin(c);
    if (ws instanceof Response) return ws;
    const parsed = AiInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return badRequest(c, parsed.error);
    const { apiKey, ...config } = parsed.data;
    if (config.provider === "openai-compatible" && !config.baseUrl) return c.json({ error: "A base URL is required for OpenAI-compatible providers" }, 400);
    const hasKey = (await db.select({ id: secrets.id }).from(secrets).where(and(eq(secrets.workspaceId, ws.id), eq(secrets.kind, "ai")))).length > 0;
    if (!apiKey && !hasKey) return c.json({ error: "Add an API key" }, 400);

    if (apiKey) {
      await db
        .insert(secrets)
        .values({ workspaceId: ws.id, kind: "ai", name: "default", cipher: deps.vault.encrypt(apiKey), hint: hint(apiKey), createdBy: c.get("user").id })
        .onConflictDoUpdate({ target: [secrets.workspaceId, secrets.kind, secrets.name], set: { cipher: deps.vault.encrypt(apiKey), hint: hint(apiKey), createdAt: new Date() } });
    }
    await db.update(workspaces).set({ aiConfig: config, updatedAt: new Date() }).where(eq(workspaces.id, ws.id));
    await audit(deps, ws, c.get("user"), apiKey ? "ai.update+key" : "ai.update", null, ws.aiConfig, config);
    return c.json({ ok: true });
  });

  app.delete("/:login/ai", async (c) => {
    const ws = await loadAdmin(c);
    if (ws instanceof Response) return ws;
    await db.delete(secrets).where(and(eq(secrets.workspaceId, ws.id), eq(secrets.kind, "ai")));
    await db.update(workspaces).set({ aiConfig: null, updatedAt: new Date() }).where(eq(workspaces.id, ws.id));
    await audit(deps, ws, c.get("user"), "ai.remove", null, ws.aiConfig, null);
    return c.json({ ok: true });
  });

  app.post("/:login/destinations", async (c) => {
    const ws = await loadAdmin(c);
    if (ws instanceof Response) return ws;
    const parsed = DestinationInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return badRequest(c, parsed.error);
    const d = parsed.data;
    if (d.repoId) {
      const [r] = await db.select({ id: repos.id }).from(repos).where(and(eq(repos.id, d.repoId), eq(repos.workspaceId, ws.id)));
      if (!r) return c.json({ error: "Repo not found" }, 404);
    }

    const secretValue = d.type === "slack" ? d.token : d.type === "discord" ? d.webhookUrl : d.type === "webhook" ? d.signingSecret : undefined;
    if ((d.type === "slack" || d.type === "discord") && !secretValue) return c.json({ error: d.type === "slack" ? "Add the Slack bot token" : "Add the Discord webhook URL" }, 400);
    let secretId: string | null = null;
    if (secretValue) {
      const [s] = await db
        .insert(secrets)
        .values({
          workspaceId: ws.id,
          kind: d.type as "slack" | "discord" | "webhook",
          name: crypto.randomUUID(),
          cipher: deps.vault.encrypt(secretValue),
          hint: hint(secretValue),
          createdBy: c.get("user").id,
        })
        .returning();
      secretId = s!.id;
    }
    const config =
      d.type === "slack" ? { channel: d.channel } : d.type === "email" ? { to: d.to } : d.type === "webhook" ? { url: d.url } : {};
    const [row] = await db
      .insert(destinations)
      .values({
        workspaceId: ws.id,
        repoId: d.repoId,
        type: d.type,
        audience: d.type === "github" ? "public" : d.audience,
        config,
        secretId,
        enabled: d.type === "github" ? d.enabled : true,
      })
      .returning();
    await audit(deps, ws, c.get("user"), "destination.create", d.type, null, { ...config, audience: row!.audience });
    return c.json({ ok: true, id: row!.id }, 201);
  });

  app.patch("/:login/destinations/:id", async (c) => {
    const ws = await loadAdmin(c);
    if (ws instanceof Response) return ws;
    const parsed = z.object({ enabled: z.boolean().optional(), audience: z.enum(["public", "maintainers"]).optional() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return badRequest(c, parsed.error);
    const [d] = await db.select().from(destinations).where(and(eq(destinations.id, c.req.param("id")), eq(destinations.workspaceId, ws.id)));
    if (!d) return c.json({ error: "Destination not found" }, 404);
    const audience = d.type === "github" ? "public" : (parsed.data.audience ?? d.audience);
    await db.update(destinations).set({ enabled: parsed.data.enabled ?? d.enabled, audience }).where(eq(destinations.id, d.id));
    await audit(deps, ws, c.get("user"), "destination.update", d.type, { enabled: d.enabled, audience: d.audience }, parsed.data);
    return c.json({ ok: true });
  });

  app.delete("/:login/destinations/:id", async (c) => {
    const ws = await loadAdmin(c);
    if (ws instanceof Response) return ws;
    const [d] = await db.select().from(destinations).where(and(eq(destinations.id, c.req.param("id")), eq(destinations.workspaceId, ws.id)));
    if (!d) return c.json({ error: "Destination not found" }, 404);
    await db.delete(destinations).where(eq(destinations.id, d.id));
    if (d.secretId) await db.delete(secrets).where(eq(secrets.id, d.secretId));
    await audit(deps, ws, c.get("user"), "destination.delete", d.type, d.config, null);
    return c.json({ ok: true });
  });

  /** Signing secret for an org's external check, so their service can verify PRoof's calls. */
  app.put("/:login/external-checks/:checkId/secret", async (c) => {
    const ws = await loadAdmin(c);
    if (ws instanceof Response) return ws;
    const parsed = z.object({ secret: z.string().min(16).max(200) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return badRequest(c, parsed.error);
    const name = c.req.param("checkId");
    await db
      .insert(secrets)
      .values({ workspaceId: ws.id, kind: "external-check", name, cipher: deps.vault.encrypt(parsed.data.secret), hint: hint(parsed.data.secret), createdBy: c.get("user").id })
      .onConflictDoUpdate({ target: [secrets.workspaceId, secrets.kind, secrets.name], set: { cipher: deps.vault.encrypt(parsed.data.secret), hint: hint(parsed.data.secret) } });
    await audit(deps, ws, c.get("user"), "external-check.secret", name, null, null);
    return c.json({ ok: true });
  });

  app.get("/:login/reports", async (c) => {
    const ws = await load(c);
    if (ws instanceof Response) return ws;
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    const repoFilter = c.req.query("repo");
    const repoRows = await db.select({ id: repos.id, fullName: repos.fullName }).from(repos).where(eq(repos.workspaceId, ws.id));
    const ids = repoRows.filter((r) => !repoFilter || r.fullName === repoFilter).map((r) => r.id);
    if (ids.length === 0) return c.json({ reports: [] });
    const rows = await db
      .select({
        id: reports.id,
        repoId: reports.repoId,
        prNumber: reports.prNumber,
        title: reports.title,
        author: reports.authorLogin,
        scorePublic: reports.scorePublic,
        scoreFull: reports.scoreFull,
        band: reports.band,
        pending: reports.pending,
        updatedAt: reports.updatedAt,
        flags: sql<number>`(select count(*)::int from jsonb_array_elements(${reports.report}->'items') i where i->>'status' in ('warn','fail'))`,
      })
      .from(reports)
      .where(inArray(reports.repoId, ids))
      .orderBy(desc(reports.updatedAt))
      .limit(limit);
    const names = new Map(repoRows.map((r) => [r.id, r.fullName]));
    return c.json({ reports: rows.map((r) => ({ ...r, repo: names.get(r.repoId) })) });
  });

  app.get("/:login/reports/:id", async (c) => {
    const ws = await load(c);
    if (ws instanceof Response) return ws;
    const [row] = await db
      .select({ r: reports, repo: repos })
      .from(reports)
      .innerJoin(repos, eq(reports.repoId, repos.id))
      .where(and(eq(reports.id, c.req.param("id")), eq(repos.workspaceId, ws.id)))
      .limit(1);
    if (!row) return c.json({ error: "Report not found" }, 404);
    const fb = await db.select().from(feedback).where(eq(feedback.reportId, row.r.id));
    const sent = await db
      .select({ type: destinations.type, status: deliveries.status, error: deliveries.error, at: deliveries.attemptedAt })
      .from(deliveries)
      .innerJoin(destinations, eq(deliveries.destinationId, destinations.id))
      .where(eq(deliveries.reportId, row.r.id));
    return c.json({
      report: {
        id: row.r.id,
        repo: row.repo.fullName,
        prNumber: row.r.prNumber,
        title: row.r.title,
        author: row.r.authorLogin,
        headSha: row.r.headSha,
        url: `https://github.com/${row.repo.fullName}/pull/${row.r.prNumber}`,
        createdAt: row.r.createdAt,
        updatedAt: row.r.updatedAt,
        data: row.r.report,
        settings: row.r.settings,
      },
      feedback: fb.map((f) => ({ checkId: f.checkId, verdict: f.verdict, note: f.note, mine: f.userId === c.get("user").id })),
      deliveries: sent,
    });
  });

  /** A maintainer marks a flag as correct or a false flag. This is how accuracy gets measured. */
  app.post("/:login/reports/:id/feedback", async (c) => {
    const ws = await load(c);
    if (ws instanceof Response) return ws;
    const parsed = FeedbackInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return badRequest(c, parsed.error);
    const [row] = await db
      .select({ id: reports.id, repo: repos.fullName })
      .from(reports)
      .innerJoin(repos, eq(reports.repoId, repos.id))
      .where(and(eq(reports.id, c.req.param("id")), eq(repos.workspaceId, ws.id)));
    if (!row) return c.json({ error: "Report not found" }, 404);
    if (!(await canAdminRepo(deps, c.get("user"), ws, row.repo))) return c.json({ error: "Only maintainers of this repo can give feedback" }, 403);
    await db
      .insert(feedback)
      .values({ reportId: row.id, userId: c.get("user").id, ...parsed.data })
      .onConflictDoUpdate({ target: [feedback.reportId, feedback.checkId, feedback.userId], set: { verdict: parsed.data.verdict, note: parsed.data.note ?? null } });
    return c.json({ ok: true });
  });

  /** Per-check accuracy from maintainer feedback, for the last 90 days. */
  app.get("/:login/accuracy", async (c) => {
    const ws = await load(c);
    if (ws instanceof Response) return ws;
    const since = new Date(Date.now() - 90 * 86400_000);
    const rows = await db
      .select({ checkId: feedback.checkId, verdict: feedback.verdict, n: count() })
      .from(feedback)
      .innerJoin(reports, eq(feedback.reportId, reports.id))
      .innerJoin(repos, eq(reports.repoId, repos.id))
      .where(and(eq(repos.workspaceId, ws.id), gte(feedback.createdAt, since)))
      .groupBy(feedback.checkId, feedback.verdict);
    const by = new Map<string, { correct: number; falseFlag: number }>();
    for (const r of rows) {
      const e = by.get(r.checkId) ?? { correct: 0, falseFlag: 0 };
      if (r.verdict === "correct") e.correct += r.n;
      else e.falseFlag += r.n;
      by.set(r.checkId, e);
    }
    return c.json({ checks: [...by.entries()].map(([checkId, v]) => ({ checkId, ...v })) });
  });

  app.get("/:login/audit", async (c) => {
    const ws = await load(c);
    if (ws instanceof Response) return ws;
    const rows = await db
      .select({ action: auditLog.action, target: auditLog.target, before: auditLog.before, after: auditLog.after, at: auditLog.createdAt, actor: users.login, avatar: users.avatarUrl })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorId, users.id))
      .where(eq(auditLog.workspaceId, ws.id))
      .orderBy(desc(auditLog.createdAt))
      .limit(200);
    return c.json({ entries: rows });
  });

  app.get("/:login/usage", async (c) => {
    const ws = await load(c);
    if (ws instanceof Response) return ws;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const rows = await db
      .select({
        task: aiUsage.task,
        calls: count(),
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.workspaceId, ws.id), gte(aiUsage.createdAt, monthStart)))
      .groupBy(aiUsage.task);
    return c.json({ since: monthStart.toISOString(), cap: ws.aiConfig?.monthlyTokenCap ?? null, tasks: rows });
  });

  return app;
}
