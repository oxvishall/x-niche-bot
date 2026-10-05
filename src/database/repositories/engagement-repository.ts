import type { PrismaClient } from "../../generated/prisma/client.js";

export type EngagementStatus =
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "POSTED"
  | "FAILED"
  | "SKIPPED";

export type ReplyDelivery = "INTENT" | "API";

/** Statuses that count as "we engaged (or will engage) with this author". */
const ACTIVE_STATUSES: EngagementStatus[] = ["PENDING_REVIEW", "APPROVED", "POSTED"];

export interface NewEngagement {
  niche: string;
  discoveredPostId: string;
  targetExternalId: string;
  targetAuthorId: string;
  status: EngagementStatus;
  delivery: ReplyDelivery;
  dryRun: boolean;
  content?: string;
  contentHash?: string;
  aiModel?: string;
  validationIssues?: string[];
  error?: string;
}

export interface EngagementView {
  id: string;
  status: EngagementStatus;
  delivery: ReplyDelivery;
  content: string | null;
  targetExternalId: string;
  targetAuthorId: string;
  dryRun: boolean;
  createdAt: Date;
  post: {
    text: string;
    authorUsername: string | null;
    relevanceScore: number | null;
    origin: "SEARCH" | "MENTION";
  };
}

export interface EngagementRepository {
  /** Returns null when the target already has an engagement (unique constraint). */
  create(input: NewEngagement): Promise<string | null>;
  get(id: string): Promise<EngagementView | null>;
  list(
    niche: string,
    statuses: EngagementStatus[],
    limit: number,
    delivery?: ReplyDelivery,
  ): Promise<EngagementView[]>;
  countByStatus(niche: string, status: EngagementStatus): Promise<number>;
  /** Replies posted since `since` in the given mode (dry-run and live are counted separately). */
  countPostedSince(niche: string, since: Date, dryRun: boolean): Promise<number>;
  countForAuthorSince(authorId: string, since: Date): Promise<number>;
  /** Content of recent non-rejected drafts/replies, newest first. */
  recentContents(niche: string, limit: number): Promise<string[]>;
  approve(id: string, content?: string, contentHash?: string): Promise<void>;
  reject(id: string): Promise<void>;
  markPosted(id: string, externalId: string | null): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

const VIEW_SELECT = {
  id: true,
  status: true,
  delivery: true,
  content: true,
  targetExternalId: true,
  targetAuthorId: true,
  dryRun: true,
  createdAt: true,
  discoveredPost: { select: { text: true, authorUsername: true, relevanceScore: true, origin: true } },
} as const;

type ViewRow = {
  id: string;
  status: EngagementStatus;
  delivery: ReplyDelivery;
  content: string | null;
  targetExternalId: string;
  targetAuthorId: string;
  dryRun: boolean;
  createdAt: Date;
  discoveredPost: EngagementView["post"];
};

function toView({ discoveredPost, ...row }: ViewRow): EngagementView {
  return { ...row, post: discoveredPost };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export class PrismaEngagementRepository implements EngagementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: NewEngagement): Promise<string | null> {
    try {
      const row = await this.prisma.engagement.create({
        data: { ...input, platform: "X", type: "REPLY" },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async get(id: string): Promise<EngagementView | null> {
    const row = await this.prisma.engagement.findUnique({ where: { id }, select: VIEW_SELECT });
    return row ? toView(row) : null;
  }

  async list(
    niche: string,
    statuses: EngagementStatus[],
    limit: number,
    delivery?: ReplyDelivery,
  ): Promise<EngagementView[]> {
    const rows = await this.prisma.engagement.findMany({
      where: { niche, status: { in: statuses }, ...(delivery && { delivery }) },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: VIEW_SELECT,
    });
    return rows.map(toView);
  }

  countByStatus(niche: string, status: EngagementStatus): Promise<number> {
    return this.prisma.engagement.count({ where: { niche, status } });
  }

  countPostedSince(niche: string, since: Date, dryRun: boolean): Promise<number> {
    return this.prisma.engagement.count({
      where: { niche, status: "POSTED", dryRun, postedAt: { gte: since } },
    });
  }

  countForAuthorSince(authorId: string, since: Date): Promise<number> {
    return this.prisma.engagement.count({
      where: { targetAuthorId: authorId, status: { in: ACTIVE_STATUSES }, createdAt: { gte: since } },
    });
  }

  async recentContents(niche: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.engagement.findMany({
      where: { niche, status: { in: ACTIVE_STATUSES }, content: { not: null } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { content: true },
    });
    return rows.map((r) => r.content!);
  }

  async approve(id: string, content?: string, contentHash?: string): Promise<void> {
    await this.prisma.engagement.update({
      where: { id },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        ...(content && { content }),
        ...(contentHash && { contentHash }),
      },
    });
  }

  async reject(id: string): Promise<void> {
    await this.prisma.engagement.update({
      where: { id },
      data: { status: "REJECTED", reviewedAt: new Date() },
    });
  }

  async markPosted(id: string, externalId: string | null): Promise<void> {
    await this.prisma.engagement.update({
      where: { id },
      data: { status: "POSTED", postedAt: new Date(), externalId, error: null },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.engagement.update({ where: { id }, data: { status: "FAILED", error } });
  }
}
