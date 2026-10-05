import type { Logger } from "pino";
import { AiRefusalError, type AiProvider } from "../ai/provider.js";
import type { NicheConfig } from "../config/niche.schema.js";
import { validateContent, type ContentRules } from "../content/validate.js";
import type {
  CandidatePost,
  DiscoveredPostRepository,
} from "../database/repositories/discovered-post-repository.js";
import type { EngagementRepository } from "../database/repositories/engagement-repository.js";
import { DAY_MS, effectiveLimit, HOUR_MS, remainingBudget } from "../utils/rate-limit.js";
import type { XClient } from "../x/client.js";
import { DRY_RUN_ID_PREFIX } from "../x/dry-run-client.js";
import { XApiError, XRateLimitError } from "../x/errors.js";
import { buildReplyPrompt } from "./reply-prompt.js";

export interface EngagementLimits {
  maxRepliesPerHour: number;
  maxRepliesPerDay: number;
}

export interface EngagementEngineDeps {
  ai: AiProvider;
  posts: DiscoveredPostRepository;
  engagements: EngagementRepository;
  logger: Logger;
  /** Required only for API delivery. */
  x?: XClient | null;
}

export interface DraftStats {
  candidates: number;
  drafted: number;
  skipped: number;
  invalid: number;
  authorLimited: number;
  budget: number;
}

export interface DeliveryStats {
  attempted: number;
  posted: number;
  failed: number;
  budget: number;
  rateLimited: boolean;
}

const RECENT_CONTENT_WINDOW = 50;

/**
 * Drafts replies for eligible posts and (for API delivery) posts approved
 * ones, enforcing per-author, hourly and daily limits.
 */
export class EngagementEngine {
  constructor(private readonly deps: EngagementEngineDeps) {}

  async draft(
    config: NicheConfig,
    limits: EngagementLimits,
    dryRun: boolean,
    now: Date = new Date(),
  ): Promise<DraftStats> {
    const { engagement, filters, niche } = config;
    const { engagements, logger } = this.deps;
    const stats: DraftStats = { candidates: 0, drafted: 0, skipped: 0, invalid: 0, authorLimited: 0, budget: 0 };

    stats.budget = await this.draftBudget(config, limits, dryRun, now);
    if (stats.budget === 0) {
      logger.info({ niche: niche.name }, "No drafting budget left this run");
      return stats;
    }

    const candidates = await this.deps.posts.findCandidates({
      niche: niche.name,
      minScore: niche.minimumRelevanceScore,
      postedAfter: new Date(now.getTime() - filters.maxPostAgeMinutes * 60_000),
      postedBefore: new Date(now.getTime() - filters.minPostAgeMinutes * 60_000),
      limit: stats.budget * 3,
    });
    stats.candidates = candidates.length;

    const recent = await engagements.recentContents(niche.name, RECENT_CONTENT_WINDOW);
    const draftedAuthors = new Map<string, number>();

    for (const candidate of candidates) {
      if (stats.drafted >= stats.budget) break;

      const authorCount =
        (draftedAuthors.get(candidate.authorId) ?? 0) +
        (await engagements.countForAuthorSince(candidate.authorId, new Date(now.getTime() - DAY_MS)));
      if (authorCount >= engagement.maxRepliesPerAuthorPerDay) {
        stats.authorLimited++;
        continue;
      }

      const outcome = await this.draftOne(config, candidate, recent, dryRun);
      if (outcome === "stop") break;
      stats[outcome]++;
      if (outcome === "drafted") {
        draftedAuthors.set(candidate.authorId, (draftedAuthors.get(candidate.authorId) ?? 0) + 1);
      }
    }

    logger.info({ niche: niche.name, ...stats }, "Reply drafting finished");
    return stats;
  }

  /** Posts approved replies through the X API (delivery "api" only). */
  async deliver(
    config: NicheConfig,
    limits: EngagementLimits,
    dryRun: boolean,
    now: Date = new Date(),
  ): Promise<DeliveryStats> {
    const { engagements, logger, x } = this.deps;
    const niche = config.niche.name;
    const stats: DeliveryStats = { attempted: 0, posted: 0, failed: 0, budget: 0, rateLimited: false };
    if (config.engagement.delivery !== "api") return stats;
    if (!x) throw new Error("API delivery requires X credentials");

    stats.budget = await this.postingBudget(config, limits, dryRun, now);
    const approved = await engagements.list(niche, ["APPROVED"], stats.budget);

    for (const item of approved) {
      stats.attempted++;
      try {
        const created = await x.createReply({ inReplyToPostId: item.targetExternalId, text: item.content! });
        await engagements.markPosted(item.id, created.id.startsWith(DRY_RUN_ID_PREFIX) ? null : created.id);
        stats.posted++;
      } catch (error) {
        if (error instanceof XRateLimitError) {
          stats.rateLimited = true;
          logger.warn({ resetAt: error.resetAt }, "Rate limited by X; stopping delivery");
          break;
        }
        if (error instanceof XApiError && error.retryable) {
          logger.warn({ err: error, engagementId: item.id }, "Reply failed; will retry next run");
          continue;
        }
        const message =
          error instanceof XApiError && error.status === 403
            ? `${error.message}. X only allows API replies when the author mentioned or quoted you (unless you have Enterprise access); consider delivery "intent".`
            : error instanceof Error
              ? error.message
              : String(error);
        await engagements.markFailed(item.id, message);
        stats.failed++;
        logger.error({ engagementId: item.id, error: message }, "Reply failed");
      }
    }

    logger.info({ niche, ...stats }, "Reply delivery finished");
    return stats;
  }

  private async draftOne(
    config: NicheConfig,
    candidate: CandidatePost,
    recent: string[],
    dryRun: boolean,
  ): Promise<"drafted" | "skipped" | "invalid" | "stop"> {
    const { ai, engagements, logger } = this.deps;
    const { engagement, voice, niche } = config;
    const base = {
      niche: niche.name,
      discoveredPostId: candidate.id,
      targetExternalId: candidate.externalId,
      targetAuthorId: candidate.authorId,
      dryRun,
    };
    const rules: ContentRules = {
      maxLength: engagement.maxLength,
      allowHashtags: engagement.allowHashtags,
      allowLinks: engagement.allowLinks,
      allowedMentions: [],
      bannedPhrases: voice.bannedPhrases,
      excludedKeywords: niche.excludedKeywords,
      similarityThreshold: engagement.similarityThreshold,
      recentTexts: recent,
    };

    let issues: string[] = [];
    let model: string | undefined;
    // One retry, telling the model what was wrong with the first attempt.
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = buildReplyPrompt(config, candidate, recent);
      if (issues.length) {
        request.prompt += `\n\nYour previous draft was rejected for: ${issues.join(", ")}. Write a different reply that avoids these problems, or output SKIP.`;
      }

      let raw: string;
      try {
        const result = await ai.generate(request);
        raw = result.text;
        model = result.model;
      } catch (error) {
        if (error instanceof AiRefusalError) {
          await engagements.create({ ...base, status: "SKIPPED", error: error.message });
          return "skipped";
        }
        logger.error({ err: error }, "AI generation failed; stopping drafting for this run");
        return "stop";
      }

      const result = validateContent(raw, rules);
      if (result.status === "skip") {
        await engagements.create({ ...base, status: "SKIPPED", ...(model && { aiModel: model }), validationIssues: ["model-skipped"] });
        return "skipped";
      }
      if (result.status === "ok") {
        const id = await engagements.create({
          ...base,
          status: engagement.mode === "auto" ? "APPROVED" : "PENDING_REVIEW",
          content: result.text,
          contentHash: result.hash,
          ...(model && { aiModel: model }),
        });
        if (id) recent.unshift(result.text);
        return id ? "drafted" : "skipped";
      }
      issues = result.issues;
    }

    await engagements.create({ ...base, status: "SKIPPED", ...(model && { aiModel: model }), validationIssues: issues });
    return "invalid";
  }

  /** Auto mode: bounded by the posting budget. Review mode: by the review queue size. */
  private async draftBudget(
    config: NicheConfig,
    limits: EngagementLimits,
    dryRun: boolean,
    now: Date,
  ): Promise<number> {
    const { engagement, niche } = config;
    if (engagement.mode === "auto") {
      const approved = await this.deps.engagements.countByStatus(niche.name, "APPROVED");
      const budget = await this.postingBudget(config, limits, dryRun, now);
      return Math.min(engagement.maxDraftsPerRun, Math.max(0, budget - approved));
    }
    const pending = await this.deps.engagements.countByStatus(niche.name, "PENDING_REVIEW");
    return Math.min(engagement.maxDraftsPerRun, Math.max(0, engagement.maxPendingReviews - pending));
  }

  private async postingBudget(
    config: NicheConfig,
    limits: EngagementLimits,
    dryRun: boolean,
    now: Date,
  ): Promise<number> {
    const niche = config.niche.name;
    const [lastHour, lastDay] = await Promise.all([
      this.deps.engagements.countPostedSince(niche, new Date(now.getTime() - HOUR_MS), dryRun),
      this.deps.engagements.countPostedSince(niche, new Date(now.getTime() - DAY_MS), dryRun),
    ]);
    return remainingBudget(
      { limit: effectiveLimit(limits.maxRepliesPerHour, config.engagement.maxRepliesPerHour), used: lastHour },
      { limit: limits.maxRepliesPerDay, used: lastDay },
    );
  }
}
