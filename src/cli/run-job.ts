import "dotenv/config";
import { createApp, type App } from "../app.js";
import { runDiscovery } from "../services/discovery-service.js";
import { runEngagement } from "../services/engagement-service.js";
import { runPublishing } from "../services/publishing-service.js";

/** Runs a single job once, e.g. `npm run job -- discovery`. */
const JOBS: Record<string, (app: App) => Promise<unknown>> = {
  discovery: runDiscovery,
  engagement: runEngagement,
  publishing: runPublishing,
};

async function main(): Promise<void> {
  const name = process.argv[2];
  const job = name ? JOBS[name] : undefined;
  if (!job) {
    console.error(`Usage: npm run job -- <${Object.keys(JOBS).join("|")}>`);
    process.exitCode = 1;
    return;
  }

  const app = await createApp();
  try {
    const result = await job(app);
    app.logger.info({ job: name, result }, "Job finished");
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
