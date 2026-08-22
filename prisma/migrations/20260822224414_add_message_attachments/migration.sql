-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MESSAGE_ATTACHMENT_UNLOCKED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'MESSAGE_ATTACHMENT_UNLOCK';
ALTER TYPE "TransactionType" ADD VALUE 'MESSAGE_ATTACHMENT_EARNING';

-- AlterTable
ALTER TABLE "messages" ALTER COLUMN "body" DROP NOT NULL;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "messageAttachmentId" TEXT;

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "priceTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachment_unlocks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "tokensSpent" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachment_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_attachments_messageId_key" ON "message_attachments"("messageId");

-- CreateIndex
CREATE INDEX "message_attachment_unlocks_userId_createdAt_idx" ON "message_attachment_unlocks"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_attachment_unlocks_userId_attachmentId_key" ON "message_attachment_unlocks"("userId", "attachmentId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_messageAttachmentId_fkey" FOREIGN KEY ("messageAttachmentId") REFERENCES "message_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachment_unlocks" ADD CONSTRAINT "message_attachment_unlocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachment_unlocks" ADD CONSTRAINT "message_attachment_unlocks_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "message_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
