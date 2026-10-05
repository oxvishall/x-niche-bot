import type { PrismaClient } from "../../generated/prisma/client.js";
import type { PostEvaluation } from "../../discovery/relevance.js";
import type { NormalizedPost } from "../../types/index.js";

export interface EvaluatedPost {
  post: NormalizedPost;
  evaluation: PostEvaluation;
  searchRunId?: string;
}

export interface UpsertResult {
  created: number;
  updated: number;
}

/** A stored post that is ready for engagement. */
export interface CandidatePost {
  id: string;
  externalId: string;
  authorId: string;
  authorUsername: string | null;
  text: string;
  lang: string | null;
  conversationId: string | null;
  postedAt: Date;
  relevanceScore: number;
  matchedKeywords: string[];
  matchedHashtags: string[];
}

export interface FindCandidatesInput {
  niche: string;
  minScore: number;
  postedAfter: Date;
  postedBefore: Date;
  limit: number;
}

export interface DiscoveredPostRepository {
  /** Inserts new posts and refreshes metrics/evaluation of known ones. */
  upsertMany(niche: string, items: EvaluatedPost[]): Promise<UpsertResult>;
  /** Eligible posts with no engagement yet, best score first. */
  findCandidates(input: FindCandidatesInput): Promise<CandidatePost[]>;
}

function toRow(niche: string, { post, evaluation, searchRunId }: EvaluatedPost) {
  return {
    platform: post.platform,
    externalId: post.id,
    niche,
    searchRunId: searchRunId ?? null,
    authorId: post.authorId,
    authorUsername: post.author?.username ?? null,
    text: post.text,
    lang: post.lang ?? null,
    conversationId: post.conversationId ?? null,
    postedAt: post.createdAt,
    likeCount: post.metrics.likes,
    replyCount: post.metrics.replies,
    repostCount: post.metrics.reposts,
    quoteCount: post.metrics.quotes,
    relevanceScore: evaluation.score,
    scoreBreakdown: { ...evaluation.breakdown },
    matchedKeywords: evaluation.matchedKeywords,
    matchedHashtags: evaluation.matchedHashtags,
    excludedMatches: evaluation.excludedMatches,
    filterReasons: evaluation.filterReasons,
    passedFilters: evaluation.passedFilters,
    eligible: evaluation.eligible,
    raw: JSON.parse(JSON.stringify(post)) as object,
  };
}

export class PrismaDiscoveredPostRepository implements DiscoveredPostRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertMany(niche: string, items: EvaluatedPost[]): Promise<UpsertResult> {
    if (items.length === 0) return { created: 0, updated: 0 };

    const existing = await this.prisma.discoveredPost.findMany({
      where: { niche, platform: "X", externalId: { in: items.map((i) => i.post.id) } },
      select: { externalId: true },
    });
    const known = new Set(existing.map((e) => e.externalId));
    const fresh = items.filter((i) => !known.has(i.post.id));
    const stale = items.filter((i) => known.has(i.post.id));

    const { count: created } = await this.prisma.discoveredPost.createMany({
      data: fresh.map((item) => toRow(niche, item)),
      skipDuplicates: true,
    });

    await this.prisma.$transaction(
      stale.map((item) => {
        const { platform, externalId, niche: _niche, searchRunId: _run, ...data } = toRow(niche, item);
        return this.prisma.discoveredPost.update({
          where: { platform_externalId_niche: { platform, externalId, niche } },
          data,
        });
      }),
    );

    return { created, updated: stale.length };
  }

  async findCandidates(input: FindCandidatesInput): Promise<CandidatePost[]> {
    const rows = await this.prisma.discoveredPost.findMany({
      where: {
        niche: input.niche,
        eligible: true,
        relevanceScore: { gte: input.minScore },
        postedAt: { gte: input.postedAfter, lte: input.postedBefore },
        engagements: { none: {} },
      },
      orderBy: [{ relevanceScore: "desc" }, { postedAt: "desc" }],
      take: input.limit,
      select: {
        id: true,
        externalId: true,
        authorId: true,
        authorUsername: true,
        text: true,
        lang: true,
        conversationId: true,
        postedAt: true,
        relevanceScore: true,
        matchedKeywords: true,
        matchedHashtags: true,
      },
    });
    return rows.map((row) => ({ ...row, relevanceScore: row.relevanceScore ?? 0 }));
  }
}
