import type { NormalizedPost } from "../types/index.js";
import { extractHashtags, matchTerms } from "../utils/text.js";
import { applyFilters, postAgeMinutes } from "./filters.js";
import type { DiscoveryContext } from "./query.js";

export interface ScoreBreakdown {
  keyword: number;
  hashtag: number;
  /** null when no includeAuthors are configured (weight is then ignored). */
  author: number | null;
  engagement: number;
  recency: number;
}

export interface RelevanceResult {
  score: number;
  matchedKeywords: string[];
  matchedHashtags: string[];
  breakdown: ScoreBreakdown;
}

export interface PostEvaluation extends RelevanceResult {
  passedFilters: boolean;
  filterReasons: string[];
  excludedMatches: string[];
  /** Passed every filter and met the niche's minimum relevance score. */
  eligible: boolean;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Weighted interactions on a log scale, so a few viral posts don't dominate. */
export function engagementScore(post: NormalizedPost, target: number): number {
  const { likes, replies, reposts, quotes } = post.metrics;
  const weighted = likes + 2 * replies + 3 * (reposts + quotes);
  return clamp01(Math.log10(1 + weighted) / Math.log10(1 + target));
}

/** 1 at the minimum allowed age, falling linearly to 0 at the maximum. */
export function recencyScore(ageMinutes: number, minAge: number, maxAge: number): number {
  return clamp01(1 - (ageMinutes - minAge) / (maxAge - minAge));
}

export function scoreRelevance(
  post: NormalizedPost,
  ctx: DiscoveryContext,
  now: Date,
): RelevanceResult {
  const { scoring, targeting, filters } = ctx.config;

  const matchedKeywords = matchTerms(post.text, ctx.keywords);
  const postHashtags = new Set(extractHashtags(post.text));
  const matchedHashtags = ctx.hashtags.filter((tag) => postHashtags.has(tag));

  const username = post.author?.username.toLowerCase();
  const breakdown: ScoreBreakdown = {
    keyword: clamp01(matchedKeywords.length / scoring.keywordSaturation),
    hashtag: matchedHashtags.length > 0 ? 1 : 0,
    author:
      targeting.includeAuthors.length === 0
        ? null
        : username && targeting.includeAuthors.includes(username)
          ? 1
          : 0,
    engagement: engagementScore(post, scoring.engagementTarget),
    recency: recencyScore(
      postAgeMinutes(post, now),
      filters.minPostAgeMinutes,
      filters.maxPostAgeMinutes,
    ),
  };

  let weighted = 0;
  let totalWeight = 0;
  for (const key of Object.keys(breakdown) as (keyof ScoreBreakdown)[]) {
    const value = breakdown[key];
    if (value === null) continue;
    weighted += scoring.weights[key] * value;
    totalWeight += scoring.weights[key];
  }
  const score = totalWeight === 0 ? 0 : Math.round((weighted / totalWeight) * 10_000) / 10_000;

  return { score, matchedKeywords, matchedHashtags, breakdown };
}

/** Runs filters and scoring together. */
export function evaluatePost(
  post: NormalizedPost,
  ctx: DiscoveryContext,
  now: Date = new Date(),
): PostEvaluation {
  const filters = applyFilters(post, ctx, now);
  const relevance = scoreRelevance(post, ctx, now);
  return {
    ...relevance,
    passedFilters: filters.passed,
    filterReasons: filters.reasons,
    excludedMatches: filters.excludedMatches,
    eligible: filters.passed && relevance.score >= ctx.config.niche.minimumRelevanceScore,
  };
}
