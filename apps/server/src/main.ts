import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createDb } from "@proof/db";
import { runMigrations } from "@proof/db/migrate";
import { createApp } from "./app.js";
import { Vault } from "./crypto.js";
import { consoleLogger, gatewayFactory, type Deps } from "./deps.js";
import { loadEnv } from "./env.js";
import { createGithubApp, userClient } from "./github/app.js";
import { handleClaimCommand, sweepClaims, type ClaimCommandJob } from "./jobs/claims.js";
import { handleAnswer, handleAsk, type AnswerJob, type AskJob } from "./jobs/questions.js";
import { createChannels } from "./notify/channels.js";
import { analyzePr, type AnalyzeJob } from "./pipeline/analyze.js";
import { enqueueWith, startQueue, work } from "./queue.js";

const env = loadEnv();
const log = consoleLogger;

if (!env.ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
}

await runMigrations(env.DATABASE_URL);
const { db, client } = createDb(env.DATABASE_URL);
const vault = new Vault(env.ENCRYPTION_KEY);
const github = createGithubApp(env);
const NOT_CONFIGURED = "The GitHub App isn't configured. Set GITHUB_APP_ID, GITHUB_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET in .env (see github-app.yml).";
if (!github) log.warn(NOT_CONFIGURED);
const boss = await startQueue(env.DATABASE_URL);

const deps: Deps = {
  env,
  db,
  vault,
  log,
  channels: createChannels({ smtpUrl: env.SMTP_URL, emailFrom: env.EMAIL_FROM }),
  github: (id) => (github ? github.getInstallationOctokit(id) : Promise.reject(new Error(NOT_CONFIGURED))),
  userGithub: userClient,
  exchangeCode: async (code) => {
    if (!github) throw new Error(NOT_CONFIGURED);
    return (await github.oauth.createToken({ code })).authentication.token;
  },
  getInstallation: async (id) => {
    if (!github) return null;
    try {
      const { data } = await github.octokit.rest.apps.getInstallation({ installation_id: id });
      const account = data.account as { id: number; login?: string; slug?: string; type?: string } | null;
      if (!account) return null;
      return { id: data.id, account: { id: account.id, login: account.login ?? account.slug ?? "", type: account.type ?? "Organization" } };
    } catch {
      return null;
    }
  },
  gateway: gatewayFactory(db, vault, log),
  enqueue: enqueueWith(boss),
};

await work<AnalyzeJob>(boss, "pr.analyze", (job) => analyzePr(deps, job));
await work<AnswerJob>(boss, "pr.answer", (job) => handleAnswer(deps, job));
await work<AskJob>(boss, "pr.ask", (job) => handleAsk(deps, job), 2);
await work<ClaimCommandJob>(boss, "claim.command", (job) => handleClaimCommand(deps, job));
await work(boss, "claims.sweep", () => sweepClaims(deps), 1);
await boss.schedule("claims.sweep", "17 * * * *");

const app = createApp(deps, async (body, signature) => (github ? github.webhooks.verify(body, signature) : false));

// In production the dashboard is served from the same origin, so cookies stay first-party.
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  const index = await readFile(`${webDist}/index.html`, "utf8");
  app.get("*", (c) => c.html(index));
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => log.info("PRoof server listening", { port: info.port }));

async function shutdown() {
  log.info("Shutting down");
  server.close();
  await boss.stop();
  await client.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
