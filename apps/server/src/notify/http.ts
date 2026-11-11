import { signBody } from "../crypto.js";

export class DeliveryError extends Error {}

/** Only https, and never to private or local addresses, so a configured URL can't reach internal services. */
export function assertPublicHttpsUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new DeliveryError("URL must use https");
  const host = url.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host) ||
    host === "[::1]" ||
    /^\[(fc|fd|fe80)/i.test(host);
  if (privateHost) throw new DeliveryError("URL must point to a public host");
  return url;
}

/**
 * POST JSON with a timeout. When `signingSecret` is given, adds
 * X-Proof-Timestamp and X-Proof-Signature (HMAC-SHA256 of "<timestamp>.<body>").
 */
export async function postJson(
  url: string,
  body: unknown,
  opts: { timeoutMs?: number; signingSecret?: string; headers?: Record<string, string>; fetch?: typeof fetch } = {},
): Promise<unknown> {
  const target = assertPublicHttpsUrl(url);
  const text = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "PRoof", ...opts.headers };
  if (opts.signingSecret) {
    const ts = Math.floor(Date.now() / 1000);
    headers["x-proof-timestamp"] = String(ts);
    headers["x-proof-signature"] = signBody(opts.signingSecret, text, ts);
  }
  const res = await (opts.fetch ?? fetch)(target, {
    method: "POST",
    headers,
    body: text,
    redirect: "error",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  if (!res.ok) throw new DeliveryError(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  return type.includes("application/json") ? res.json() : res.text();
}
