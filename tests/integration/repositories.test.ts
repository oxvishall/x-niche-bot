import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDiscoveryContext } from "../../src/discovery/query.js";
import { evaluatePost } from "../../src/discovery/relevance.js";
import { PrismaDiscoveredPostRepository } from "../../src/database/repositories/discovered-post-repository.js";
import { PrismaEngagementRepository } from "../../src/database/repositories/engagement-repository.js";
import { PrismaPublishedPostRepository } from "../../src/database/repositories/published-post-repository.js";
import { PrismaRunRepository } from "../../src/database/repositories/run-repository.js";
import { WorkerLock } from "../../src/scheduler/lock.js";
import type { NormalizedPost } from "../../src/types/index.js";
import { makeNiche, makePost } from "../helpers.js";
import { databaseUrl, resetDatabase, testPrisma } from "./db.js";

const prisma = testPrisma();
const runs = new PrismaRunRepository(prisma);
const posts = new PrismaDiscoveredPostRepository(prisma);
const engagements = new PrismaEngagementRepository(prisma);
const published = new PrismaPublishedPostRepository(prisma);

const config = makeNiche();
const NICHE = config.niche.name;
const ctx = createDiscoveryContext(config, "en");
const ON_TOPIC = "Decentralized finance lending on Arbitrum keeps improving, #DeFi risk tooling too";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const evaluated = (post: NormalizedPost) => ({ post, evaluation: evaluatePost(post, ctx) });

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe("PrismaRunRepository", () => {
  it("tracks bot runs and returns the latest successful search cursor", async () => {
    const botRunId = await runs.startBotRun({ niche: NICHE, type: "DISCOVERY", dryRun: true });
    const first = await runs.startSearchRun({ botRunId, niche: NICHE, query: "q" });
    await runs.finishSearchRun(first, { status: "SUCCEEDED", resultCount: 2, newestId: "100" });
    const failed = await runs.startSearchRun({ botRunId, niche: NICHE, query: "q" });
    await runs.finishSearchRun(failed, { status: "FAILED", resultCount: 0, error: "boom" });
    await runs.finishBotRun(botRunId, { status: "SUCCEEDED", stats: { created: 2 } });

    expect(await runs.getSearchCursor(NICHE, "q")).toBe("100");
    expect(await runs.getSearchCursor(NICHE, "other")).toBeUndefined();
    const run = await prisma.botRun.findUniqueOrThrow({ where: { id: botRunId } });
    expect(run).toMatchObject({ status: "SUCCEEDED", stats: { created: 2 } });
    expect(run.finishedAt).not.toBeNull();
  });

  it("ignores cursors older than six days", async () => {
    const id = await runs.startSearchRun({ niche: NICHE, query: "q" });
    await runs.finishSearchRun(id, { status: "SUCCEEDED", resultCount: 1, newestId: "5" });
    await prisma.searchRun.update({ where: { id }, data: { startedAt: new Date(Date.now() - 7 * 86_400_000) } });
    expect(await runs.getSearchCursor(NICHE, "q")).toBeUndefined();
  });
});

describe("PrismaDiscoveredPostRepository", () => {
  it("inserts new posts and refreshes metrics of known ones", async () => {
    const post = makePost({ id: "1", text: ON_TOPIC, createdAt: minutesAgo(30) });
    expect(await posts.upsertMany(NICHE, [evaluated(post)])).toEqual({ created: 1, updated: 0 });

    const busier = { ...post, metrics: { ...post.metrics, likes: 500 } };
    expect(await posts.upsertMany(NICHE, [evaluated(busier), evaluated(makePost({ id: "2", createdAt: minutesAgo(30) }))])).toEqual({
      created: 1,
      updated: 1,
    });

    const row = await prisma.discoveredPost.findFirstOrThrow({ where: { externalId: "1" } });
    expect(row).toMatchObject({ likeCount: 500, eligible: true, matchedHashtags: ["defi"] });
    expect(row.scoreBreakdown).toMatchObject({ hashtag: 1 });
  });

  it("finds eligible, not-yet-engaged candidates best first", async () => {
    await posts.upsertMany(NICHE, [
      evaluated(makePost({ id: "1", authorId: "a1", text: ON_TOPIC, createdAt: minutesAgo(30) })),
      evaluated(makePost({ id: "2", authorId: "a2", text: `${ON_TOPIC} decentralized finance`, createdAt: minutesAgo(30) })),
      evaluated(makePost({ id: "3", authorId: "a3", text: "Nothing relevant here at all, just coffee thoughts", createdAt: minutesAgo(30) })),
    ]);
    const input = {
      niche: NICHE,
      minScore: 0.4,
      postedAfter: minutesAgo(600),
      postedBefore: new Date(),
      limit: 10,
    };

    const candidates = await posts.findCandidates(input);
    expect(candidates.map((c) => c.externalId).sort()).toEqual(["1", "2"]);
    expect(candidates[0]!.relevanceScore).toBeGreaterThanOrEqual(candidates[1]!.relevanceScore);

    await engagements.create({
      niche: NICHE,
      discoveredPostId: candidates[0]!.id,
      targetExternalId: candidates[0]!.externalId,
      targetAuthorId: candidates[0]!.authorId,
      status: "SKIPPED",
      dryRun: true,
    });
    expect((await posts.findCandidates(input)).map((c) => c.externalId)).toEqual([candidates[1]!.externalId]);
    expect(await posts.findTopTexts(NICHE, minutesAgo(600), 5)).toHaveLength(2);
  });
});

describe("PrismaEngagementRepository", () => {
  async function seedPost(id: string, authorId = "a1") {
    await posts.upsertMany(NICHE, [evaluated(makePost({ id, authorId, text: ON_TOPIC, createdAt: minutesAgo(30) }))]);
    return prisma.discoveredPost.findFirstOrThrow({ where: { externalId: id } });
  }

  it("refuses a second engagement for the same post", async () => {
    const post = await seedPost("1");
    const base = { niche: NICHE, discoveredPostId: post.id, targetExternalId: "1", targetAuthorId: "a1", dryRun: true };
    expect(await engagements.create({ ...base, status: "PENDING_REVIEW", content: "first" })).toEqual(expect.any(String));
    expect(await engagements.create({ ...base, status: "PENDING_REVIEW", content: "second" })).toBeNull();
  });

  it("runs the review lifecycle and counts posted replies per mode", async () => {
    const post = await seedPost("1");
    const id = (await engagements.create({
      niche: NICHE,
      discoveredPostId: post.id,
      targetExternalId: "1",
      targetAuthorId: "a1",
      status: "PENDING_REVIEW",
      dryRun: false,
      content: "How do you size liquidation buffers?",
      contentHash: "h1",
    }))!;

    expect(await engagements.countByStatus(NICHE, "PENDING_REVIEW")).toBe(1);
    expect(await engagements.countForAuthorSince("a1", minutesAgo(60))).toBe(1);
    expect(await engagements.recentContents(NICHE, 10)).toEqual(["How do you size liquidation buffers?"]);

    await engagements.approve(id, "Edited reply", "h2");
    const [approved] = await engagements.list(NICHE, ["APPROVED"], 10);
    expect(approved).toMatchObject({ id, content: "Edited reply", post: { authorUsername: "alice" } });

    await engagements.markPosted(id, "999");
    expect(await engagements.countPostedSince(NICHE, minutesAgo(60), false)).toBe(1);
    expect(await engagements.countPostedSince(NICHE, minutesAgo(60), true)).toBe(0);

    await engagements.reject(id);
    expect(await engagements.recentContents(NICHE, 10)).toEqual([]);
  });

  it("allows posted reply IDs to be null for dry runs and intent delivery", async () => {
    for (const id of ["1", "2"]) {
      const post = await seedPost(id, `a${id}`);
      const engagementId = (await engagements.create({
        niche: NICHE,
        discoveredPostId: post.id,
        targetExternalId: id,
        targetAuthorId: `a${id}`,
        status: "APPROVED",
        dryRun: true,
        content: `reply ${id}`,
      }))!;
      await engagements.markPosted(engagementId, null);
    }
    expect(await engagements.countPostedSince(NICHE, minutesAgo(60), true)).toBe(2);
  });
});

describe("PrismaPublishedPostRepository", () => {
  it("tracks topics, spacing and daily counts", async () => {
    const first = await published.create({ niche: NICHE, content: "Post one", contentHash: "h1", topic: "risk", status: "APPROVED", dryRun: true });
    await published.markPosted(first, null);
    await published.create({ niche: NICHE, content: "Post two", contentHash: "h2", topic: "oracles", status: "PENDING_REVIEW", dryRun: true });
    await published.create({ niche: NICHE, content: "Rejected", contentHash: "h3", topic: "fees", status: "REJECTED", dryRun: true });

    const topics = await published.topicLastUsed(NICHE);
    expect([...topics.keys()].sort()).toEqual(["oracles", "risk"]);
    expect(await published.countPostedSince(NICHE, minutesAgo(60), true)).toBe(1);
    expect(await published.lastPostedAt(NICHE, true)).toBeInstanceOf(Date);
    expect(await published.lastPostedAt(NICHE, false)).toBeNull();
    expect(await published.recentContents(NICHE, 10)).toEqual(["Post two", "Post one"]);
  });
});

describe("WorkerLock", () => {
  it("lets only one holder per key at a time", async () => {
    const a = new WorkerLock(databaseUrl(), "x-niche-bot:test");
    const b = new WorkerLock(databaseUrl(), "x-niche-bot:test");
    const other = new WorkerLock(databaseUrl(), "x-niche-bot:other");

    expect(await a.tryAcquire()).toBe(true);
    expect(await b.tryAcquire()).toBe(false);
    expect(await other.tryAcquire()).toBe(true);

    await a.release();
    expect(await b.tryAcquire()).toBe(true);
    await b.release();
    await other.release();
  });
});
