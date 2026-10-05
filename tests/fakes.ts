import type {
  CandidatePost,
  DiscoveredPostRepository,
  EvaluatedPost,
  FindCandidatesInput,
  UpsertResult,
} from "../src/database/repositories/discovered-post-repository.js";
import type {
  FinishSearchRunInput,
  RunRepository,
  RunStatus,
  RunType,
} from "../src/database/repositories/run-repository.js";

export class InMemoryRunRepository implements RunRepository {
  botRuns: { id: string; niche: string; type: RunType; dryRun: boolean; status: RunStatus; stats?: object; error?: string }[] = [];
  searchRuns: ({ id: string; niche: string; query: string; botRunId?: string; status: RunStatus } & Omit<Partial<FinishSearchRunInput>, "status">)[] = [];
  private seq = 0;

  async startBotRun(input: { niche: string; type: RunType; dryRun: boolean }) {
    const id = `run-${++this.seq}`;
    this.botRuns.push({ id, ...input, status: "RUNNING" });
    return id;
  }

  async finishBotRun(id: string, input: { status: Exclude<RunStatus, "RUNNING">; stats?: object; error?: string }) {
    Object.assign(this.botRuns.find((r) => r.id === id)!, input);
  }

  async getSearchCursor(niche: string, query: string) {
    return this.searchRuns
      .filter((r) => r.niche === niche && r.query === query && r.status === "SUCCEEDED" && r.newestId)
      .at(-1)?.newestId;
  }

  async startSearchRun(input: { botRunId?: string; niche: string; query: string }) {
    const id = `search-${++this.seq}`;
    this.searchRuns.push({ id, ...input, status: "RUNNING" });
    return id;
  }

  async finishSearchRun(id: string, input: FinishSearchRunInput) {
    Object.assign(this.searchRuns.find((r) => r.id === id)!, input);
  }
}

export class InMemoryDiscoveredPostRepository implements DiscoveredPostRepository {
  rows = new Map<string, EvaluatedPost & { id: string; niche: string; engaged: boolean }>();

  async upsertMany(niche: string, items: EvaluatedPost[]): Promise<UpsertResult> {
    let created = 0;
    let updated = 0;
    for (const item of items) {
      const key = `${niche}:${item.post.id}`;
      const existing = this.rows.get(key);
      if (existing) updated++;
      else created++;
      this.rows.set(key, { ...item, id: existing?.id ?? `dp-${item.post.id}`, niche, engaged: existing?.engaged ?? false });
    }
    return { created, updated };
  }

  async findCandidates(input: FindCandidatesInput): Promise<CandidatePost[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.niche === input.niche &&
          !r.engaged &&
          r.evaluation.eligible &&
          r.evaluation.score >= input.minScore &&
          r.post.createdAt >= input.postedAfter &&
          r.post.createdAt <= input.postedBefore,
      )
      .sort((a, b) => b.evaluation.score - a.evaluation.score)
      .slice(0, input.limit)
      .map((r) => ({
        id: r.id,
        externalId: r.post.id,
        authorId: r.post.authorId,
        authorUsername: r.post.author?.username ?? null,
        text: r.post.text,
        lang: r.post.lang ?? null,
        conversationId: r.post.conversationId ?? null,
        postedAt: r.post.createdAt,
        relevanceScore: r.evaluation.score,
        matchedKeywords: r.evaluation.matchedKeywords,
        matchedHashtags: r.evaluation.matchedHashtags,
      }));
  }
}
