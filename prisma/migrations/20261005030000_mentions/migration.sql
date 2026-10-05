-- CreateEnum
CREATE TYPE "PostOrigin" AS ENUM ('SEARCH', 'MENTION');

-- CreateEnum
CREATE TYPE "ReplyDelivery" AS ENUM ('INTENT', 'API');

-- DropIndex
DROP INDEX "DiscoveredPost_niche_eligible_relevanceScore_idx";

-- AlterTable
ALTER TABLE "DiscoveredPost" ADD COLUMN     "inReplyToPostId" TEXT,
ADD COLUMN     "origin" "PostOrigin" NOT NULL DEFAULT 'SEARCH',
ADD COLUMN     "parentText" TEXT;

-- AlterTable
ALTER TABLE "Engagement" ADD COLUMN     "delivery" "ReplyDelivery" NOT NULL DEFAULT 'INTENT';

-- CreateIndex
CREATE INDEX "DiscoveredPost_niche_origin_eligible_relevanceScore_idx" ON "DiscoveredPost"("niche", "origin", "eligible", "relevanceScore");

-- CreateIndex
CREATE INDEX "Engagement_niche_status_delivery_idx" ON "Engagement"("niche", "status", "delivery");

