-- Controles en vivo: pausa, espejo, mensaje fijado, acceso (suscriptores / de pago),
-- encuestas, entradas, sanciones, palabras bloqueadas y menu de propinas.
-- CreateEnum
CREATE TYPE "LiveAccessMode" AS ENUM ('PUBLIC', 'SUBSCRIBERS', 'PAID');


-- AlterTable
ALTER TABLE "live_streams" ADD COLUMN     "accessMode" "LiveAccessMode" NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN     "mirrored" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "pinnedMessage" TEXT,
ADD COLUMN     "ticketFreeForSubscribers" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ticketTokens" INTEGER;

-- AlterTable
ALTER TABLE "model_profiles" ADD COLUMN     "liveBlockedWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "liveTipMenu" JSONB;

-- CreateTable
CREATE TABLE "live_polls" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_poll_votes" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "option" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_tickets" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_sanctions" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_polls_streamId_createdAt_idx" ON "live_polls"("streamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "live_poll_votes_pollId_userId_key" ON "live_poll_votes"("pollId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "live_tickets_streamId_userId_key" ON "live_tickets"("streamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "live_sanctions_streamId_userId_kind_key" ON "live_sanctions"("streamId", "userId", "kind");

-- AddForeignKey
ALTER TABLE "live_polls" ADD CONSTRAINT "live_polls_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "live_streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_poll_votes" ADD CONSTRAINT "live_poll_votes_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "live_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_tickets" ADD CONSTRAINT "live_tickets_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "live_streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sanctions" ADD CONSTRAINT "live_sanctions_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "live_streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

