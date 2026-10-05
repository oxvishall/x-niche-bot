import type { Logger } from "pino";
import type {
  DiscoveredPostRepository,
  EvaluatedPost,
} from "../database/repositories/discovered-post-repository.js";
import type { RunRepository } from "../database/repositories/run-repository.js";
import type { NormalizedAuthor, NormalizedPost } from "../types/index.js";
import { HOUR_MS } from "../utils/rate-limit.js";
import { matchTerms } from "../utils/text.js";
import type { XClient } from "../x/client.js";
import type { DiscoveryContext } from "./query.js";
import { scoreRelevance } from "./relevance.js";

export interface MentionStats {
  fetched: number;
  eligible: number;
  created: number;
  updated: number;
}

/** Hard rules for mentions. Relevance scoring doesn't apply: they addressed us directly. */
export function mentionFilterReasons(
  post: NormalizedPost,
  ctx: DiscoveryContext,
  ownUserId: string,
  maxAgeHours: number,
  now: Date,
): { reasons: string[]; excludedMatches: string[] } {
  const reasons: string[] = [];
  if (post.authorId === ownUserId) reasons.push("own-post");
  if (post.isRepost) reasons.push("repost");
  const username = post.author?.username.toLowerCase();
  if (username && ctx.config.targeting.excludeAuthors.includes(username)) reasons.push("excluded-author");
  const excludedMatches = matchTerms(post.text, ctx.config.niche.excludedKeywords);
  if (excludedMatches.length) reasons.push("excluded-keyword");
  if (now.getTime() - post.createdAt.getTime() > maxAgeHours * HOUR_MS) reasons.push("too-old");
  return { reasons, excludedMatches };
}

/** Fetches new mentions of the bot (with thread context) and stores them as MENTION posts. */
export class MentionDiscovery {
  constructor(
    private readonly deps: {
      x: XClient;
      runs: RunRepository;
      posts: DiscoveredPostRepository;
      logger: Logger;
    },
  ) {}

  async run(ctx: DiscoveryContext, me: NormalizedAuthor, botRunId?: string, now: Date = new Date()): Promise<MentionStats> {
    const { x, runs, posts, logger } = this.deps;
    const { mentions, niche } = ctx.config;
    // Mentions share the search cursor table, keyed by a pseudo-query.
    const cursorKey = `mentions:${me.id}`;
    const stats: MentionStats = { fetched: 0, eligible: 0, created: 0, updated: 0 };

    const sinceId = await runs.getSearchCursor(niche.name, cursorKey);
    const searchRunId = await runs.startSearchRun({ niche: niche.name, query: cursorKey, ...(botRunId && { botRunId }) });

    try {
      const result = await x.getMentions({
        userId: me.id,
        maxResults: mentions.maxResults,
        startTime: new Date(now.getTime() - mentions.maxAgeHours * HOUR_MS),
        ...(sinceId && { sinceId }),
      });
      stats.fetched = result.posts.length;

      const items: EvaluatedPost[] = result.posts.map((post) => {
        const { reasons, excludedMatches } = mentionFilterReasons(post, ctx, me.id, mentions.maxAgeHours, now);
        const parent = post.inReplyToPostId ? result.referencedPosts.get(post.inReplyToPostId) : undefined;
        return {
          post,
          searchRunId,
          origin: "MENTION",
          ...(parent && { parentText: parent.text }),
          evaluation: {
            ...scoreRelevance(post, ctx, now),
            passedFilters: reasons.length === 0,
            filterReasons: reasons,
            excludedMatches,
            eligible: reasons.length === 0,
          },
        };
      });
      stats.eligible = items.filter((i) => i.evaluation.eligible).length;
      Object.assign(stats, await posts.upsertMany(niche.name, items));

      await runs.finishSearchRun(searchRunId, {
        status: "SUCCEEDED",
        resultCount: stats.fetched,
        ...(result.newestId && { newestId: result.newestId }),
      });
    } catch (error) {
      await runs.finishSearchRun(searchRunId, {
        status: "FAILED",
        resultCount: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    logger.info({ niche: niche.name, ...stats }, "Mention discovery finished");
    return stats;
  }
}
