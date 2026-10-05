import type { Logger } from "pino";
import { AiRefusalError, type AiProvider } from "../ai/provider.js";
import type { NicheConfig } from "../config/niche.schema.js";
import { validateContent, type ContentRules } from "../content/validate.js";
import type { DiscoveredPostRepository } from "../database/repositories/discovered-post-repository.js";
import type { PublishedPostRepository } from "../database/repositories/published-post-repository.js";
import { DAY_MS, effectiveLimit, remainingBudget } from "../utils/rate-limit.js";
import type { XClient } from "../x/client.js";
import { DRY_RUN_ID_PREFIX } from "../x/dry-run-client.js";
import { XApiError } from "../x/errors.js";
import { buildPostPrompt } from "./post-prompt.js";

export interface PublishingEngineDeps {
  ai: AiProvider;
  published: PublishedPostRepository;
  discovered: DiscoveredPostRepository;
  poster: Pick<XClient, "createPost">;
  logger: Logger;
}

export interface PublishLimits {
  maxPostsPerDay: number;
}

export type PublishResult =
  | { action: "posted"; id: string; externalId: string | null }
  | { action: "drafted"; id: string }
  | { action: "failed"; error: string }
  | { action: "idle"; reason: string };

/** Pending drafts allowed in review mode before generation pauses. */
const MAX_PENDING_POST_REVIEWS = 3;
const RECENT_POST_WINDOW = 50;
const CONTEXT_POSTS = 5;

/** Returns the hour (0–23) of `now` in the given IANA timezone. */
export function hourIn(now: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now),
  );
}

export function withinActiveHours(config: NicheConfig, now: Date): boolean {
  const hours = config.publishing.activeHours;
  if (!hours) return true;
  const hour = hourIn(now, hours.timezone);
  return hours.start < hours.end
    ? hour >= hours.start && hour < hours.end
    : hour >= hours.start || hour < hours.end; // window wraps midnight
}

/** Picks the configured topic used least recently (never-used topics first). */
export function pickTopic(topics: string[], lastUsed: Map<string, Date>): string | undefined {
  return [...topics].sort(
    (a, b) => (lastUsed.get(a)?.getTime() ?? 0) - (lastUsed.get(b)?.getTime() ?? 0),
  )[0];
}

/**
 * Publishes at most one original post per run, respecting the daily cap,
 * minimum spacing and active hours. In review mode it keeps a small queue
 * of drafts for approval instead of posting new content directly.
 */
export class PublishingEngine {
  constructor(private readonly deps: PublishingEngineDeps) {}

  async run(
    config: NicheConfig,
    limits: PublishLimits,
    dryRun: boolean,
    now: Date = new Date(),
  ): Promise<PublishResult> {
    const { publishing, niche } = config;
    const { published, logger } = this.deps;

    const blocked = await this.postingBlockedReason(config, limits, dryRun, now);

    // Approved drafts go out first (only those drafted in the current mode, so a
    // dry run never consumes a live approval and vice versa).
    const [approved] = await published.list(niche.name, ["APPROVED"], 1, dryRun);
    if (approved) {
      if (blocked) return { action: "idle", reason: blocked };
      return this.post(approved.id, approved.content);
    }

    if (publishing.mode === "review") {
      const pending = await published.countByStatus(niche.name, "PENDING_REVIEW");
      if (pending >= MAX_PENDING_POST_REVIEWS) return { action: "idle", reason: "review queue full" };
    } else if (blocked) {
      return { action: "idle", reason: blocked };
    }

    const draft = await this.generate(config, now);
    if ("reason" in draft) {
      logger.info({ niche: niche.name, reason: draft.reason }, "No post generated");
      return { action: "idle", reason: draft.reason };
    }

    const base = {
      niche: niche.name,
      content: draft.text,
      contentHash: draft.hash,
      dryRun,
      ...(draft.topic && { topic: draft.topic }),
      ...(draft.model && { aiModel: draft.model }),
    };

    if (publishing.mode === "review") {
      const id = await published.create({ ...base, status: "PENDING_REVIEW" });
      logger.info({ id, topic: draft.topic }, "Post drafted for review");
      return { action: "drafted", id };
    }

    const id = await published.create({ ...base, status: "APPROVED" });
    return this.post(id, draft.text);
  }

  private async post(id: string, text: string): Promise<PublishResult> {
    const { published, poster, logger } = this.deps;
    try {
      const created = await poster.createPost({ text });
      const externalId = created.id.startsWith(DRY_RUN_ID_PREFIX) ? null : created.id;
      await published.markPosted(id, externalId);
      logger.info({ id, externalId }, "Post published");
      return { action: "posted", id, externalId };
    } catch (error) {
      if (error instanceof XApiError && error.retryable) {
        logger.warn({ err: error, id }, "Publishing failed; will retry next run");
        return { action: "idle", reason: `retryable error: ${error.message}` };
      }
      if (error instanceof XApiError && error.isDuplicateContent) {
        // An earlier attempt whose response was lost actually went through.
        await published.markPosted(id, null);
        logger.warn({ id }, "X reports duplicate content; treating the post as already published");
        return { action: "posted", id, externalId: null };
      }
      const message = error instanceof Error ? error.message : String(error);
      await published.markFailed(id, message);
      logger.error({ id, error: message }, "Publishing failed");
      return { action: "failed", error: message };
    }
  }

  private async postingBlockedReason(
    config: NicheConfig,
    limits: PublishLimits,
    dryRun: boolean,
    now: Date,
  ): Promise<string | null> {
    const { publishing, niche } = config;
    const { published } = this.deps;

    const cap = effectiveLimit(limits.maxPostsPerDay, publishing.postsPerDay);
    const today = await published.countPostedSince(niche.name, new Date(now.getTime() - DAY_MS), dryRun);
    if (remainingBudget({ limit: cap, used: today }) === 0) return `daily cap reached (${today}/${cap})`;

    const last = await published.lastPostedAt(niche.name, dryRun);
    const gapMs = publishing.minMinutesBetweenPosts * 60_000;
    if (last && now.getTime() - last.getTime() < gapMs) return "too soon after the last post";

    if (!withinActiveHours(config, now)) return "outside active hours";
    return null;
  }

  private async generate(
    config: NicheConfig,
    now: Date,
  ): Promise<{ text: string; hash: string; topic?: string; model?: string } | { reason: string }> {
    const { ai, published, discovered, logger } = this.deps;
    const { publishing, niche, voice } = config;

    const topic = pickTopic(publishing.topics, await published.topicLastUsed(niche.name));
    const recentPosts = await published.recentContents(niche.name, RECENT_POST_WINDOW);
    const contextPosts = publishing.useDiscoveredContext
      ? await discovered.findTopTexts(niche.name, new Date(now.getTime() - DAY_MS), CONTEXT_POSTS)
      : [];

    const rules: ContentRules = {
      maxLength: publishing.maxLength,
      allowHashtags: publishing.allowHashtags,
      allowLinks: publishing.allowLinks,
      allowedMentions: [],
      bannedPhrases: voice.bannedPhrases,
      excludedKeywords: niche.excludedKeywords,
      similarityThreshold: publishing.similarityThreshold,
      // Context posts are included so the bot can't copy what it was shown.
      recentTexts: [...recentPosts, ...contextPosts],
    };

    let issues: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = buildPostPrompt(config, { ...(topic && { topic }), contextPosts, recentPosts });
      if (issues.length) {
        request.prompt += `\n\nYour previous draft was rejected for: ${issues.join(", ")}. Write a different post that avoids these problems, or output SKIP.`;
      }

      let raw: string;
      let model: string;
      try {
        ({ text: raw, model } = await ai.generate(request));
      } catch (error) {
        if (error instanceof AiRefusalError) return { reason: error.message };
        logger.error({ err: error }, "AI generation failed");
        return { reason: "AI generation failed" };
      }

      const result = validateContent(raw, rules);
      if (result.status === "skip") return { reason: "model skipped" };
      if (result.status === "ok") {
        return { text: result.text, hash: result.hash, model, ...(topic && { topic }) };
      }
      issues = result.issues;
    }
    return { reason: `validation failed: ${issues.join(", ")}` };
  }
}
