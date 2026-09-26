-- Red social: mensajes entre todos (chats entre personas, solicitudes y
-- privacidad de mensajes).
-- CreateEnum
CREATE TYPE "MessagePrivacy" AS ENUM ('EVERYONE', 'FOLLOWING', 'NOBODY');


-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "startedByModel" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "messagePrivacy" "MessagePrivacy" NOT NULL DEFAULT 'EVERYONE';

-- CreateTable
CREATE TABLE "peer_chats" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peer_messages" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "peer_chats_userAId_lastMessageAt_idx" ON "peer_chats"("userAId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "peer_chats_userBId_lastMessageAt_idx" ON "peer_chats"("userBId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "peer_chats_userAId_userBId_key" ON "peer_chats"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "peer_messages_chatId_createdAt_idx" ON "peer_messages"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "peer_chats" ADD CONSTRAINT "peer_chats_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_chats" ADD CONSTRAINT "peer_chats_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_messages" ADD CONSTRAINT "peer_messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "peer_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_messages" ADD CONSTRAINT "peer_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Los chats que ya existian los abrio y pago el fan: nacen aceptados.
UPDATE "conversations" SET "acceptedAt" = "createdAt" WHERE "acceptedAt" IS NULL;
