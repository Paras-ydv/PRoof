import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { createDb, sql } from "@proof/db";
import { runMigrations } from "@proof/db/migrate";
import { Vault } from "../src/crypto.js";
import type { Deps } from "../src/deps.js";
import { loadEnv } from "../src/env.js";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://proof:proof@localhost:5433/proof_test";

export async function testDb() {
  await runMigrations(TEST_DB);
  const { db, client } = createDb(TEST_DB, { max: 4 });
  await db.execute(sql`truncate workspaces, users, webhook_deliveries, feature_requests cascade`);
  return { db, client };
}

export const silent = { info() {}, warn() {}, error() {} };

export function baseDeps(db: Deps["db"], over: Partial<Deps> = {}): Deps {
  return {
    env: loadEnv({ NODE_ENV: "test", APP_URL: "https://app.example", RULES_URL: "https://rules.example" } as NodeJS.ProcessEnv),
    db,
    vault: new Vault(randomBytes(32).toString("base64")),
    log: silent,
    channels: { slack: async () => {}, discord: async () => {}, email: async () => {}, webhook: async () => {} },
    github: async () => {
      throw new Error("no github in this test");
    },
    gateway: async () => null,
    enqueue: async () => {},
    userGithub: () => {
      throw new Error("no user github in this test");
    },
    exchangeCode: async () => "gho_test",
    getInstallation: async () => null,
    ...over,
  };
}

export async function tarballOf(files: Record<string, string>): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "proof-tar-"));
  const root = "acme-widgets-sha";
  for (const [p, content] of Object.entries(files)) {
    const full = join(dir, root, p);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  const chunks: Buffer[] = [];
  for await (const c of create({ gzip: true, cwd: dir }, [root]) as AsyncIterable<Buffer>) chunks.push(c);
  return Buffer.concat(chunks);
}
