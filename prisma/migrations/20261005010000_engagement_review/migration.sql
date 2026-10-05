-- AlterTable
ALTER TABLE "Engagement" ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "targetAuthorId" TEXT NOT NULL,
ADD COLUMN     "validationIssues" TEXT[];

-- CreateIndex
CREATE INDEX "Engagement_niche_status_postedAt_idx" ON "Engagement"("niche", "status", "postedAt");

-- CreateIndex
CREATE INDEX "Engagement_targetAuthorId_createdAt_idx" ON "Engagement"("targetAuthorId", "createdAt");

