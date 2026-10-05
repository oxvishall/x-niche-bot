import type { Logger } from "pino";
import type {
  DiscoveredPostRepository,
  EvaluatedPost,
} from "../database/repositories/discovered-post-repository.js";
import type { RunRepository } from "../database/repositories/run-repository.js";
import type { NormalizedPost } from "../types/index.js";
import type { XClient } from "../x/client.js";
import { XRateLimitError } from "../x/errors.js";
import { buildSearchQuery, MAX_QUERY_LENGTH, type DiscoveryContext } from "./query.js";
import { evaluatePost } from "./relevance.js";

export interface DiscoveryEngineDeps {
  x: XClient;
  runs: RunRepository;
  posts: DiscoveredPostRepository;
  logger: Logger;
}

export interface DiscoveryOptions {
  maxResults: number;
  lookbackMinutes: number;
}

export interface DiscoveryStats {
  queries: number;
  failedQueries: number;
  fetched: number;
  unique: number;
  eligible: number;
  created: number;
  updated: number;
  rateLimited: boolean;
}

/**
 * Runs every configured search query, de-duplicates the results, evaluates
 * each post against the niche and stores everything.
 */
export class DiscoveryEngine {
  constructor(private readonly deps: DiscoveryEngineDeps) {}

  async run(
    ctx: DiscoveryContext,
    options: DiscoveryOptions,
    botRunId?: string,
    now: Date = new Date(),
  ): Promise<DiscoveryStats> {
    const { logger } = this.deps;
    const niche = ctx.config.niche.name;
    const stats: DiscoveryStats = {
      queries: 0,
      failedQueries: 0,
      fetched: 0,
      unique: 0,
      eligible: 0,
      created: 0,
      updated: 0,
      rateLimited: false,
    };
    const found = new Map<string, { post: NormalizedPost; searchRunId: string }>();

    for (const baseQuery of ctx.config.niche.searchQueries) {
      const query = buildSearchQuery(baseQuery, {
        languages: ctx.languages,
        excludeReplies: ctx.config.search.excludeReplies,
        excludeQuotes: ctx.config.search.excludeQuotes,
      });
      if (query.length > MAX_QUERY_LENGTH) {
        logger.warn({ query, length: query.length }, "Search query exceeds X's length limit; skipping");
        stats.failedQueries++;
        continue;
      }

      stats.queries++;
      const searchRunId = await this.deps.runs.startSearchRun({
        niche,
        query,
        ...(botRunId && { botRunId }),
      });

      try {
        const posts = await this.searchQuery(query, ctx, options, now);
        for (const post of posts.items) {
          if (!found.has(post.id)) found.set(post.id, { post, searchRunId });
        }
        stats.fetched += posts.items.length;
        await this.deps.runs.finishSearchRun(searchRunId, {
          status: "SUCCEEDED",
          resultCount: posts.items.length,
          ...(posts.newestId && { newestId: posts.newestId }),
        });
      } catch (error) {
        stats.failedQueries++;
        await this.deps.runs.finishSearchRun(searchRunId, {
          status: "FAILED",
          resultCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof XRateLimitError) {
          logger.warn({ resetAt: error.resetAt }, "Rate limited by X; stopping discovery for this run");
          stats.rateLimited = true;
          break;
        }
        logger.error({ err: error, query }, "Search query failed");
      }
    }

    const evaluated: EvaluatedPost[] = [...found.values()].map(({ post, searchRunId }) => ({
      post,
      searchRunId,
      evaluation: evaluatePost(post, ctx, now),
    }));
    stats.unique = evaluated.length;
    stats.eligible = evaluated.filter((e) => e.evaluation.eligible).length;

    const { created, updated } = await this.deps.posts.upsertMany(niche, evaluated);
    stats.created = created;
    stats.updated = updated;

    logger.info({ niche, ...stats }, "Discovery finished");
    return stats;
  }

  /** Fetches all pages for one query, newer than the stored cursor. */
  private async searchQuery(
    query: string,
    ctx: DiscoveryContext,
    options: DiscoveryOptions,
    now: Date,
  ): Promise<{ items: NormalizedPost[]; newestId?: string }> {
    const sinceId = await this.deps.runs.getSearchCursor(ctx.config.niche.name, query);
    const startTime = new Date(now.getTime() - options.lookbackMinutes * 60_000);
    const items: NormalizedPost[] = [];
    let newestId: string | undefined;
    let nextToken: string | undefined;

    for (let page = 0; page < ctx.config.search.maxPagesPerQuery; page++) {
      const result = await this.deps.x.searchPosts({
        query,
        maxResults: options.maxResults,
        startTime,
        ...(sinceId && { sinceId }),
        ...(nextToken && { nextToken }),
      });
      items.push(...result.posts);
      // X returns newest first; the first page holds the newest ID.
      newestId ??= result.newestId;
      nextToken = result.nextToken;
      if (!nextToken) break;
    }
    return { items, ...(newestId && { newestId }) };
  }
}
