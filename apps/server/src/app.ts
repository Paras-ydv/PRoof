import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import type { Deps } from "./deps.js";
import { authRoutes, setupRoutes } from "./api/auth.js";
import { requireUser, type AppEnv } from "./api/session.js";
import { metaRoutes, supportRoutes } from "./api/support.js";
import { workspaceRoutes } from "./api/workspace.js";
import { webhookRoutes } from "./webhooks/http.js";

/** The HTTP surface: GitHub webhooks, sign-in, setup, and the dashboard API. */
export function createApp(deps: Deps, verifyWebhook: (body: string, signature: string) => Promise<boolean>) {
  const app = new Hono();
  app.use(secureHeaders());
  app.get("/health", (c) => c.json({ ok: true }));

  // GitHub can send large payloads (e.g. installations with many repos).
  app.use("/webhooks/*", bodyLimit({ maxSize: 25 * 1024 * 1024 }));
  app.route("/webhooks", webhookRoutes(deps, verifyWebhook));

  app.route("/auth", authRoutes(deps));
  app.route("/github", setupRoutes(deps));
  app.route("/api/meta", metaRoutes(deps));

  const api = new Hono<AppEnv>();
  api.use(bodyLimit({ maxSize: 256 * 1024 }));
  api.use(requireUser(deps));
  // Cookies are SameSite=Lax; this header check also stops simple cross-site form posts.
  api.use(async (c, next) => {
    if (c.req.method !== "GET" && c.req.header("x-proof-client") !== "web") return c.json({ error: "Missing client header" }, 403);
    await next();
  });
  api.get("/me", (c) => {
    const u = c.get("user");
    return c.json({ user: { login: u.login, name: u.name, avatarUrl: u.avatarUrl } });
  });
  api.route("/workspaces", workspaceRoutes(deps));
  api.route("/support", supportRoutes(deps));
  app.route("/api", api);

  app.onError((err, c) => {
    deps.log.error("Unhandled error", { path: c.req.path, err: String(err) });
    return c.json({ error: "Something went wrong on our side. Try again in a moment." }, 500);
  });
  return app;
}
