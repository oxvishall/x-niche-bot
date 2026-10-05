import type { RunRepository, RunType } from "../database/repositories/run-repository.js";

/** Records a BotRun around `fn`, storing its stats or error. */
export async function withBotRun<T extends object>(
  runs: RunRepository,
  input: { niche: string; type: RunType; dryRun: boolean },
  fn: (botRunId: string) => Promise<T>,
): Promise<T> {
  const botRunId = await runs.startBotRun(input);
  try {
    const stats = await fn(botRunId);
    await runs.finishBotRun(botRunId, { status: "SUCCEEDED", stats });
    return stats;
  } catch (error) {
    await runs.finishBotRun(botRunId, {
      status: "FAILED",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
