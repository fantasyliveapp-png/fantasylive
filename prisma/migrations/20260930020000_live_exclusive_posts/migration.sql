
-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "liveExclusiveAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "posts_modelId_liveExclusiveAt_idx" ON "posts"("modelId", "liveExclusiveAt");

