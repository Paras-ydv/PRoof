import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url().default("postgres://proof:proof@localhost:5433/proof"),
  /** Public URL of the dashboard (used for links and OAuth redirects). */
  APP_URL: z.string().url().default("http://localhost:5173"),
  /** Public URL of this API server (used for the GitHub setup URL and OAuth callback). */
  API_URL: z.string().url().default("http://localhost:3000"),
  /** Where the "How to fix" rule docs live. */
  RULES_URL: z.string().url().default("https://github.com/proof-dev/proof/blob/main/docs/rules"),

  GITHUB_APP_ID: z.string().default(""),
  GITHUB_APP_SLUG: z.string().default("proof"),
  /** PEM private key. Literal "\n" sequences are turned into newlines. */
  GITHUB_PRIVATE_KEY: z
    .string()
    .default("")
    .transform((k) => k.replace(/\\n/g, "\n")),
  GITHUB_WEBHOOK_SECRET: z.string().default(""),
  GITHUB_CLIENT_ID: z.string().default(""),
  GITHUB_CLIENT_SECRET: z.string().default(""),

  /** 32-byte key, base64. Encrypts secrets and GitHub tokens at rest. Generate: openssl rand -base64 32 */
  ENCRYPTION_KEY: z.string().default(""),

  SMTP_URL: z.string().default(""),
  EMAIL_FROM: z.string().default("PRoof <noreply@localhost>"),

  /** Where feature requests are forwarded to the PRoof team (Slack or Discord incoming webhook). */
  TEAM_NOTIFY_WEBHOOK: z.string().default(""),
  CONTACT_EMAIL: z.string().default(""),
});

export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = Env.parse(source);
  if (env.NODE_ENV === "production") {
    const missing = (
      ["GITHUB_APP_ID", "GITHUB_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "ENCRYPTION_KEY"] as const
    ).filter((k) => !env[k]);
    if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
  return env;
}
