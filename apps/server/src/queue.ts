import { PgBoss } from "pg-boss";
import type { Deps, JobName } from "./deps.js";

export const QUEUES: JobName[] = ["pr.analyze", "pr.answer", "pr.ask", "claim.command", "claims.sweep"];

export async function startQueue(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss" });
  boss.on("error", (err) => console.error(JSON.stringify({ level: "error", msg: "Queue error", err: String(err) })));
  await boss.start();
  for (const name of QUEUES) await boss.createQueue(name).catch(() => {});
  return boss;
}

export function enqueueWith(boss: PgBoss): Deps["enqueue"] {
  return async (name, data, opts) => {
    await boss.send(name, data as object, {
      retryLimit: 3,
      retryBackoff: true,
      ...(opts?.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      ...(opts?.startAfter ? { startAfter: opts.startAfter } : {}),
    });
  };
}

/** Run a handler for each job in a batch. A throw fails the batch so pg-boss retries it. */
export async function work<T>(boss: PgBoss, name: JobName, handler: (data: T) => Promise<void>, concurrency = 4) {
  await boss.work<T>(name, { batchSize: 1, localConcurrency: concurrency }, async (jobs) => {
    for (const job of jobs) await handler(job.data);
  });
}
