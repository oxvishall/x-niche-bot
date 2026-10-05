import type { PrismaClient } from "../../generated/prisma/client.js";

export type PublishedPostStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "POSTED" | "FAILED";

/** Statuses whose content counts for duplicate checks. */
const ACTIVE_STATUSES: PublishedPostStatus[] = ["PENDING_REVIEW", "APPROVED", "POSTED"];

export interface NewPublishedPost {
  niche: string;
  content: string;
  contentHash: string;
  topic?: string;
  status: PublishedPostStatus;
  dryRun: boolean;
  aiModel?: string;
  externalId?: string | null;
  postedAt?: Date;
  error?: string;
}

export interface PublishedPostView {
  id: string;
  status: PublishedPostStatus;
  content: string;
  topic: string | null;
  dryRun: boolean;
  createdAt: Date;
  postedAt: Date | null;
}

export interface PublishedPostRepository {
  create(input: NewPublishedPost): Promise<string>;
  get(id: string): Promise<PublishedPostView | null>;
  /** `dryRun`, when given, limits results to rows created in that mode. */
  list(
    niche: string,
    statuses: PublishedPostStatus[],
    limit: number,
    dryRun?: boolean,
  ): Promise<PublishedPostView[]>;
  countByStatus(niche: string, status: PublishedPostStatus): Promise<number>;
  countPostedSince(niche: string, since: Date, dryRun: boolean): Promise<number>;
  lastPostedAt(niche: string, dryRun: boolean): Promise<Date | null>;
  recentContents(niche: string, limit: number): Promise<string[]>;
  /** When each topic was last used (any non-rejected status). */
  topicLastUsed(niche: string): Promise<Map<string, Date>>;
  approve(id: string, content?: string, contentHash?: string): Promise<void>;
  reject(id: string): Promise<void>;
  markPosted(id: string, externalId: string | null): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

const VIEW_SELECT = {
  id: true,
  status: true,
  content: true,
  topic: true,
  dryRun: true,
  createdAt: true,
  postedAt: true,
} as const;

export class PrismaPublishedPostRepository implements PublishedPostRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: NewPublishedPost): Promise<string> {
    const row = await this.prisma.publishedPost.create({
      data: { ...input, platform: "X" },
      select: { id: true },
    });
    return row.id;
  }

  get(id: string): Promise<PublishedPostView | null> {
    return this.prisma.publishedPost.findUnique({ where: { id }, select: VIEW_SELECT });
  }

  list(
    niche: string,
    statuses: PublishedPostStatus[],
    limit: number,
    dryRun?: boolean,
  ): Promise<PublishedPostView[]> {
    return this.prisma.publishedPost.findMany({
      where: { niche, status: { in: statuses }, ...(dryRun !== undefined && { dryRun }) },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: VIEW_SELECT,
    });
  }

  countByStatus(niche: string, status: PublishedPostStatus): Promise<number> {
    return this.prisma.publishedPost.count({ where: { niche, status } });
  }

  countPostedSince(niche: string, since: Date, dryRun: boolean): Promise<number> {
    return this.prisma.publishedPost.count({
      where: { niche, status: "POSTED", dryRun, postedAt: { gte: since } },
    });
  }

  async lastPostedAt(niche: string, dryRun: boolean): Promise<Date | null> {
    const row = await this.prisma.publishedPost.findFirst({
      where: { niche, status: "POSTED", dryRun },
      orderBy: { postedAt: "desc" },
      select: { postedAt: true },
    });
    return row?.postedAt ?? null;
  }

  async recentContents(niche: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.publishedPost.findMany({
      where: { niche, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { content: true },
    });
    return rows.map((r) => r.content);
  }

  async topicLastUsed(niche: string): Promise<Map<string, Date>> {
    const rows = await this.prisma.publishedPost.groupBy({
      by: ["topic"],
      where: { niche, status: { in: ACTIVE_STATUSES }, topic: { not: null } },
      _max: { createdAt: true },
    });
    return new Map(rows.map((r) => [r.topic!, r._max.createdAt!]));
  }

  async approve(id: string, content?: string, contentHash?: string): Promise<void> {
    await this.prisma.publishedPost.update({
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
    await this.prisma.publishedPost.update({
      where: { id },
      data: { status: "REJECTED", reviewedAt: new Date() },
    });
  }

  async markPosted(id: string, externalId: string | null): Promise<void> {
    await this.prisma.publishedPost.update({
      where: { id },
      data: { status: "POSTED", postedAt: new Date(), externalId, error: null },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.publishedPost.update({ where: { id }, data: { status: "FAILED", error } });
  }
}
