import { describe, expect, it } from "vitest";
import { runPostReviewCommand } from "../../src/publishing/review.js";
import { InMemoryPublishedPostRepository } from "../fakes.js";
import { makeNiche } from "../helpers.js";

describe("post review commands", () => {
  it("lists, approves with edits and rejects post drafts", async () => {
    const config = makeNiche();
    const published = new InMemoryPublishedPostRepository();
    const id = await published.create({
      niche: config.niche.name,
      content: "Draft post",
      contentHash: "h",
      topic: "risk",
      status: "PENDING_REVIEW",
      dryRun: true,
    });

    expect((await runPostReviewCommand(["list"], config, published)).join("\n")).toContain(`[${id}] topic: risk`);
    await runPostReviewCommand(["approve", id, "Edited", "post"], config, published);
    expect(published.rows[0]).toMatchObject({ status: "APPROVED", content: "Edited post" });
    expect(await runPostReviewCommand(["reject", id], config, published)).toEqual([`Rejected ${id}.`]);
  });
});
