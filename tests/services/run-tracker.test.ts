import { describe, expect, it } from "vitest";
import { withBotRun } from "../../src/services/run-tracker.js";
import { InMemoryRunRepository } from "../fakes.js";

const input = { niche: "n", type: "DISCOVERY" as const, dryRun: true };

describe("withBotRun", () => {
  it("records success with stats", async () => {
    const runs = new InMemoryRunRepository();
    await withBotRun(runs, input, async () => ({ created: 3 }));
    expect(runs.botRuns[0]).toMatchObject({ status: "SUCCEEDED", stats: { created: 3 } });
  });

  it("records failure and rethrows", async () => {
    const runs = new InMemoryRunRepository();
    await expect(
      withBotRun(runs, input, async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    expect(runs.botRuns[0]).toMatchObject({ status: "FAILED", error: "nope" });
  });
});
