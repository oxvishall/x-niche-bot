import type { PrismaClient } from "../../generated/prisma/client.js";
import type { PostEvaluation } from "../../discovery/relevance.js";
import type { NormalizedPost } from "../../types/index.js";

export type PostOrigin = "SEARCH" | "MENTION";

export interface EvaluatedPost {
  post: NormalizedPost;
  evaluation: PostEvaluation;
  searchRunId?: string;
  /** Defaults to SEARCH. */
  origin?: PostOrigin;
  /** Text of the post this one replies to (thread context). */
  parentText?: string;
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
  parentText: string | null;
  postedAt: Date;
  relevanceScore: number;
  matchedKeywords: string[];
  matchedHashtags: string[];
}

export interface FindCandidatesInput {
  niche: string;
  origin: PostOrigin;
  minScore: number;
  postedAfter: Date;
  postedBefore: Date;
  limit: number;
}

export interface DiscoveredPostRepository {
  /** Inserts new posts and refreshes metrics/evaluation of known ones. */
  upsertMany(niche: string, items: EvaluatedPost[]): Promise<UpsertResult>;
  /** Eligible posts this account hasn't engaged with (in any niche), best score first. */
  findCandidates(input: FindCandidatesInput): Promise<CandidatePost[]>;
  /** Texts of the highest-scoring eligible search posts since `since` (engaged or not). */
  findTopTexts(niche: string, since: Date, limit: number): Promise<string[]>;
}

function toRow(niche: string, { post, evaluation, searchRunId, origin, parentText }: EvaluatedPost) {
  return {
    platform: post.platform,
    externalId: post.id,
    niche,
    origin: origin ?? "SEARCH",
    inReplyToPostId: post.inReplyToPostId ?? null,
    parentText: parentText ?? null,
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
      select: { externalId: true, origin: true },
    });
    const known = new Map(existing.map((e) => [e.externalId, e.origin]));
    const fresh = items.filter((i) => !known.has(i.post.id));
    const stale = items.filter((i) => known.has(i.post.id));

    const { count: created } = await this.prisma.discoveredPost.createMany({
      data: fresh.map((item) => toRow(niche, item)),
      skipDuplicates: true,
    });

    await this.prisma.$transaction(
      stale.map((item) => {
        const row = toRow(niche, item);
        const { platform, externalId, niche: _niche, searchRunId: _run, origin, parentText, ...data } = row;
        const where = { platform_externalId_niche: { platform, externalId, niche } };

        // A mention re-found by search keeps its mention evaluation and thread
        // context; only the engagement metrics are refreshed.
        if (known.get(externalId) === "MENTION" && origin === "SEARCH") {
          const { likeCount, replyCount, repostCount, quoteCount } = row;
          return this.prisma.discoveredPost.update({
            where,
            data: { likeCount, replyCount, repostCount, quoteCount },
          });
        }
        return this.prisma.discoveredPost.update({
          where,
          // A post later seen as a mention becomes a mention; never the reverse.
          data: { ...data, origin, ...(parentText !== null && { parentText }) },
        });
      }),
    );

    return { created, updated: stale.length };
  }

  async findCandidates(input: FindCandidatesInput): Promise<CandidatePost[]> {
    const rows = await this.prisma.discoveredPost.findMany({
      where: {
        niche: input.niche,
        origin: input.origin,
        eligible: true,
        relevanceScore: { gte: input.minScore },
        postedAt: { gte: input.postedAfter, lte: input.postedBefore },
        engagements: { none: {} },
      },
      orderBy: [{ relevanceScore: "desc" }, { postedAt: "desc" }],
      // Over-fetch: some rows may be dropped below.
      take: input.limit * 2,
      select: {
        id: true,
        externalId: true,
        authorId: true,
        authorUsername: true,
        text: true,
        lang: true,
        conversationId: true,
        parentText: true,
        postedAt: true,
        relevanceScore: true,
        matchedKeywords: true,
        matchedHashtags: true,
      },
    });

    // The account must never reply twice to a post, even if another niche
    // sharing this database already engaged with it.
    const engagedElsewhere = await this.prisma.engagement.findMany({
      where: { platform: "X", targetExternalId: { in: rows.map((r) => r.externalId) } },
      select: { targetExternalId: true },
    });
    const taken = new Set(engagedElsewhere.map((e) => e.targetExternalId));
    return rows
      .filter((row) => !taken.has(row.externalId))
      .slice(0, input.limit)
      .map((row) => ({ ...row, relevanceScore: row.relevanceScore ?? 0 }));
  }

  async findTopTexts(niche: string, since: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.discoveredPost.findMany({
      where: { niche, origin: "SEARCH", eligible: true, postedAt: { gte: since } },
      orderBy: { relevanceScore: "desc" },
      take: limit,
      select: { text: true },
    });
    return rows.map((r) => r.text);
  }
}
