-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'POST_INSIGHT';

-- AlterTable
ALTER TABLE "post_impressions" ADD COLUMN     "completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dwellMs" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "completions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skips" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "watchMs" BIGINT NOT NULL DEFAULT 0;

