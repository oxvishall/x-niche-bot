import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "../../src/scheduler/scheduler.js";
import { silentLogger } from "../helpers.js";

describe("Scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs on start and then every interval", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    const scheduler = new Scheduler(silentLogger).register({ name: "a", intervalMs: 1000, run });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2500);
    expect(run).toHaveBeenCalledTimes(3);
    await scheduler.stop();
  });

  it("can delay the first run", async () => {
    const run = vi.fn().mockResolvedValue(null);
    const scheduler = new Scheduler(silentLogger).register({ name: "a", intervalMs: 1000, run, runOnStart: false });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });

  it("never overlaps a slow run and schedules the next one after it ends", async () => {
    let active = 0;
    let maxActive = 0;
    const run = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      active--;
    });
    const scheduler = new Scheduler(silentLogger).register({ name: "slow", intervalMs: 1000, run });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(5000); // first run finishes
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // next run starts 1s after the first ended
    expect(run).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    await scheduler.stop();
  });

  it("keeps running after a job throws", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("ok");
    const scheduler = new Scheduler(silentLogger).register({ name: "a", intervalMs: 1000, run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it("stop waits for in-flight runs and prevents further runs", async () => {
    let finished = false;
    const run = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      finished = true;
    });
    const scheduler = new Scheduler(silentLogger).register({ name: "a", intervalMs: 1000, run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    const stopping = scheduler.stop();
    await vi.advanceTimersByTimeAsync(3000);
    await stopping;
    expect(finished).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects duplicate job names", () => {
    const scheduler = new Scheduler(silentLogger).register({ name: "a", intervalMs: 1, run: async () => null });
    expect(() => scheduler.register({ name: "a", intervalMs: 1, run: async () => null })).toThrow();
  });
});
