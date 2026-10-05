import type { App } from "../app.js";
import { EngagementEngine, type DeliveryStats, type DraftStats } from "../engagement/engagement-engine.js";
import { withBotRun } from "./run-tracker.js";

export interface EngagementRunStats {
  draft: DraftStats;
  delivery: DeliveryStats;
}

/** Drafts replies for eligible posts, then delivers approved ones (API delivery only). */
export async function runEngagement(app: App): Promise<EngagementRunStats | null> {
  const { env, niche, ai, x, repos } = app;
  const logger = app.logger.child({ job: "engagement" });

  if (!niche.engagement.enabled) {
    logger.debug("Engagement is disabled for this niche");
    return null;
  }
  if (!ai) {
    logger.warn("AI_PROVIDER is none; cannot draft replies");
    return null;
  }
  if (niche.engagement.delivery === "api" && !x) {
    logger.warn('Delivery "api" needs X credentials; skipping engagement');
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
      const draft = await engine.draft(niche, limits, env.DRY_RUN);
      return { draft, delivery };
    },
  );
}
