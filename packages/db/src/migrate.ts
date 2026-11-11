import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index.js";

/** Apply pending migrations. Safe to run on every deploy. */
export async function runMigrations(url: string) {
  const { db, client } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL ?? "postgres://proof:proof@localhost:5433/proof";
  await runMigrations(url);
  console.log("Migrations applied");
}
