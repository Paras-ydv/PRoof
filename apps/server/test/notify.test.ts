import { describe, expect, it } from "vitest";
import type { Report } from "@proof/core";
import { createChannels } from "../src/notify/channels.js";
import { assertPublicHttpsUrl, postJson } from "../src/notify/http.js";

const report: Report = { publicScore: null, fullScore: { value: 90, band: "ready", counted: 100 }, items: [], newcomer: false, pending: false };
const ctx = { repo: "acme/w", number: 1, title: "t", url: "https://github.com/acme/w/pull/1", author: "dana", rulesUrl: "https://x/rules" };

function recorder(response: unknown = { ok: true }) {
  const calls: { url: string; init: any }[] = [];
  const f = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, f };
}

describe("outgoing URL safety", () => {
  it("blocks non-https and private hosts", () => {
    expect(() => assertPublicHttpsUrl("http://example.com")).toThrow();
    for (const u of ["https://localhost/x", "https://127.0.0.1/x", "https://10.1.2.3/x", "https://192.168.1.1/x", "https://169.254.169.254/x", "https://db.internal/x"]) {
      expect(() => assertPublicHttpsUrl(u)).toThrow();
    }
    expect(assertPublicHttpsUrl("https://hooks.example.com/x").hostname).toBe("hooks.example.com");
  });

  it("signs bodies when a secret is given", async () => {
    const { calls, f } = recorder();
    await postJson("https://hooks.example.com/x", { a: 1 }, { signingSecret: "s", fetch: f });
    expect(calls[0]!.init.headers["x-proof-signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(calls[0]!.init.redirect).toBe("error");
  });
});

describe("channels", () => {
  it("posts to Slack with the bot token", async () => {
    const { calls, f } = recorder({ ok: true });
    await createChannels({ smtpUrl: "", emailFrom: "x", fetch: f }).slack({ report, ctx, config: { channel: "C1" }, secret: "xoxb-1" });
    expect(calls[0]!.url).toBe("https://slack.com/api/chat.postMessage");
    expect(calls[0]!.init.headers.authorization).toBe("Bearer xoxb-1");
    expect(JSON.parse(calls[0]!.init.body).channel).toBe("C1");
  });

  it("surfaces Slack errors", async () => {
    const { f } = recorder({ ok: false, error: "channel_not_found" });
    await expect(createChannels({ smtpUrl: "", emailFrom: "x", fetch: f }).slack({ report, ctx, config: { channel: "C1" }, secret: "t" })).rejects.toThrow("channel_not_found");
  });

  it("only sends Discord payloads to Discord", async () => {
    const { calls, f } = recorder();
    const ch = createChannels({ smtpUrl: "", emailFrom: "x", fetch: f });
    await expect(ch.discord({ report, ctx, config: {}, secret: "https://evil.example.com/hook" })).rejects.toThrow("Not a Discord");
    await ch.discord({ report, ctx, config: {}, secret: "https://discord.com/api/webhooks/1/abc" });
    expect(calls).toHaveLength(1);
  });

  it("explains when email isn't configured", async () => {
    await expect(createChannels({ smtpUrl: "", emailFrom: "x" }).email({ report, ctx, config: { to: ["a@b.c"] } })).rejects.toThrow("not configured");
  });
});
