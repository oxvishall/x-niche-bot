import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp } from "./app.js";
import { buildJobs } from "./scheduler/jobs.js";
import { WorkerLock } from "./scheduler/lock.js";
import { Scheduler } from "./scheduler/scheduler.js";
import { formatError } from "./utils/errors.js";

const LOCK_RETRY_MS = 60_000;

/** Long-running worker: runs discovery, engagement and publishing on a schedule. */
async function main(): Promise<void> {
  const app = await createApp();
  const { env, niche, logger } = app;

  logger.info(
    {
      niche: niche.niche.name,
      dryRun: env.DRY_RUN,
      ai: env.AI_PROVIDER,
      xCredentials: app.x !== null,
      engagement: { enabled: niche.engagement.enabled, mode: niche.engagement.mode, delivery: niche.engagement.delivery },
      publishing: { enabled: niche.publishing.enabled, mode: niche.publishing.mode },
      searchQueries: niche.niche.searchQueries.length,
    },
    "Configuration loaded",
  );

  if (!env.BOT_ENABLED) {
    logger.warn("BOT_ENABLED=false — exiting without running");
    await app.close();
    return;
  }

  const scheduler = new Scheduler(logger.child({ module: "scheduler" }));
  for (const job of buildJobs(app)) scheduler.register(job);

  let shuttingDown = false;
  const lock = new WorkerLock(env.DATABASE_URL, `x-niche-bot:${niche.niche.name}`, (error) => {
    // Another instance may take over now, so stop rather than risk double posting.
    logger.error({ err: error }, "Lost the worker lock connection; shutting down");
    process.exitCode = 1;
    void shutdown("lock-lost");
  });
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");
    await scheduler.stop();
    await lock.release();
    await app.close();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  while (!(await lock.tryAcquire())) {
    if (shuttingDown) return;
    logger.warn("Another worker is running this niche; standing by");
    await sleep(LOCK_RETRY_MS);
  }
  if (shuttingDown) return;

  scheduler.start();
}

main().catch((error: unknown) => {
  // Config errors list variable names only, never values.
  console.error(formatError(error));
  process.exitCode = 1;
});
