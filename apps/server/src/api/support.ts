import { Hono } from "hono";
import { z } from "zod";
import { eq, featureRequests, workspaces } from "@proof/db";
import type { Deps } from "../deps.js";
import { postJson } from "../notify/http.js";
import { canView } from "./access.js";
import type { AppEnv } from "./session.js";

const RequestInput = z.object({
  title: z.string().trim().min(4, "Add a short title").max(120),
  body: z.string().trim().min(10, "Tell us a bit more").max(4000),
  workspace: z.string().optional(),
});

/** Feature requests from the dashboard: stored, then forwarded to the PRoof team. */
export function supportRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.post("/feature-requests", async (c) => {
    const parsed = RequestInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
    const user = c.get("user");
    let workspaceId: string | null = null;
    let workspaceLogin: string | null = null;
    if (parsed.data.workspace) {
      const [ws] = await deps.db.select().from(workspaces).where(eq(workspaces.login, parsed.data.workspace)).limit(1);
      if (ws && (await canView(deps, user, ws))) {
        workspaceId = ws.id;
        workspaceLogin = ws.login;
      }
    }
    const [row] = await deps.db
      .insert(featureRequests)
      .values({ workspaceId, userId: user.id, title: parsed.data.title, body: parsed.data.body })
      .returning();

    if (deps.env.TEAM_NOTIFY_WEBHOOK) {
      const text = `New feature request from @${user.login}${workspaceLogin ? ` (${workspaceLogin})` : ""}: *${parsed.data.title}*\n${parsed.data.body.slice(0, 1500)}`;
      // Works with Slack and Discord incoming webhooks.
      await postJson(deps.env.TEAM_NOTIFY_WEBHOOK, { text, content: text.slice(0, 2000) }).catch((err) =>
        deps.log.warn("Could not forward feature request", { err: String(err) }),
      );
    }
    return c.json({ ok: true, id: row!.id }, 201);
  });

  return app;
}

/** Public facts the dashboard needs before sign-in. */
export function metaRoutes(deps: Deps) {
  const app = new Hono();
  app.get("/", (c) =>
    c.json({
      appSlug: deps.env.GITHUB_APP_SLUG,
      installUrl: `https://github.com/apps/${deps.env.GITHUB_APP_SLUG}/installations/new`,
      contactEmail: deps.env.CONTACT_EMAIL || null,
      rulesUrl: deps.env.RULES_URL,
      repoUrl: deps.env.REPO_URL,
    }),
  );
  return app;
}
