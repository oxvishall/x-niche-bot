-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('X');

-- CreateEnum
CREATE TYPE "RunType" AS ENUM ('DISCOVERY', 'ENGAGEMENT', 'PUBLISHING');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "EngagementType" AS ENUM ('REPLY');

-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'POSTED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PublishedPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'POSTED', 'FAILED');

-- CreateTable
CREATE TABLE "BotRun" (
    "id" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "type" "RunType" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "stats" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BotRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRun" (
    "id" TEXT NOT NULL,
    "botRunId" TEXT,
    "niche" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "newestId" TEXT,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredPost" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'X',
    "externalId" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "searchRunId" TEXT,
    "authorId" TEXT NOT NULL,
    "authorUsername" TEXT,
    "text" TEXT NOT NULL,
    "lang" TEXT,
    "conversationId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "repostCount" INTEGER NOT NULL DEFAULT 0,
    "quoteCount" INTEGER NOT NULL DEFAULT 0,
    "relevanceScore" DOUBLE PRECISION,
    "scoreBreakdown" JSONB,
    "matchedKeywords" TEXT[],
    "matchedHashtags" TEXT[],
    "excludedMatches" TEXT[],
    "filterReasons" TEXT[],
    "passedFilters" BOOLEAN,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveredPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'X',
    "niche" TEXT NOT NULL,
    "discoveredPostId" TEXT NOT NULL,
    "targetExternalId" TEXT NOT NULL,
    "type" "EngagementType" NOT NULL DEFAULT 'REPLY',
    "status" "EngagementStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "content" TEXT,
    "contentHash" TEXT,
    "externalId" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishedPost" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'X',
    "niche" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "PublishedPostStatus" NOT NULL DEFAULT 'DRAFT',
    "externalId" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishedPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotRun_niche_type_startedAt_idx" ON "BotRun"("niche", "type", "startedAt");

-- CreateIndex
CREATE INDEX "SearchRun_niche_query_startedAt_idx" ON "SearchRun"("niche", "query", "startedAt");

-- CreateIndex
CREATE INDEX "SearchRun_botRunId_idx" ON "SearchRun"("botRunId");

-- CreateIndex
CREATE INDEX "DiscoveredPost_niche_eligible_relevanceScore_idx" ON "DiscoveredPost"("niche", "eligible", "relevanceScore");

-- CreateIndex
CREATE INDEX "DiscoveredPost_niche_postedAt_idx" ON "DiscoveredPost"("niche", "postedAt");

-- CreateIndex
CREATE INDEX "DiscoveredPost_authorId_idx" ON "DiscoveredPost"("authorId");

-- CreateIndex
CREATE INDEX "DiscoveredPost_searchRunId_idx" ON "DiscoveredPost"("searchRunId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredPost_platform_externalId_niche_key" ON "DiscoveredPost"("platform", "externalId", "niche");

-- CreateIndex
CREATE INDEX "Engagement_niche_status_createdAt_idx" ON "Engagement"("niche", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Engagement_contentHash_idx" ON "Engagement"("contentHash");

-- CreateIndex
CREATE INDEX "Engagement_discoveredPostId_idx" ON "Engagement"("discoveredPostId");

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_platform_targetExternalId_type_key" ON "Engagement"("platform", "targetExternalId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_platform_externalId_key" ON "Engagement"("platform", "externalId");

-- CreateIndex
CREATE INDEX "PublishedPost_niche_status_createdAt_idx" ON "PublishedPost"("niche", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PublishedPost_niche_contentHash_idx" ON "PublishedPost"("niche", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedPost_platform_externalId_key" ON "PublishedPost"("platform", "externalId");

-- AddForeignKey
ALTER TABLE "SearchRun" ADD CONSTRAINT "SearchRun_botRunId_fkey" FOREIGN KEY ("botRunId") REFERENCES "BotRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredPost" ADD CONSTRAINT "DiscoveredPost_searchRunId_fkey" FOREIGN KEY ("searchRunId") REFERENCES "SearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_discoveredPostId_fkey" FOREIGN KEY ("discoveredPostId") REFERENCES "DiscoveredPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

