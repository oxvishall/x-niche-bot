import type { App } from "../app.js";
import { DiscoveryEngine, type DiscoveryStats } from "../discovery/discovery-engine.js";
import { createDiscoveryContext } from "../discovery/query.js";
import { withBotRun } from "./run-tracker.js";

/** Runs one discovery pass for the configured niche. */
export async function runDiscovery(app: App): Promise<DiscoveryStats | null> {
  const { env, niche, x, repos } = app;
  const logger = app.logger.child({ job: "discovery" });

  if (!x) {
    logger.warn("X credentials are not configured; skipping discovery");
    return null;
  }
  if (niche.niche.searchQueries.length === 0) {
    logger.warn("Niche has no searchQueries; skipping discovery");
    return null;
  }

  const me = await x.getAuthenticatedUser();
  const ctx = createDiscoveryContext(niche, env.SEARCH_LANGUAGE, me.id);
  const engine = new DiscoveryEngine({ x, runs: repos.runs, posts: repos.posts, logger });

  return withBotRun(
    repos.runs,
    { niche: niche.niche.name, type: "DISCOVERY", dryRun: env.DRY_RUN },
    (botRunId) =>
      engine.run(
        ctx,
        { maxResults: env.SEARCH_MAX_RESULTS, lookbackMinutes: env.SEARCH_LOOKBACK_MINUTES },
        botRunId,
      ),
  );
}
