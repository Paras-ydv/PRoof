import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM for secrets at rest. Format: v1.<iv>.<tag>.<ciphertext>, base64url.
 * The version prefix lets the key be rotated later without breaking old values.
 */
export class Vault {
  private key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    this.key = key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  }

  decrypt(value: string): string {
    const [version, iv, tag, data] = value.split(".");
    if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  }
}

/** Last 4 characters, shown in the UI so people can tell keys apart. */
export const hint = (secret: string) => (secret.length <= 8 ? "••••" : `••••${secret.slice(-4)}`);

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Signature PRoof adds to outgoing webhooks and external-check calls, so receivers can verify them. */
export function signBody(secret: string, body: string, timestamp: number): string {
  return "v1=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
