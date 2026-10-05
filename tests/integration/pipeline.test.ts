import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../../src/ai/provider.js";
import { PrismaDiscoveredPostRepository } from "../../src/database/repositories/discovered-post-repository.js";
import { PrismaEngagementRepository } from "../../src/database/repositories/engagement-repository.js";
import { PrismaPublishedPostRepository } from "../../src/database/repositories/published-post-repository.js";
import { PrismaRunRepository } from "../../src/database/repositories/run-repository.js";
import { DiscoveryEngine } from "../../src/discovery/discovery-engine.js";
import { createDiscoveryContext } from "../../src/discovery/query.js";
import { EngagementEngine } from "../../src/engagement/engagement-engine.js";
import { runReviewCommand } from "../../src/engagement/review.js";
import { PublishingEngine } from "../../src/publishing/publishing-engine.js";
import { withBotRun } from "../../src/services/run-tracker.js";
import type { XClient } from "../../src/x/client.js";
import { dryRunPoster } from "../../src/x/dry-run-client.js";
import { makeNiche, makePost, silentLogger } from "../helpers.js";
import { resetDatabase, testPrisma } from "./db.js";

const prisma = testPrisma();
const repos = {
  runs: new PrismaRunRepository(prisma),
  posts: new PrismaDiscoveredPostRepository(prisma),
  engagements: new PrismaEngagementRepository(prisma),
  published: new PrismaPublishedPostRepository(prisma),
};

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

const ON_TOPIC = "Decentralized finance lending on Arbitrum keeps improving, #DeFi risk tooling too";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

describe("discover → draft → review → publish", () => {
  it("runs the full pipeline against Postgres", async () => {
    const config = makeNiche({
      engagement: { enabled: true, maxDraftsPerRun: 5 },
      publishing: { enabled: true, postsPerDay: 2, topics: ["liquidation risk"] },
    });
    const x = {
      searchPosts: vi.fn(async () => ({
        posts: [
          makePost({ id: "11", authorId: "a1", text: ON_TOPIC, createdAt: minutesAgo(20) }),
          makePost({ id: "12", authorId: "a2", text: `${ON_TOPIC} with better oracles`, createdAt: minutesAgo(25) }),
          makePost({ id: "13", authorId: "a3", text: "Massive airdrop giveaway, decentralized finance #DeFi", createdAt: minutesAgo(25) }),
        ],
        newestId: "13",
      })),
    } as unknown as XClient;
    const ai: AiProvider = {
      name: "fake",
      generate: vi
        .fn()
        .mockResolvedValueOnce({ text: "Which oracle setup handled the last volatility spike best for you?", model: "m" })
        .mockResolvedValueOnce({ text: "Do isolated markets actually reduce bad debt, or just move it around?", model: "m" })
        .mockResolvedValueOnce({ text: "Liquidation thresholds set in calm markets fail in fast ones. Stress-test them at 3x normal volatility.", model: "m" }),
    };

    // Discovery, tracked as a BotRun.
    const discovery = new DiscoveryEngine({ x, ...repos, logger: silentLogger });
    const ctx = createDiscoveryContext(config, "en", "bot-user");
    const stats = await withBotRun(repos.runs, { niche: "test-niche", type: "DISCOVERY", dryRun: true }, (id) =>
      discovery.run(ctx, { maxResults: 25, lookbackMinutes: 60 }, id),
    );
    expect(stats).toMatchObject({ unique: 3, created: 3, eligible: 2 });
    expect(await prisma.botRun.count({ where: { status: "SUCCEEDED" } })).toBe(1);

    // Drafting: only the two eligible posts get drafts.
    const engagement = new EngagementEngine({ ai, ...repos, logger: silentLogger, x: null });
    const limits = { maxRepliesPerHour: 5, maxRepliesPerDay: 30 };
    expect(await engagement.draft(config, limits, true)).toMatchObject({ drafted: 2 });
    expect(await engagement.draft(config, limits, true)).toMatchObject({ candidates: 0 });

    // Human review via the CLI commands.
    const pending = await repos.engagements.list("test-niche", ["PENDING_REVIEW"], 10);
    expect(pending).toHaveLength(2);
    const approved = await runReviewCommand(["approve", pending[0]!.id], config, repos.engagements);
    expect(approved.join("\n")).toContain("https://x.com/intent/post?in_reply_to=");
    await runReviewCommand(["done", pending[0]!.id], config, repos.engagements);
    expect(await repos.engagements.countByStatus("test-niche", "POSTED")).toBe(1);

    // Publishing in dry run with the discovered posts as context.
    const publishing = new PublishingEngine({
      ai,
      published: repos.published,
      discovered: repos.posts,
      poster: dryRunPoster(silentLogger),
      logger: silentLogger,
    });
    expect(await publishing.run(config, { maxPostsPerDay: 3 }, true)).toMatchObject({ action: "posted", externalId: null });
    expect(await publishing.run(config, { maxPostsPerDay: 3 }, true)).toEqual({
      action: "idle",
      reason: "too soon after the last post",
    });
    const post = await prisma.publishedPost.findFirstOrThrow();
    expect(post).toMatchObject({ status: "POSTED", topic: "liquidation risk", dryRun: true });
  });
});
