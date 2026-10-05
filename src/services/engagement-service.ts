import type { App } from "../app.js";
import { EngagementEngine, type DeliveryStats, type DraftStats } from "../engagement/engagement-engine.js";
import { withBotRun } from "./run-tracker.js";

export interface EngagementRunStats {
  delivery: DeliveryStats;
  search: DraftStats | null;
  mentions: DraftStats | null;
}

/** Delivers approved API replies, then drafts replies to search results and mentions. */
export async function runEngagement(app: App): Promise<EngagementRunStats | null> {
  const { env, niche, ai, x, repos } = app;
  const logger = app.logger.child({ job: "engagement" });

  if (!niche.engagement.enabled && !niche.mentions.enabled) {
    logger.debug("Engagement and mentions are disabled for this niche");
    return null;
  }
  if (!ai) {
    logger.warn("AI_PROVIDER is none; cannot draft replies");
    return null;
  }

  const engine = new EngagementEngine({ ai, x, posts: repos.posts, engagements: repos.engagements, logger });
  const limits = { maxRepliesPerHour: env.MAX_REPLIES_PER_HOUR, maxRepliesPerDay: env.MAX_REPLIES_PER_DAY };

  return withBotRun(
    repos.runs,
    { niche: niche.niche.name, type: "ENGAGEMENT", dryRun: env.DRY_RUN },
    async () => {
      // Deliver first so approved replies don't wait behind new drafts for budget.
      const delivery = await engine.deliver(niche, limits, env.DRY_RUN);
      // Mentions first: people who addressed the bot directly get priority for the shared budget.
      const mentions = niche.mentions.enabled ? await engine.draftMentions(niche, limits, env.DRY_RUN) : null;
      const search = niche.engagement.enabled ? await engine.draft(niche, limits, env.DRY_RUN) : null;
      return { delivery, mentions, search };
    },
  );
}
