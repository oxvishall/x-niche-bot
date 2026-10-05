import { describe, expect, it, vi } from "vitest";
import { DiscoveryEngine } from "../../src/discovery/discovery-engine.js";
import { createDiscoveryContext } from "../../src/discovery/query.js";
import type { SearchPostsParams, SearchPostsResult, XClient } from "../../src/x/client.js";
import { XRateLimitError } from "../../src/x/errors.js";
import { InMemoryDiscoveredPostRepository, InMemoryRunRepository } from "../fakes.js";
import { makeNiche, makePost, NOW, silentLogger } from "../helpers.js";

function fakeX(search: (params: SearchPostsParams) => Promise<SearchPostsResult>) {
  return { searchPosts: vi.fn(search) } as unknown as XClient & {
    searchPosts: ReturnType<typeof vi.fn>;
  };
}

const options = { maxResults: 25, lookbackMinutes: 60 };

function setup(x: XClient, niche = makeNiche({ niche: { name: "n", searchQueries: ["defi", "#DeFi"], languages: ["en"] } })) {
  const runs = new InMemoryRunRepository();
  const posts = new InMemoryDiscoveredPostRepository();
  const engine = new DiscoveryEngine({ x, runs, posts, logger: silentLogger });
  const ctx = createDiscoveryContext(niche, "en");
  return { runs, posts, engine, ctx };
}

describe("DiscoveryEngine", () => {
  it("searches each query, de-duplicates results and stores evaluations", async () => {
    const shared = makePost({ id: "1", text: "Decentralized finance and #DeFi lending keep growing fast" });
    const x = fakeX(async ({ query }) =>
      query.includes("#DeFi")
        ? { posts: [shared], newestId: "1" }
        : { posts: [shared, makePost({ id: "2", text: "Coffee is great, nothing else to say about it" })], newestId: "2" },
    );
    const { runs, posts, engine, ctx } = setup(x);

    const stats = await engine.run(ctx, options, "bot-1", NOW);

    expect(stats).toMatchObject({ queries: 2, fetched: 3, unique: 2, created: 2, eligible: 1, failedQueries: 0 });
    expect(x.searchPosts).toHaveBeenCalledWith(
      expect.objectContaining({ query: "(defi) lang:en -is:retweet -is:reply", maxResults: 25 }),
    );
    expect(posts.rows.get("n:1")?.evaluation.eligible).toBe(true);
    expect(posts.rows.get("n:2")?.evaluation.eligible).toBe(false);
    expect(runs.searchRuns.map((r) => r.newestId)).toEqual(["2", "1"]);
  });

  it("uses the stored cursor as since_id on the next run", async () => {
    const x = fakeX(async () => ({ posts: [makePost({ id: "5" })], newestId: "5" }));
    const { engine, ctx } = setup(x, makeNiche({ niche: { name: "n", searchQueries: ["defi"] } }));

    await engine.run(ctx, options, undefined, NOW);
    await engine.run(ctx, options, undefined, NOW);

    expect(x.searchPosts.mock.calls[0]![0].sinceId).toBeUndefined();
    expect(x.searchPosts.mock.calls[1]![0].sinceId).toBe("5");
  });

  it("follows pagination up to maxPagesPerQuery", async () => {
    const x = fakeX(async ({ nextToken }) => ({
      posts: [makePost({ id: nextToken ?? "first" })],
      ...(nextToken ? { nextToken: `${nextToken}x` } : { newestId: "first", nextToken: "p2" }),
    }));
    const { engine, ctx } = setup(
      x,
      makeNiche({ niche: { name: "n", searchQueries: ["defi"] }, search: { maxPagesPerQuery: 3 } }),
    );

    const stats = await engine.run(ctx, options, undefined, NOW);
    expect(x.searchPosts).toHaveBeenCalledTimes(3);
    expect(stats.unique).toBe(3);
  });

  it("stops after a rate limit but keeps results already fetched", async () => {
    const x = fakeX(async ({ query }) => {
      if (query.includes("#DeFi")) throw new XRateLimitError("GET /2/tweets/search/recent");
      return { posts: [makePost({ id: "7" })], newestId: "7" };
    });
    const { runs, engine, ctx } = setup(
      x,
      makeNiche({ niche: { name: "n", searchQueries: ["defi", "#DeFi", "web3"] } }),
    );

    const stats = await engine.run(ctx, options, undefined, NOW);
    expect(stats).toMatchObject({ rateLimited: true, failedQueries: 1, created: 1 });
    expect(x.searchPosts).toHaveBeenCalledTimes(2);
    expect(runs.searchRuns.map((r) => r.status)).toEqual(["SUCCEEDED", "FAILED"]);
  });

  it("continues with other queries when one fails", async () => {
    const x = fakeX(async ({ query }) => {
      if (query.includes("#DeFi")) throw new Error("boom");
      return { posts: [makePost({ id: "8" })] };
    });
    const { engine, ctx } = setup(x);
    const stats = await engine.run(ctx, options, undefined, NOW);
    expect(stats).toMatchObject({ queries: 2, failedQueries: 1, created: 1, rateLimited: false });
  });
});
