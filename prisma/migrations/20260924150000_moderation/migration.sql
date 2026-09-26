-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MODERATION';

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "removedReason" TEXT;
