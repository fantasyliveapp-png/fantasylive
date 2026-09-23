-- CreateEnum
CREATE TYPE "ContentRequestStatus" AS ENUM ('PENDING', 'QUOTED', 'PAID', 'DELIVERED', 'DECLINED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'CONTENT_REQUEST_PAYMENT';
ALTER TYPE "TransactionType" ADD VALUE 'CONTENT_REQUEST_EARNING';
ALTER TYPE "TransactionType" ADD VALUE 'MESSAGE_UNLOCK';
ALTER TYPE "TransactionType" ADD VALUE 'MESSAGE_UNLOCK_EARNING';

-- AlterTable
ALTER TABLE "model_profiles" ADD COLUMN     "messagePriceTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "messagingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "contentRequestId" TEXT,
ADD COLUMN     "conversationId" TEXT;

-- CreateTable
CREATE TABLE "content_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" "ContentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT NOT NULL,
    "quotedTokens" INTEGER,
    "modelNote" TEXT,
    "deliveredPackageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quotedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "content_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "unlockPriceTokens" INTEGER NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_requests_deliveredPackageId_key" ON "content_requests"("deliveredPackageId");

-- CreateIndex
CREATE INDEX "content_requests_modelId_status_idx" ON "content_requests"("modelId", "status");

-- CreateIndex
CREATE INDEX "content_requests_userId_status_idx" ON "content_requests"("userId", "status");

-- CreateIndex
CREATE INDEX "conversations_modelId_lastMessageAt_idx" ON "conversations"("modelId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_userId_modelId_key" ON "conversations"("userId", "modelId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_contentRequestId_fkey" FOREIGN KEY ("contentRequestId") REFERENCES "content_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_deliveredPackageId_fkey" FOREIGN KEY ("deliveredPackageId") REFERENCES "content_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
