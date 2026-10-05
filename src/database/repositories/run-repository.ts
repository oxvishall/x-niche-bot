import type { PrismaClient } from "../../generated/prisma/client.js";

export type RunType = "DISCOVERY" | "ENGAGEMENT" | "PUBLISHING";
export type RunStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

/** X recent search only covers 7 days and rejects older `since_id` cursors. */
const CURSOR_MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000;

export interface FinishSearchRunInput {
  status: Exclude<RunStatus, "RUNNING">;
  resultCount: number;
  newestId?: string;
  error?: string;
}

/** Tracks bot runs and search runs (incl. `since_id` cursors per query). */
export interface RunRepository {
  startBotRun(input: { niche: string; type: RunType; dryRun: boolean }): Promise<string>;
  finishBotRun(
    id: string,
    input: { status: Exclude<RunStatus, "RUNNING">; stats?: object; error?: string },
  ): Promise<void>;
  /** Newest post ID seen for this query by a recent successful run (< 6 days old). */
  getSearchCursor(niche: string, query: string): Promise<string | undefined>;
  startSearchRun(input: { botRunId?: string; niche: string; query: string }): Promise<string>;
  finishSearchRun(id: string, input: FinishSearchRunInput): Promise<void>;
}

export class PrismaRunRepository implements RunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async startBotRun(input: { niche: string; type: RunType; dryRun: boolean }): Promise<string> {
    const run = await this.prisma.botRun.create({ data: input, select: { id: true } });
    return run.id;
  }

  async finishBotRun(
    id: string,
    input: { status: Exclude<RunStatus, "RUNNING">; stats?: object; error?: string },
  ): Promise<void> {
    await this.prisma.botRun.update({
      where: { id },
      data: {
        status: input.status,
        finishedAt: new Date(),
        ...(input.stats && { stats: input.stats }),
        ...(input.error && { error: input.error }),
      },
    });
  }

  async getSearchCursor(niche: string, query: string): Promise<string | undefined> {
    const run = await this.prisma.searchRun.findFirst({
      where: {
        niche,
        query,
        status: "SUCCEEDED",
        newestId: { not: null },
        startedAt: { gte: new Date(Date.now() - CURSOR_MAX_AGE_MS) },
      },
      orderBy: { startedAt: "desc" },
      select: { newestId: true },
    });
    return run?.newestId ?? undefined;
  }

  async startSearchRun(input: { botRunId?: string; niche: string; query: string }): Promise<string> {
    const run = await this.prisma.searchRun.create({ data: input, select: { id: true } });
    return run.id;
  }

  async finishSearchRun(id: string, input: FinishSearchRunInput): Promise<void> {
    await this.prisma.searchRun.update({
      where: { id },
      data: {
        status: input.status,
        resultCount: input.resultCount,
        finishedAt: new Date(),
        ...(input.newestId && { newestId: input.newestId }),
        ...(input.error && { error: input.error }),
      },
    });
  }
}
