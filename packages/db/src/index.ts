import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return { db: drizzle(client, { schema }), client };
}

// Query operators, re-exported so every package uses this package's single copy of drizzle-orm.
export { and, or, not, eq, ne, gt, gte, lt, lte, inArray, isNull, isNotNull, desc, asc, sql, count } from "drizzle-orm";
