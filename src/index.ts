import "dotenv/config";
import { loadNicheConfig, parseEnv } from "./config/index.js";
import { createLogger } from "./utils/logger.js";

async function main(): Promise<void> {
  const env = parseEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    name: env.BOT_NAME,
    pretty: env.NODE_ENV === "development",
  });

  const niche = await loadNicheConfig(env.NICHE_CONFIG_PATH);

  logger.info(
    {
      niche: niche.niche.name,
      dryRun: env.DRY_RUN,
      engagement: niche.engagement,
      publishing: niche.publishing,
      searchQueries: niche.niche.searchQueries.length,
    },
    "Configuration loaded",
  );

  if (!env.BOT_ENABLED) {
    logger.warn("BOT_ENABLED=false — exiting without running");
    return;
  }

  // Phase 1: foundation only. Discovery, engagement, publishing and the
  // scheduler are implemented in later phases.
  logger.info("Phase 1 foundation ready — no jobs implemented yet");
}

main().catch((error: unknown) => {
  // Config errors list variable names only, never values.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
