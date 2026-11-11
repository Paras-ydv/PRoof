import { Hono } from "hono";
import { eq, webhookDeliveries } from "@proof/db";
import type { Deps } from "../deps.js";
import { routeEvent } from "./route.js";

/**
 * POST /webhooks/github
 * 1. verify the signature  2. drop duplicate deliveries  3. route to jobs  4. reply quickly.
 */
export function webhookRoutes(deps: Deps, verify: (body: string, signature: string) => Promise<boolean>) {
  const app = new Hono();

  app.post("/github", async (c) => {
    const body = await c.req.text();
    const signature = c.req.header("x-hub-signature-256") ?? "";
    const event = c.req.header("x-github-event") ?? "";
    const delivery = c.req.header("x-github-delivery") ?? "";

    if (!signature || !(await verify(body, signature).catch(() => false))) {
      return c.json({ error: "Invalid signature" }, 401);
    }
    if (!delivery || !event) return c.json({ error: "Missing GitHub headers" }, 400);

    const inserted = await deps.db.insert(webhookDeliveries).values({ deliveryId: delivery, event }).onConflictDoNothing().returning();
    if (inserted.length === 0) return c.json({ ok: true, duplicate: true });

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return c.json({ error: "Body is not JSON" }, 400);
    }
    try {
      await routeEvent(deps, event, payload as never);
    } catch (err) {
      deps.log.error("Webhook routing failed", { event, delivery, err: String(err) });
      // Forget this delivery so a redelivery from GitHub's settings page is processed, not dropped.
      await deps.db.delete(webhookDeliveries).where(eq(webhookDeliveries.deliveryId, delivery)).catch(() => {});
      return c.json({ error: "Could not process event" }, 500);
    }
    return c.json({ ok: true }, 202);
  });

  return app;
}
