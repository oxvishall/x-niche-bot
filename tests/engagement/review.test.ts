import { describe, expect, it } from "vitest";
import { runReviewCommand } from "../../src/engagement/review.js";
import { parsePostId, replyIntentUrl } from "../../src/x/intent.js";
import { InMemoryEngagementRepository } from "../fakes.js";
import { makeNiche } from "../helpers.js";

async function setup(delivery: "intent" | "api" = "intent") {
  const config = makeNiche({ engagement: { delivery } });
  const engagements = new InMemoryEngagementRepository();
  const id = (await engagements.create({
    niche: config.niche.name,
    discoveredPostId: "dp-1",
    targetExternalId: "1234567890",
    targetAuthorId: "a1",
    status: "PENDING_REVIEW",
    dryRun: false,
    content: "How do you handle oracle lag?",
  }))!;
  return { config, engagements, id };
}

describe("review commands", () => {
  it("lists pending drafts", async () => {
    const { config, engagements, id } = await setup();
    const out = (await runReviewCommand(["list"], config, engagements)).join("\n");
    expect(out).toContain(`[${id}]`);
    expect(out).toContain("reply: How do you handle oracle lag?");
  });

  it("approves with an intent link, then marks the reply posted", async () => {
    const { config, engagements, id } = await setup();
    const approved = await runReviewCommand(["approve", id], config, engagements);
    expect(approved.join("\n")).toContain(replyIntentUrl("1234567890", "How do you handle oracle lag?"));

    const done = await runReviewCommand(["done", id, "https://x.com/me/status/999999999"], config, engagements);
    expect(done).toEqual([`Marked ${id} as posted.`]);
    expect(engagements.rows[0]).toMatchObject({ status: "POSTED", externalId: "999999999" });
  });

  it("approves edited text and refuses invalid edits", async () => {
    const { config, engagements, id } = await setup("api");
    const bad = await runReviewCommand(["approve", id, "x".repeat(300)], config, engagements);
    expect(bad[0]).toContain("too-long");
    expect(engagements.rows[0]!.status).toBe("PENDING_REVIEW");

    await runReviewCommand(["approve", id, "Edited", "reply", "text"], config, engagements);
    expect(engagements.rows[0]).toMatchObject({ status: "APPROVED", content: "Edited reply text" });
  });

  it("rejects drafts and reports unknown ids", async () => {
    const { config, engagements, id } = await setup();
    expect(await runReviewCommand(["reject", id], config, engagements)).toEqual([`Rejected ${id}.`]);
    expect((await runReviewCommand(["approve", "nope"], config, engagements))[0]).toContain("No pending draft");
  });
});

describe("intent helpers", () => {
  it("builds reply intents and parses post IDs", () => {
    expect(replyIntentUrl("123", "hi there & more")).toBe(
      "https://x.com/intent/post?in_reply_to=123&text=hi+there+%26+more",
    );
    expect(parsePostId("https://x.com/user/status/1840000000000000001?s=20")).toBe("1840000000000000001");
    expect(parsePostId("1840000000000000001")).toBe("1840000000000000001");
    expect(parsePostId("not a url")).toBeNull();
  });
});
