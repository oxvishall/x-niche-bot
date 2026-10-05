import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../../src/ai/provider.js";
import type { NicheConfigInput } from "../../src/config/niche.schema.js";
import { MentionDiscovery, mentionFilterReasons } from "../../src/discovery/mentions.js";
import { createDiscoveryContext } from "../../src/discovery/query.js";
import { EngagementEngine } from "../../src/engagement/engagement-engine.js";
import { runReviewCommand } from "../../src/engagement/review.js";
import type { NormalizedPost } from "../../src/types/index.js";
import type { GetMentionsParams, MentionsResult, XClient } from "../../src/x/client.js";
import { InMemoryDiscoveredPostRepository, InMemoryEngagementRepository, InMemoryRunRepository } from "../fakes.js";
import { makeNiche, makePost, minutesAgo, NOW, silentLogger } from "../helpers.js";

const ME = { id: "bot-user", username: "bot" };
const limits = { maxRepliesPerHour: 5, maxRepliesPerDay: 30 };
const REPLY = "Mostly oracle lag: prices moved faster than the feed updated, so liquidations fired late.";

function mention(id: string, overrides: Partial<NormalizedPost> = {}) {
  return makePost({
    id,
    authorId: `author-${id}`,
    author: { id: `author-${id}`, username: `user${id}` },
    text: "@bot what actually caused the cascade yesterday?",
    createdAt: minutesAgo(30),
    ...overrides,
  });
}

async function setup(overrides: Partial<NicheConfigInput> = {}, mentions: Partial<MentionsResult> = {}) {
  const config = makeNiche({ ...overrides, mentions: { enabled: true, ...overrides.mentions } });
  const createReply = vi.fn(async ({ text }: { text: string }) => ({ id: "reply-1", text }));
  const getMentions = vi.fn(async (_params: GetMentionsParams) => ({ posts: [], referencedPosts: new Map(), ...mentions }));
  const x = { getMentions, createReply } as unknown as XClient;
  const generate = vi.fn().mockResolvedValue({ text: REPLY, model: "m" });
  const ai = { name: "fake", generate } as AiProvider & { generate: ReturnType<typeof vi.fn> };

  const runs = new InMemoryRunRepository();
  const posts = new InMemoryDiscoveredPostRepository();
  const engagements = new InMemoryEngagementRepository(posts, () => NOW);
  const discovery = new MentionDiscovery({ x, runs, posts, logger: silentLogger });
  const engine = new EngagementEngine({ ai, x, posts, engagements, logger: silentLogger });
  const ctx = createDiscoveryContext(config, "en", ME.id);
  return { config, ctx, discovery, engine, engagements, posts, runs, getMentions, createReply, generate };
}

describe("mention filters", () => {
  it("rejects own posts, reposts, excluded authors/keywords and old mentions", () => {
    const ctx = createDiscoveryContext(makeNiche({ targeting: { excludeAuthors: ["spammer"] } }), "en");
    const reasons = (post: NormalizedPost) => mentionFilterReasons(post, ctx, ME.id, 24, NOW).reasons;

    expect(reasons(mention("1"))).toEqual([]);
    expect(reasons(mention("2", { authorId: ME.id }))).toEqual(["own-post"]);
    expect(reasons(mention("3", { isRepost: true }))).toEqual(["repost"]);
    expect(reasons(mention("4", { author: { id: "x", username: "Spammer" } }))).toEqual(["excluded-author"]);
    expect(reasons(mention("5", { text: "@bot join my giveaway" }))).toEqual(["excluded-keyword"]);
    expect(reasons(mention("6", { createdAt: minutesAgo(25 * 60) }))).toEqual(["too-old"]);
  });
});

describe("MentionDiscovery", () => {
  it("stores mentions with thread context and advances the cursor", async () => {
    const parent = makePost({ id: "50", text: "The cascade started on the ETH market" });
    const { ctx, discovery, posts, runs, getMentions } = await setup(
      {},
      {
        posts: [mention("100", { inReplyToPostId: "50" }), mention("101", { authorId: ME.id })],
        referencedPosts: new Map([["50", parent]]),
        newestId: "101",
      },
    );

    const stats = await discovery.run(ctx, ME, undefined, NOW);

    expect(stats).toMatchObject({ fetched: 2, eligible: 1, created: 2 });
    const stored = posts.rows.get("test-niche:100")!;
    expect(stored).toMatchObject({ origin: "MENTION", parentText: "The cascade started on the ETH market" });
    expect(posts.rows.get("test-niche:101")!.evaluation.filterReasons).toEqual(["own-post"]);

    await discovery.run(ctx, ME, undefined, NOW);
    expect(getMentions.mock.calls[1]![0]).toMatchObject({ userId: ME.id, sinceId: "101" });
    expect(runs.searchRuns[0]!.query).toBe(`mentions:${ME.id}`);
  });
});

describe("mention replies", () => {
  it("drafts API-delivered replies with thread context, ignoring relevance score", async () => {
    const { ctx, discovery, engine, engagements, generate, config } = await setup(
      {},
      {
        posts: [mention("100", { inReplyToPostId: "50", text: "@bot thoughts?" })],
        referencedPosts: new Map([["50", makePost({ id: "50", text: "Parent: oracle lag in the ETH market" })]]),
      },
    );
    await discovery.run(ctx, ME, undefined, NOW);

    const stats = await engine.draftMentions(config, limits, true, NOW);

    expect(stats.drafted).toBe(1);
    expect(engagements.rows[0]).toMatchObject({ status: "PENDING_REVIEW", delivery: "API", content: REPLY });
    const request = generate.mock.calls[0]![0];
    expect(request.system).toContain("someone mentioned you");
    expect(request.prompt).toContain("Parent: oracle lag in the ETH market");
  });

  it("does not mix mentions into search drafting", async () => {
    const { ctx, discovery, engine, config } = await setup(
      { engagement: { enabled: true } },
      { posts: [mention("100")] },
    );
    await discovery.run(ctx, ME, undefined, NOW);
    expect((await engine.draft(config, limits, true, NOW)).candidates).toBe(0);
    expect((await engine.draftMentions(config, limits, true, NOW)).candidates).toBe(1);
  });

  it("delivers approved mention replies via the API even when search delivery is intent", async () => {
    const { ctx, discovery, engine, engagements, createReply, config } = await setup(
      { engagement: { delivery: "intent" } },
      { posts: [mention("100")] },
    );
    await discovery.run(ctx, ME, undefined, NOW);
    await engine.draftMentions(config, limits, false, NOW);

    const approve = await runReviewCommand(["approve", engagements.rows[0]!.id], config, engagements);
    expect(approve[0]).toContain("It will be posted by the next engagement run");

    const stats = await engine.deliver(config, limits, false, NOW);
    expect(stats.posted).toBe(1);
    expect(createReply).toHaveBeenCalledWith({ inReplyToPostId: "100", text: REPLY });
    expect(engagements.rows[0]).toMatchObject({ status: "POSTED", externalId: "reply-1" });
  });

  it("approves immediately in auto mode and respects the per-author limit", async () => {
    const { ctx, discovery, engine, engagements, config } = await setup(
      { mentions: { mode: "auto", maxRepliesPerAuthorPerDay: 1 } },
      {
        posts: [
          mention("100", { authorId: "same" }),
          mention("101", { authorId: "same", text: "@bot and another question about funding rates?" }),
        ],
      },
    );
    await discovery.run(ctx, ME, undefined, NOW);

    const stats = await engine.draftMentions(config, limits, false, NOW);
    expect(stats).toMatchObject({ drafted: 1, authorLimited: 1 });
    expect(engagements.rows[0]).toMatchObject({ status: "APPROVED", delivery: "API" });
  });
});
