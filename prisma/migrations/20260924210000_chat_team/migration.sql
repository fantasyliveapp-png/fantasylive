-- CreateEnum
CREATE TYPE "ChatAssistantStatus" AS ENUM ('INVITED', 'ACTIVE', 'REMOVED');


-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TEAM_INVITE';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'CHATTER_EARNING';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "writtenById" TEXT;

-- CreateTable
CREATE TABLE "chat_assistants" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "status" "ChatAssistantStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "chat_assistants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_assistants_userId_status_idx" ON "chat_assistants"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "chat_assistants_modelId_userId_key" ON "chat_assistants"("modelId", "userId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_writtenById_fkey" FOREIGN KEY ("writtenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_assistants" ADD CONSTRAINT "chat_assistants_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_assistants" ADD CONSTRAINT "chat_assistants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

