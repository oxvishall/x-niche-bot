import type { App } from "../app.js";
import { PublishingEngine, type PublishResult } from "../publishing/publishing-engine.js";
import { dryRunPoster } from "../x/index.js";
import { withBotRun } from "./run-tracker.js";

/** Publishes (or drafts) at most one original post. */
export async function runPublishing(app: App): Promise<PublishResult | null> {
  const { env, niche, ai, x, repos } = app;
  const logger = app.logger.child({ job: "publishing" });

  if (!niche.publishing.enabled) {
    logger.debug("Publishing is disabled for this niche");
    return null;
  }
  if (!ai) {
    logger.warn("AI_PROVIDER is none; cannot write posts");
    return null;
  }
  // Dry runs never touch the API, so they work without X credentials.
  const poster = x ?? (env.DRY_RUN ? dryRunPoster(logger) : null);
  if (!poster) {
    logger.warn("X credentials are not configured; skipping publishing");
    return null;
  }

  const engine = new PublishingEngine({
    ai,
    poster,
    published: repos.published,
    discovered: repos.posts,
    logger,
  });

  return withBotRun(
    repos.runs,
    { niche: niche.niche.name, type: "PUBLISHING", dryRun: env.DRY_RUN },
    () => engine.run(niche, { maxPostsPerDay: env.MAX_POSTS_PER_DAY }, env.DRY_RUN),
  );
}
