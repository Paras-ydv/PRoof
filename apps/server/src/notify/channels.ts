import nodemailer from "nodemailer";
import { renderDiscord, renderEmail, renderSlack, renderWebhook, type RenderContext, type Report } from "@proof/core";
import { DeliveryError, postJson } from "./http.js";

/** Non-secret destination settings, as stored in destinations.config. */
export interface DestinationConfig {
  /** Slack channel id. */
  channel?: string;
  /** Email recipients. */
  to?: string[];
}

export interface SendInput {
  report: Report;
  ctx: RenderContext;
  config: DestinationConfig;
  /** Decrypted credential: Slack bot token, Discord or webhook URL, webhook signing secret. */
  secret?: string;
  /** Extra non-secret field for webhooks: the target URL. */
  url?: string;
}

export interface Channels {
  slack(input: SendInput): Promise<void>;
  discord(input: SendInput): Promise<void>;
  email(input: SendInput): Promise<void>;
  webhook(input: SendInput): Promise<void>;
}

export function createChannels(opts: { smtpUrl: string; emailFrom: string; fetch?: typeof fetch }): Channels {
  const f = opts.fetch ?? fetch;
  const mailer = opts.smtpUrl ? nodemailer.createTransport(opts.smtpUrl) : null;

  return {
    async slack({ report, ctx, config, secret }) {
      if (!secret || !config.channel) throw new DeliveryError("Slack is not connected");
      const res = await f("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ channel: config.channel, unfurl_links: false, ...renderSlack(report, ctx) }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) throw new DeliveryError(`Slack: ${body.error ?? res.status}`);
    },

    async discord({ report, ctx, secret }) {
      if (!secret) throw new DeliveryError("Discord webhook URL missing");
      const url = new URL(secret);
      if (!/^(canary\.|ptb\.)?discord(app)?\.com$/.test(url.hostname)) throw new DeliveryError("Not a Discord webhook URL");
      await postJson(secret, renderDiscord(report, ctx), { fetch: f });
    },

    async email({ report, ctx, config }) {
      if (!mailer) throw new DeliveryError("Email is not configured on this server");
      if (!config.to?.length) throw new DeliveryError("No email recipients");
      const m = renderEmail(report, ctx);
      await mailer.sendMail({ from: opts.emailFrom, to: config.to, subject: m.subject, text: m.text, html: m.html });
    },

    async webhook({ report, ctx, secret, url }) {
      if (!url) throw new DeliveryError("Webhook URL missing");
      await postJson(url, renderWebhook(report, ctx), { signingSecret: secret, fetch: f });
    },
  };
}
