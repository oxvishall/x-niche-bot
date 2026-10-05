import { describe, expect, it, vi } from "vitest";
import { AiRefusalError, type AiProvider } from "../../src/ai/provider.js";
import type { NicheConfigInput } from "../../src/config/niche.schema.js";
import { createDiscoveryContext } from "../../src/discovery/query.js";
import { evaluatePost } from "../../src/discovery/relevance.js";
import { EngagementEngine } from "../../src/engagement/engagement-engine.js";
import type { NormalizedPost } from "../../src/types/index.js";
import type { XClient } from "../../src/x/client.js";
import { XApiError } from "../../src/x/errors.js";
import { InMemoryDiscoveredPostRepository, InMemoryEngagementRepository } from "../fakes.js";
import { makeNiche, makePost, NOW, silentLogger } from "../helpers.js";

const limits = { maxRepliesPerHour: 5, maxRepliesPerDay: 30 };
const ON_TOPIC = "Decentralized finance lending on Arbitrum keeps improving, #DeFi risk tooling too";

function aiReturning(...texts: (string | Error)[]) {
  const generate = vi.fn();
  for (const t of texts) {
    if (t instanceof Error) generate.mockRejectedValueOnce(t);
    else generate.mockResolvedValueOnce({ text: t, model: "test-model" });
  }
  generate.mockResolvedValue({ text: "SKIP", model: "test-model" });
  return { name: "fake", generate } as AiProvider & { generate: ReturnType<typeof vi.fn> };
}

async function setup(
  posts: NormalizedPost[],
  ai: AiProvider,
  overrides: Partial<NicheConfigInput> = {},
  x?: XClient,
) {
  const config = makeNiche(overrides);
  const ctx = createDiscoveryContext(config, "en");
  const postRepo = new InMemoryDiscoveredPostRepository();
  await postRepo.upsertMany(
    config.niche.name,
    posts.map((post) => ({ post, evaluation: evaluatePost(post, ctx, NOW) })),
  );
  const engagements = new InMemoryEngagementRepository(postRepo, () => NOW);
  const engine = new EngagementEngine({ ai, posts: postRepo, engagements, logger: silentLogger, x: x ?? null });
  return { config, engine, engagements };
}

const replyA = "How are you sizing liquidation buffers when oracle updates lag behind price?";
const replyB = "Curious whether isolated markets have reduced bad debt for them so far.";

describe("EngagementEngine.draft", () => {
  it("queues validated drafts for review, best score first, up to maxDraftsPerRun", async () => {
    const ai = aiReturning(replyA, replyB);
    const { config, engine, engagements } = await setup(
      [
        makePost({ id: "1", authorId: "a1", text: ON_TOPIC }),
        makePost({ id: "2", authorId: "a2", text: `${ON_TOPIC} and lending` }),
        makePost({ id: "3", authorId: "a3", text: ON_TOPIC }),
      ],
      ai,
      { engagement: { enabled: true, maxDraftsPerRun: 2 } },
    );

    const stats = await engine.draft(config, limits, true, NOW);

    expect(stats).toMatchObject({ drafted: 2, budget: 2 });
    expect(engagements.rows.map((r) => r.status)).toEqual(["PENDING_REVIEW", "PENDING_REVIEW"]);
    expect(engagements.rows[0]).toMatchObject({ content: replyA, aiModel: "test-model" });
    expect(ai.generate.mock.calls[0]![0].prompt).toContain(ON_TOPIC);
  });

  it("records SKIP and refusals so the post is never retried", async () => {
    const ai = aiReturning("SKIP", new AiRefusalError("other"));
    const { config, engine, engagements } = await setup(
      [makePost({ id: "1", authorId: "a1", text: ON_TOPIC }), makePost({ id: "2", authorId: "a2", text: ON_TOPIC })],
      ai,
    );

    const first = await engine.draft(config, limits, true, NOW);
    expect(first).toMatchObject({ drafted: 0, skipped: 2 });
    expect(engagements.rows.map((r) => r.status)).toEqual(["SKIPPED", "SKIPPED"]);

    const second = await engine.draft(config, limits, true, NOW);
    expect(second.candidates).toBe(0);
  });

  it("retries once with feedback when validation fails", async () => {
    const ai = aiReturning("Great point! Check https://spam.example", replyA);
    const { config, engine, engagements } = await setup([makePost({ id: "1", text: ON_TOPIC })], ai);

    const stats = await engine.draft(config, limits, true, NOW);

    expect(stats.drafted).toBe(1);
    expect(ai.generate.mock.calls[1]![0].prompt).toContain("contains-link");
    expect(engagements.rows[0]!.content).toBe(replyA);
  });

  it("marks drafts invalid after two failed attempts", async () => {
    const ai = aiReturning("Great point!", "Great point!!");
    const { config, engine, engagements } = await setup([makePost({ id: "1", text: ON_TOPIC })], ai);
    const stats = await engine.draft(config, limits, true, NOW);
    expect(stats.invalid).toBe(1);
    expect(engagements.rows[0]).toMatchObject({ status: "SKIPPED" });
    expect(engagements.rows[0]!.validationIssues?.[0]).toContain("banned-phrase");
  });

  it("drafts at most maxRepliesPerAuthorPerDay per author", async () => {
    const ai = aiReturning(replyA, replyB);
    const { config, engine } = await setup(
      [makePost({ id: "1", authorId: "same", text: ON_TOPIC }), makePost({ id: "2", authorId: "same", text: ON_TOPIC })],
      ai,
    );
    const stats = await engine.draft(config, limits, true, NOW);
    expect(stats).toMatchObject({ drafted: 1, authorLimited: 1 });
  });

  it("stops drafting when the review queue is full", async () => {
    const ai = aiReturning(replyA);
    const { config, engine } = await setup([makePost({ id: "1", text: ON_TOPIC })], ai, {
      engagement: { maxPendingReviews: 1 },
    });
    await engine.draft(config, limits, true, NOW);
    const second = await engine.draft(config, limits, true, NOW);
    expect(second.budget).toBe(0);
  });
});

describe("EngagementEngine.deliver", () => {
  const apiConfig = { engagement: { enabled: true, mode: "auto", delivery: "api" } } as const;

  it("posts approved replies within the hourly cap", async () => {
    const createReply = vi.fn(async ({ text }: { text: string }) => ({ id: `r-${text.length}`, text }));
    const x = { createReply } as unknown as XClient;
    const { config, engine, engagements } = await setup(
      [
        makePost({ id: "1", authorId: "a1", text: ON_TOPIC }),
        makePost({ id: "2", authorId: "a2", text: ON_TOPIC }),
      ],
      aiReturning(replyA, replyB),
      apiConfig,
      x,
    );

    const tight = { maxRepliesPerHour: 1, maxRepliesPerDay: 30 };
    await engine.draft(config, tight, false, NOW);
    expect(engagements.rows.map((r) => r.status)).toEqual(["APPROVED"]);

    const stats = await engine.deliver(config, tight, false, NOW);
    expect(stats).toMatchObject({ posted: 1, budget: 1 });
    expect(createReply).toHaveBeenCalledWith({ inReplyToPostId: "1", text: replyA });
    expect(engagements.rows[0]).toMatchObject({ status: "POSTED", externalId: `r-${replyA.length}` });

    expect((await engine.deliver(config, tight, false, NOW)).budget).toBe(0);
  });

  it("marks 403 rejections as failed with a hint about X's reply restriction", async () => {
    const x = {
      createReply: vi.fn().mockRejectedValue(new XApiError("X API POST /2/tweets failed with 403", 403, "POST /2/tweets")),
    } as unknown as XClient;
    const { config, engine, engagements } = await setup([makePost({ id: "1", text: ON_TOPIC })], aiReturning(replyA), apiConfig, x);

    await engine.draft(config, limits, false, NOW);
    const stats = await engine.deliver(config, limits, false, NOW);

    expect(stats.failed).toBe(1);
    expect(engagements.rows[0]!.status).toBe("FAILED");
    expect(engagements.rows[0]!.error).toContain('delivery "intent"');
  });

  it("never delivers approvals drafted in the other mode", async () => {
    const createReply = vi.fn(async ({ text }: { text: string }) => ({ id: "r", text }));
    const { config, engine, engagements } = await setup(
      [makePost({ id: "1", text: ON_TOPIC })],
      aiReturning(replyA),
      apiConfig,
      { createReply } as unknown as XClient,
    );
    await engine.draft(config, limits, false, NOW); // live approval

    expect((await engine.deliver(config, limits, true, NOW)).attempted).toBe(0); // dry run
    expect(engagements.rows[0]!.status).toBe("APPROVED");
    expect((await engine.deliver(config, limits, false, NOW)).posted).toBe(1);
  });

  it("treats a duplicate-content rejection as already posted", async () => {
    const x = {
      createReply: vi
        .fn()
        .mockRejectedValue(new XApiError("failed", 403, "POST /2/tweets", "You are not allowed to create a Tweet with duplicate content.")),
    } as unknown as XClient;
    const { config, engine, engagements } = await setup([makePost({ id: "1", text: ON_TOPIC })], aiReturning(replyA), apiConfig, x);
    await engine.draft(config, limits, false, NOW);
    expect(await engine.deliver(config, limits, false, NOW)).toMatchObject({ posted: 1, failed: 0 });
    expect(engagements.rows[0]).toMatchObject({ status: "POSTED", externalId: null });
  });

  it("does nothing for intent delivery", async () => {
    const { config, engine } = await setup([], aiReturning());
    expect(await engine.deliver(config, limits, false, NOW)).toMatchObject({ attempted: 0 });
  });
});
