import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../../src/ai/provider.js";
import type { NicheConfigInput } from "../../src/config/niche.schema.js";
import { hourIn, pickTopic, PublishingEngine, withinActiveHours } from "../../src/publishing/publishing-engine.js";
import { XApiError } from "../../src/x/errors.js";
import { InMemoryDiscoveredPostRepository, InMemoryPublishedPostRepository } from "../fakes.js";
import { makeNiche, NOW, silentLogger } from "../helpers.js";

const POST_A = "Most lending blowups start with oracle assumptions nobody wrote down. Document yours before you scale.";
const POST_B = "Isolated markets trade capital efficiency for containment. For new collateral types, that trade is worth it.";

function setup(overrides: Partial<NicheConfigInput> = {}, ...texts: string[]) {
  const config = makeNiche({
    ...overrides,
    publishing: { enabled: true, postsPerDay: 3, topics: ["risk", "oracles"], ...overrides.publishing },
  });
  const generate = vi.fn();
  for (const t of texts) generate.mockResolvedValueOnce({ text: t, model: "m" });
  generate.mockResolvedValue({ text: "SKIP", model: "m" });
  const ai = { name: "fake", generate } as AiProvider & { generate: ReturnType<typeof vi.fn> };
  let clock = NOW;
  const published = new InMemoryPublishedPostRepository(() => clock);
  const createPost = vi.fn(async ({ text }: { text: string }) => ({ id: `x-${published.rows.length}`, text }));
  const engine = new PublishingEngine({
    ai,
    published,
    discovered: new InMemoryDiscoveredPostRepository(),
    poster: { createPost },
    logger: silentLogger,
  });
  return {
    config,
    engine,
    published,
    createPost,
    ai,
    setClock: (d: Date) => (clock = d),
  };
}

const limits = { maxPostsPerDay: 10 };

describe("PublishingEngine", () => {
  it("generates and posts in auto mode, rotating topics", async () => {
    const { config, engine, published, ai, setClock } = setup({}, POST_A, POST_B);

    const first = await engine.run(config, limits, false, NOW);
    expect(first).toMatchObject({ action: "posted", externalId: "x-1" });
    expect(published.rows[0]).toMatchObject({ status: "POSTED", topic: "risk", content: POST_A });
    expect(ai.generate.mock.calls[0]![0].prompt).toContain("Topic: risk");

    const later = new Date(NOW.getTime() + 3 * 60 * 60_000);
    setClock(later);
    await engine.run(config, limits, false, later);
    expect(published.rows[1]).toMatchObject({ topic: "oracles", content: POST_B });
  });

  it("respects minimum spacing and the daily cap", async () => {
    const { config, engine } = setup({ publishing: { postsPerDay: 1 } }, POST_A, POST_B);
    await engine.run(config, limits, false, NOW);

    const soon = await engine.run(config, limits, false, new Date(NOW.getTime() + 10 * 60_000));
    expect(soon).toEqual({ action: "idle", reason: "daily cap reached (1/1)" });

    const { config: c2, engine: e2 } = setup({}, POST_A, POST_B);
    await e2.run(c2, limits, false, NOW);
    expect(await e2.run(c2, limits, false, new Date(NOW.getTime() + 10 * 60_000))).toEqual({
      action: "idle",
      reason: "too soon after the last post",
    });
  });

  it("queues drafts in review mode and posts them once approved", async () => {
    const { config, engine, published, createPost } = setup({ publishing: { mode: "review" } }, POST_A);

    expect(await engine.run(config, limits, false, NOW)).toMatchObject({ action: "drafted" });
    expect(createPost).not.toHaveBeenCalled();

    await published.approve(published.rows[0]!.id);
    expect(await engine.run(config, limits, false, NOW)).toMatchObject({ action: "posted" });
    expect(createPost).toHaveBeenCalledWith({ text: POST_A });
  });

  it("uses MAX_POSTS_PER_DAY when the niche doesn't set postsPerDay", async () => {
    const config = makeNiche({ publishing: { enabled: true } });
    expect(config.publishing.postsPerDay).toBeUndefined();
    const { engine } = setup({}, POST_A);
    expect(await engine.run(config, { maxPostsPerDay: 1 }, false, NOW)).toMatchObject({ action: "posted" });
  });

  it("treats a duplicate-content rejection as already published", async () => {
    const { config, engine, published, createPost } = setup({}, POST_A);
    createPost.mockRejectedValueOnce(new XApiError("failed", 403, "POST /2/tweets", "duplicate content"));
    expect(await engine.run(config, limits, false, NOW)).toMatchObject({ action: "posted", externalId: null });
    expect(published.rows[0]!.status).toBe("POSTED");
  });

  it("never posts approvals drafted in the other mode", async () => {
    const { config, engine, published, createPost } = setup({ publishing: { mode: "review" } }, POST_A);
    await engine.run(config, limits, true, NOW); // dry-run draft
    await published.approve(published.rows[0]!.id);
    const live = await engine.run(config, limits, false, NOW);
    expect(createPost).not.toHaveBeenCalledWith({ text: POST_A });
    expect(live.action).not.toBe("posted");
  });

  it("stays idle outside active hours", async () => {
    // NOW is 12:00 UTC.
    const { config, engine, ai } = setup({ publishing: { activeHours: { start: 18, end: 22, timezone: "UTC" } } }, POST_A);
    expect(await engine.run(config, limits, false, NOW)).toEqual({ action: "idle", reason: "outside active hours" });
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("marks non-retryable API failures as failed", async () => {
    const { config, engine, published, createPost } = setup({}, POST_A);
    createPost.mockRejectedValueOnce(new XApiError("forbidden", 403, "POST /2/tweets"));
    expect(await engine.run(config, limits, false, NOW)).toMatchObject({ action: "failed" });
    expect(published.rows[0]!.status).toBe("FAILED");
  });

  it("idles when the model skips or keeps producing invalid posts", async () => {
    const { config, engine } = setup({}, "Great post idea #defi", "Great point #defi");
    const result = await engine.run(config, limits, false, NOW);
    expect(result).toMatchObject({ action: "idle" });
    expect((result as { reason: string }).reason).toContain("validation failed");
  });
});

describe("publishing helpers", () => {
  it("picks never-used topics first, then the least recently used", () => {
    const used = new Map([["a", new Date(2)], ["b", new Date(1)]]);
    expect(pickTopic(["a", "b", "c"], used)).toBe("c");
    expect(pickTopic(["a", "b"], used)).toBe("b");
    expect(pickTopic([], used)).toBeUndefined();
  });

  it("evaluates active hours in the configured timezone, including windows over midnight", () => {
    expect(hourIn(NOW, "Asia/Kolkata")).toBe(17);
    const config = (start: number, end: number) =>
      makeNiche({ publishing: { activeHours: { start, end, timezone: "Asia/Kolkata" } } });
    expect(withinActiveHours(config(9, 18), NOW)).toBe(true);
    expect(withinActiveHours(config(22, 6), NOW)).toBe(false);
  });
});
