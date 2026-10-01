
-- AlterTable
ALTER TABLE "follows" ADD COLUMN     "notifyLive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyPosts" BOOLEAN NOT NULL DEFAULT true;

