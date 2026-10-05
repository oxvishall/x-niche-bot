import { describe, expect, it } from "vitest";
import { createDiscoveryContext } from "../../src/discovery/query.js";
import { applyFilters } from "../../src/discovery/filters.js";
import { engagementScore, evaluatePost, recencyScore } from "../../src/discovery/relevance.js";
import { makeNiche, makePost, minutesAgo, NOW } from "../helpers.js";

const ctx = createDiscoveryContext(makeNiche(), "en", "bot-user");

describe("applyFilters", () => {
  it("passes a normal on-topic post", () => {
    expect(applyFilters(makePost(), ctx, NOW)).toEqual({
      passed: true,
      reasons: [],
      excludedMatches: [],
    });
  });

  it.each([
    ["own-post", { authorId: "bot-user" }],
    ["repost", { isRepost: true }],
    ["reply", { inReplyToPostId: "999" }],
    ["language", { lang: "fr" }],
    ["too-new", { createdAt: minutesAgo(1) }],
    ["too-old", { createdAt: minutesAgo(800) }],
    ["too-short", { text: "defi! https://t.co/abc" }],
    ["hashtag-spam", { text: "Big news in defi today #a #b #c #d #e #f" }],
  ] as const)("rejects with reason %s", (reason, overrides) => {
    const result = applyFilters(makePost(overrides), ctx, NOW);
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  it("reports excluded keyword matches", () => {
    const result = applyFilters(makePost({ text: "Huge DeFi GIVEAWAY happening right now, join" }), ctx, NOW);
    expect(result.reasons).toContain("excluded-keyword");
    expect(result.excludedMatches).toEqual(["giveaway"]);
  });

  it("rejects excluded authors and low engagement", () => {
    const strict = createDiscoveryContext(
      makeNiche({
        targeting: { excludeAuthors: ["@Alice"] },
        filters: { minimumEngagement: { likes: 100 } },
      }),
      "en",
    );
    expect(applyFilters(makePost(), strict, NOW).reasons).toEqual(["excluded-author", "low-engagement"]);
  });
});

describe("scoring", () => {
  it("scales engagement logarithmically up to the target", () => {
    const quiet = makePost({ metrics: { likes: 0, replies: 0, reposts: 0, quotes: 0 } });
    const viral = makePost({ metrics: { likes: 5000, replies: 100, reposts: 50, quotes: 10 } });
    expect(engagementScore(quiet, 50)).toBe(0);
    expect(engagementScore(viral, 50)).toBe(1);
  });

  it("decays recency linearly across the allowed age window", () => {
    expect(recencyScore(10, 10, 110)).toBe(1);
    expect(recencyScore(60, 10, 110)).toBe(0.5);
    expect(recencyScore(200, 10, 110)).toBe(0);
  });

  it("scores on-topic posts above the threshold and off-topic posts below", () => {
    const onTopic = evaluatePost(
      makePost({ text: "Decentralized finance on Arbitrum: why lending is the next #DeFi wave" }),
      ctx,
      NOW,
    );
    expect(onTopic.matchedKeywords).toEqual(["defi", "decentralized finance", "arbitrum", "lending"]);
    expect(onTopic.matchedHashtags).toEqual(["defi"]);
    expect(onTopic.eligible).toBe(true);

    const offTopic = evaluatePost(
      makePost({ text: "Just had the best coffee of my life this morning, highly recommend" }),
      ctx,
      NOW,
    );
    expect(offTopic.matchedKeywords).toEqual([]);
    expect(offTopic.score).toBeLessThan(onTopic.score);
    expect(offTopic.eligible).toBe(false);
  });

  it("ignores the author weight unless includeAuthors is configured", () => {
    expect(evaluatePost(makePost(), ctx, NOW).breakdown.author).toBeNull();

    const targeted = createDiscoveryContext(makeNiche({ targeting: { includeAuthors: ["alice"] } }), "en");
    const result = evaluatePost(makePost(), targeted, NOW);
    expect(result.breakdown.author).toBe(1);
    expect(result.score).toBeGreaterThan(evaluatePost(makePost(), ctx, NOW).score);
  });

  it("is never eligible when a filter fails, regardless of score", () => {
    const result = evaluatePost(
      makePost({ text: "Decentralized finance #DeFi lending airdrop on arbitrum" }),
      ctx,
      NOW,
    );
    expect(result.score).toBeGreaterThan(0.4);
    expect(result.eligible).toBe(false);
  });
});
