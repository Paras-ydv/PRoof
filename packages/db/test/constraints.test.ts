import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claims, createDb, repos, workspaces } from "../src/index.js";
import { runMigrations } from "../src/migrate.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://proof:proof@localhost:5433/proof_test";
const { db, client } = createDb(url, { max: 2 });

beforeAll(async () => {
  await runMigrations(url);
  await db.execute(sql`truncate workspaces cascade`);
});
afterAll(() => client.end());

describe("database constraints", () => {
  it("allows only one workspace per GitHub account", async () => {
    await db.insert(workspaces).values({ githubAccountId: 101, login: "acme", accountType: "Organization", installationId: 9001 });
    await expect(
      db.insert(workspaces).values({ githubAccountId: 101, login: "acme-renamed", accountType: "Organization", installationId: 9002 }),
    ).rejects.toThrow();
  });

  it("allows only one active claim per issue", async () => {
    const [ws] = await db.insert(workspaces).values({ githubAccountId: 202, login: "beta", accountType: "Organization", installationId: 9003 }).returning();
    const [repo] = await db.insert(repos).values({ workspaceId: ws!.id, githubRepoId: 5001, fullName: "beta/app" }).returning();
    await db.insert(claims).values({ repoId: repo!.id, issueNumber: 4, login: "sam" });
    await expect(db.insert(claims).values({ repoId: repo!.id, issueNumber: 4, login: "dana" })).rejects.toThrow();
    // Ended claims don't block a new one.
    await db.update(claims).set({ status: "released" }).where(sql`${claims.issueNumber} = 4`);
    await db.insert(claims).values({ repoId: repo!.id, issueNumber: 4, login: "dana" });
  });
});
