-- AlterEnum
BEGIN;
CREATE TYPE "PublishedPostStatus_new" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'POSTED', 'FAILED');
ALTER TABLE "PublishedPost" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PublishedPost" ALTER COLUMN "status" TYPE "PublishedPostStatus_new" USING ("status"::text::"PublishedPostStatus_new");
ALTER TYPE "PublishedPostStatus" RENAME TO "PublishedPostStatus_old";
ALTER TYPE "PublishedPostStatus_new" RENAME TO "PublishedPostStatus";
DROP TYPE "PublishedPostStatus_old";
ALTER TABLE "PublishedPost" ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW';
COMMIT;

-- AlterTable
ALTER TABLE "PublishedPost" DROP COLUMN "scheduledFor",
ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "topic" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW';

-- CreateIndex
CREATE INDEX "PublishedPost_niche_status_postedAt_idx" ON "PublishedPost"("niche", "status", "postedAt");

