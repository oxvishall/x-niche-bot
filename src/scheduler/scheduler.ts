import type { Logger } from "pino";

export interface JobDefinition {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
  /** Run once immediately on start (default true). */
  runOnStart?: boolean;
}

interface JobState {
  def: JobDefinition;
  timer?: NodeJS.Timeout;
  running?: Promise<void>;
}

/**
 * Minimal in-process scheduler. Each job runs on its own interval, never
 * overlaps itself (the next run is scheduled after the current one ends),
 * and a failing run is logged without stopping the job.
 */
export class Scheduler {
  private readonly jobs = new Map<string, JobState>();
  private stopped = true;

  constructor(private readonly logger: Logger) {}

  register(def: JobDefinition): this {
    if (this.jobs.has(def.name)) throw new Error(`Job "${def.name}" is already registered`);
    this.jobs.set(def.name, { def });
    return this;
  }

  start(): void {
    this.stopped = false;
    for (const state of this.jobs.values()) {
      if (state.def.runOnStart ?? true) void this.tick(state);
      else this.schedule(state);
    }
    this.logger.info(
      { jobs: [...this.jobs.values()].map((s) => ({ name: s.def.name, everyMinutes: s.def.intervalMs / 60_000 })) },
      "Scheduler started",
    );
  }

  /** Stops scheduling and waits for in-flight runs to finish. */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const state of this.jobs.values()) clearTimeout(state.timer);
    await Promise.all([...this.jobs.values()].map((s) => s.running));
    this.logger.info("Scheduler stopped");
  }

  private schedule(state: JobState): void {
    if (this.stopped) return;
    state.timer = setTimeout(() => void this.tick(state), state.def.intervalMs);
  }

  private async tick(state: JobState): Promise<void> {
    if (this.stopped || state.running) return;
    const { name, run } = state.def;
    const startedAt = Date.now();

    state.running = (async () => {
      try {
        const result = await run();
        this.logger.info({ job: name, durationMs: Date.now() - startedAt, result }, "Job completed");
      } catch (error) {
        this.logger.error({ job: name, err: error }, "Job failed");
      }
    })();

    await state.running;
    state.running = undefined;
    this.schedule(state);
  }
}
