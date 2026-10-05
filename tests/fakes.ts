import type {
  CandidatePost,
  DiscoveredPostRepository,
  EvaluatedPost,
  FindCandidatesInput,
  UpsertResult,
} from "../src/database/repositories/discovered-post-repository.js";
import type {
  EngagementRepository,
  EngagementStatus,
  EngagementView,
  NewEngagement,
  ReplyDelivery,
} from "../src/database/repositories/engagement-repository.js";
import type {
  NewPublishedPost,
  PublishedPostRepository,
  PublishedPostStatus,
  PublishedPostView,
} from "../src/database/repositories/published-post-repository.js";
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
      if (existing?.origin === "MENTION" && (item.origin ?? "SEARCH") === "SEARCH") {
        existing.post = { ...existing.post, metrics: item.post.metrics };
        updated++;
        continue;
      }
      if (existing) updated++;
      else created++;
      const origin = item.origin ?? "SEARCH";
      const parentText = item.parentText ?? existing?.parentText;
      this.rows.set(key, {
        ...item,
        origin,
        ...(parentText !== undefined && { parentText }),
        id: existing?.id ?? `dp-${item.post.id}`,
        niche,
        engaged: existing?.engaged ?? false,
      });
    }
    return { created, updated };
  }

  async findCandidates(input: FindCandidatesInput): Promise<CandidatePost[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.niche === input.niche &&
          (r.origin ?? "SEARCH") === input.origin &&
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
        parentText: r.parentText ?? null,
        postedAt: r.post.createdAt,
        relevanceScore: r.evaluation.score,
        matchedKeywords: r.evaluation.matchedKeywords,
        matchedHashtags: r.evaluation.matchedHashtags,
      }));
  }

  async findTopTexts(niche: string, since: Date, limit: number): Promise<string[]> {
    return [...this.rows.values()]
      .filter((r) => r.niche === niche && (r.origin ?? "SEARCH") === "SEARCH" && r.evaluation.eligible && r.post.createdAt >= since)
      .sort((a, b) => b.evaluation.score - a.evaluation.score)
      .slice(0, limit)
      .map((r) => r.post.text);
  }
}

export class InMemoryEngagementRepository implements EngagementRepository {
  rows: (NewEngagement & { id: string; createdAt: Date; postedAt?: Date; externalId?: string | null })[] = [];
  private seq = 0;

  constructor(
    private readonly posts?: InMemoryDiscoveredPostRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(input: NewEngagement) {
    if (this.rows.some((r) => r.targetExternalId === input.targetExternalId)) return null;
    const id = `eng-${++this.seq}`;
    this.rows.push({ ...input, id, createdAt: this.clock() });
    for (const row of this.posts?.rows.values() ?? []) {
      if (row.id === input.discoveredPostId) row.engaged = true;
    }
    return id;
  }

  private view(r: (typeof this.rows)[number]): EngagementView {
    const post = [...(this.posts?.rows.values() ?? [])].find((p) => p.id === r.discoveredPostId);
    return {
      id: r.id,
      status: r.status,
      delivery: r.delivery,
      content: r.content ?? null,
      targetExternalId: r.targetExternalId,
      targetAuthorId: r.targetAuthorId,
      dryRun: r.dryRun,
      createdAt: r.createdAt,
      post: {
        text: post?.post.text ?? "",
        authorUsername: post?.post.author?.username ?? null,
        relevanceScore: post?.evaluation.score ?? null,
        origin: post?.origin ?? "SEARCH",
      },
    };
  }

  async get(id: string) {
    const row = this.rows.find((r) => r.id === id);
    return row ? this.view(row) : null;
  }

  async list(niche: string, statuses: EngagementStatus[], limit: number, delivery?: ReplyDelivery) {
    return this.rows
      .filter((r) => r.niche === niche && statuses.includes(r.status) && (!delivery || r.delivery === delivery))
      .slice(0, limit)
      .map((r) => this.view(r));
  }

  async countByStatus(niche: string, status: EngagementStatus) {
    return this.rows.filter((r) => r.niche === niche && r.status === status).length;
  }

  async countPostedSince(niche: string, since: Date, dryRun: boolean) {
    return this.rows.filter((r) => r.niche === niche && r.status === "POSTED" && r.dryRun === dryRun && r.postedAt! >= since).length;
  }

  async countForAuthorSince(authorId: string, since: Date) {
    return this.rows.filter(
      (r) => r.targetAuthorId === authorId && ["PENDING_REVIEW", "APPROVED", "POSTED"].includes(r.status) && r.createdAt >= since,
    ).length;
  }

  async recentContents(niche: string, limit: number) {
    return this.rows
      .filter((r) => r.niche === niche && r.content && ["PENDING_REVIEW", "APPROVED", "POSTED"].includes(r.status))
      .reverse()
      .slice(0, limit)
      .map((r) => r.content!);
  }

  private update(id: string, patch: Partial<(typeof this.rows)[number]>) {
    Object.assign(this.rows.find((r) => r.id === id)!, patch);
  }

  async approve(id: string, content?: string, contentHash?: string) {
    this.update(id, { status: "APPROVED", ...(content && { content }), ...(contentHash && { contentHash }) });
  }

  async reject(id: string) {
    this.update(id, { status: "REJECTED" });
  }

  async markPosted(id: string, externalId: string | null) {
    this.update(id, { status: "POSTED", postedAt: this.clock(), externalId });
  }

  async markFailed(id: string, error: string) {
    this.update(id, { status: "FAILED", error });
  }
}

export class InMemoryPublishedPostRepository implements PublishedPostRepository {
  rows: (NewPublishedPost & { id: string; createdAt: Date })[] = [];
  private seq = 0;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  async create(input: NewPublishedPost) {
    const id = `pub-${++this.seq}`;
    this.rows.push({ ...input, id, createdAt: this.clock() });
    return id;
  }

  private view(r: (typeof this.rows)[number]): PublishedPostView {
    return {
      id: r.id,
      status: r.status,
      content: r.content,
      topic: r.topic ?? null,
      dryRun: r.dryRun,
      createdAt: r.createdAt,
      postedAt: r.postedAt ?? null,
    };
  }

  async get(id: string) {
    const row = this.rows.find((r) => r.id === id);
    return row ? this.view(row) : null;
  }

  async list(niche: string, statuses: PublishedPostStatus[], limit: number) {
    return this.rows.filter((r) => r.niche === niche && statuses.includes(r.status)).slice(0, limit).map((r) => this.view(r));
  }

  async countByStatus(niche: string, status: PublishedPostStatus) {
    return this.rows.filter((r) => r.niche === niche && r.status === status).length;
  }

  async countPostedSince(niche: string, since: Date, dryRun: boolean) {
    return this.rows.filter((r) => r.niche === niche && r.status === "POSTED" && r.dryRun === dryRun && r.postedAt! >= since).length;
  }

  async lastPostedAt(niche: string, dryRun: boolean) {
    const posted = this.rows.filter((r) => r.niche === niche && r.status === "POSTED" && r.dryRun === dryRun);
    return posted.at(-1)?.postedAt ?? null;
  }

  async recentContents(niche: string, limit: number) {
    return this.rows
      .filter((r) => r.niche === niche && ["PENDING_REVIEW", "APPROVED", "POSTED"].includes(r.status))
      .reverse()
      .slice(0, limit)
      .map((r) => r.content);
  }

  async topicLastUsed(niche: string) {
    const map = new Map<string, Date>();
    for (const r of this.rows) {
      if (r.niche === niche && r.topic && r.status !== "REJECTED" && r.status !== "FAILED") map.set(r.topic, r.createdAt);
    }
    return map;
  }

  private update(id: string, patch: Partial<(typeof this.rows)[number]>) {
    Object.assign(this.rows.find((r) => r.id === id)!, patch);
  }

  async approve(id: string, content?: string, contentHash?: string) {
    this.update(id, { status: "APPROVED", ...(content && { content }), ...(contentHash && { contentHash }) });
  }

  async reject(id: string) {
    this.update(id, { status: "REJECTED" });
  }

  async markPosted(id: string, externalId: string | null) {
    this.update(id, { status: "POSTED", postedAt: this.clock(), externalId });
  }

  async markFailed(id: string, error: string) {
    this.update(id, { status: "FAILED", error });
  }
}
