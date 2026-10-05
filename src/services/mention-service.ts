import type { App } from "../app.js";
import { MentionDiscovery, type MentionStats } from "../discovery/mentions.js";
import { createDiscoveryContext } from "../discovery/query.js";
import { withBotRun } from "./run-tracker.js";

/** Fetches new mentions of the bot so the engagement job can reply to them. */
export async function runMentionDiscovery(app: App): Promise<MentionStats | null> {
  const { env, niche, x, repos } = app;
  const logger = app.logger.child({ job: "mentions" });

  if (!niche.mentions.enabled) return null;
  if (!x) {
    logger.warn("X credentials are not configured; skipping mentions");
    return null;
  }

  const me = await x.getAuthenticatedUser();
  const ctx = createDiscoveryContext(niche, env.SEARCH_LANGUAGE, me.id);
  const discovery = new MentionDiscovery({ x, runs: repos.runs, posts: repos.posts, logger });

  return withBotRun(repos.runs, { niche: niche.niche.name, type: "DISCOVERY", dryRun: env.DRY_RUN }, (botRunId) =>
    discovery.run(ctx, me, botRunId),
  );
}
