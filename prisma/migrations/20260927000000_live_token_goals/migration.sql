-- Metas de tokens en los directos
ALTER TABLE "live_streams" ADD COLUMN "goalLabel" TEXT,
ADD COLUMN "goalTokens" INTEGER,
ADD COLUMN "goalProgress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "goalReachedAt" TIMESTAMP(3);
