-- =============================================================================
-- FantasyLive - feed social, directos, analiticas de creadora y tarifas
-- fraccionarias en centitokens.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- AlterEnum
-- -----------------------------------------------------------------------------
ALTER TYPE "TransactionType" ADD VALUE 'POST_UNLOCK';
ALTER TYPE "TransactionType" ADD VALUE 'POST_EARNING';
ALTER TYPE "TransactionType" ADD VALUE 'PAYOUT_FEE';

ALTER TYPE "NotificationType" ADD VALUE 'LIVE_STARTED';
ALTER TYPE "NotificationType" ADD VALUE 'NEW_POST';
ALTER TYPE "NotificationType" ADD VALUE 'GIFT_RECEIVED';

-- -----------------------------------------------------------------------------
-- CreateEnum
-- -----------------------------------------------------------------------------
CREATE TYPE "LiveStreamStatus" AS ENUM ('PREPARING', 'LIVE', 'ENDED');
CREATE TYPE "LiveStreamSource" AS ENUM ('BROWSER', 'OBS_RTMP');
CREATE TYPE "PostVisibility" AS ENUM ('PUBLIC', 'LOCKED', 'SUBSCRIBERS');
CREATE TYPE "VisitSource" AS ENUM ('PROFILE', 'LIVE', 'POST');

-- -----------------------------------------------------------------------------
-- AlterTable: tarifas por minuto en CENTITOKENS
--
-- El minimo que puede pedir una creadora (1,75 tokens/min) tiene decimales, y
-- un Int de tokens no los representa. Se pasa a centitokens (x100) para que el
-- cobro siga siendo aritmetica entera. Los valores existentes se multiplican
-- por 100 y se recortan al rango permitido [175, 2500]: los perfiles semilla
-- estaban a 40 tokens/min, por encima del nuevo tope de 25.
-- -----------------------------------------------------------------------------
ALTER TABLE "model_profiles"
  RENAME COLUMN "vipRatePerMinute" TO "vipRateCentitokens";
ALTER TABLE "model_profiles"
  RENAME COLUMN "privateRatePerMinute" TO "privateRateCentitokens";

UPDATE "model_profiles"
   SET "vipRateCentitokens" = LEAST(2500, GREATEST(175, "vipRateCentitokens" * 100)),
       "privateRateCentitokens" = LEAST(2500, GREATEST(175, "privateRateCentitokens" * 100));

ALTER TABLE "model_profiles"
  ALTER COLUMN "vipRateCentitokens" SET DEFAULT 250,
  ALTER COLUMN "privateRateCentitokens" SET DEFAULT 250;

-- Duracion minima facturable de una llamada de pago: 5 minutos.
UPDATE "model_profiles" SET "minPrivateMinutes" = 5 WHERE "minPrivateMinutes" < 5;
ALTER TABLE "model_profiles" ALTER COLUMN "minPrivateMinutes" SET DEFAULT 5;

-- -----------------------------------------------------------------------------
-- AlterTable: saludo automatico, directos y contadores de perfil
-- -----------------------------------------------------------------------------
ALTER TABLE "model_profiles"
  ADD COLUMN "autoGreetingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoGreetingText" TEXT,
  ADD COLUMN "autoGreetingAssetKey" TEXT,
  ADD COLUMN "autoGreetingAssetMime" TEXT,
  ADD COLUMN "autoGreetingPreviewKey" TEXT,
  ADD COLUMN "autoGreetingPriceTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "autoGreetingDailyLimit" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "autoGreetingSentToday" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "autoGreetingCounterDay" TEXT,
  ADD COLUMN "liveEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "streamKey" TEXT,
  ADD COLUMN "postsCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "profileViews" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "model_profiles_streamKey_key" ON "model_profiles"("streamKey");
CREATE INDEX "model_profiles_liveEnabled_idx" ON "model_profiles"("liveEnabled");

-- -----------------------------------------------------------------------------
-- AlterTable: la tarifa de la sesion tambien pasa a centitokens
-- -----------------------------------------------------------------------------
ALTER TABLE "call_sessions" RENAME COLUMN "ratePerMinute" TO "rateCentitokens";
UPDATE "call_sessions" SET "rateCentitokens" = "rateCentitokens" * 100;

-- La tarifa congelada en la reserva usa la misma unidad.
ALTER TABLE "bookings" RENAME COLUMN "ratePerMinute" TO "rateCentitokens";
UPDATE "bookings" SET "rateCentitokens" = "rateCentitokens" * 100;

-- -----------------------------------------------------------------------------
-- AlterTable: regalos enviados en un directo
-- -----------------------------------------------------------------------------
ALTER TABLE "gifts" ADD COLUMN "streamId" TEXT;

-- -----------------------------------------------------------------------------
-- AlterTable: comision de retiro (10%)
-- -----------------------------------------------------------------------------
ALTER TABLE "payout_requests"
  ADD COLUMN "feeTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "netTokens" INTEGER NOT NULL DEFAULT 0;

-- Los retiros historicos se pidieron sin comision: el neto es el bruto.
UPDATE "payout_requests" SET "netTokens" = "tokens" WHERE "netTokens" = 0;

-- -----------------------------------------------------------------------------
-- AlterTable: vinculos de transacciones al feed y a los directos
-- -----------------------------------------------------------------------------
ALTER TABLE "transactions"
  ADD COLUMN "postId" TEXT,
  ADD COLUMN "liveStreamId" TEXT;

-- -----------------------------------------------------------------------------
-- CreateTable: feed social
-- -----------------------------------------------------------------------------
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "body" TEXT,
    "visibility" "PostVisibility" NOT NULL DEFAULT 'PUBLIC',
    "priceTokens" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "unlockCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "tokensEarned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "posts_isPublished_createdAt_idx" ON "posts"("isPublished", "createdAt");
CREATE INDEX "posts_modelId_createdAt_idx" ON "posts"("modelId", "createdAt");

CREATE TABLE "post_assets" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "previewKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "post_assets_postId_sortOrder_idx" ON "post_assets"("postId", "sortOrder");

CREATE TABLE "post_unlocks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "tokensSpent" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_unlocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "post_unlocks_userId_postId_key" ON "post_unlocks"("userId", "postId");
CREATE INDEX "post_unlocks_postId_idx" ON "post_unlocks"("postId");

CREATE TABLE "post_likes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "post_likes_userId_postId_key" ON "post_likes"("userId", "postId");
CREATE INDEX "post_likes_postId_idx" ON "post_likes"("postId");

CREATE TABLE "post_comments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "post_comments_postId_createdAt_idx" ON "post_comments"("postId", "createdAt");

-- -----------------------------------------------------------------------------
-- CreateTable: directos
-- -----------------------------------------------------------------------------
CREATE TABLE "live_streams" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" "LiveStreamStatus" NOT NULL DEFAULT 'PREPARING',
    "source" "LiveStreamSource" NOT NULL DEFAULT 'BROWSER',
    "title" TEXT,
    "roomName" TEXT NOT NULL,
    "ingressId" TEXT,
    "rtmpUrl" TEXT,
    "streamKey" TEXT,
    "viewerCount" INTEGER NOT NULL DEFAULT 0,
    "viewerPeak" INTEGER NOT NULL DEFAULT 0,
    "uniqueViewers" INTEGER NOT NULL DEFAULT 0,
    "giftsCount" INTEGER NOT NULL DEFAULT 0,
    "tokensEarned" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_streams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "live_streams_roomName_key" ON "live_streams"("roomName");
CREATE INDEX "live_streams_status_startedAt_idx" ON "live_streams"("status", "startedAt");
CREATE INDEX "live_streams_modelId_createdAt_idx" ON "live_streams"("modelId", "createdAt");

-- -----------------------------------------------------------------------------
-- CreateTable: analiticas de creadora
-- -----------------------------------------------------------------------------
CREATE TABLE "profile_visits" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "viewerId" TEXT,
    "source" "VisitSource" NOT NULL DEFAULT 'PROFILE',
    "country" TEXT,
    "day" TEXT NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_visits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "profile_visits_modelId_viewerId_source_day_key"
  ON "profile_visits"("modelId", "viewerId", "source", "day");
CREATE INDEX "profile_visits_modelId_createdAt_idx" ON "profile_visits"("modelId", "createdAt");
CREATE INDEX "profile_visits_modelId_viewerId_idx" ON "profile_visits"("modelId", "viewerId");

CREATE TABLE "auto_greeting_logs" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "VisitSource" NOT NULL DEFAULT 'PROFILE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_greeting_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auto_greeting_logs_modelId_userId_key" ON "auto_greeting_logs"("modelId", "userId");
CREATE INDEX "auto_greeting_logs_modelId_createdAt_idx" ON "auto_greeting_logs"("modelId", "createdAt");

-- -----------------------------------------------------------------------------
-- AddForeignKey
-- -----------------------------------------------------------------------------
ALTER TABLE "posts" ADD CONSTRAINT "posts_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "post_assets" ADD CONSTRAINT "post_assets_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "post_unlocks" ADD CONSTRAINT "post_unlocks_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_unlocks" ADD CONSTRAINT "post_unlocks_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "live_streams" ADD CONSTRAINT "live_streams_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "profile_visits" ADD CONSTRAINT "profile_visits_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_visits" ADD CONSTRAINT "profile_visits_viewerId_fkey"
  FOREIGN KEY ("viewerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auto_greeting_logs" ADD CONSTRAINT "auto_greeting_logs_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auto_greeting_logs" ADD CONSTRAINT "auto_greeting_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gifts" ADD CONSTRAINT "gifts_streamId_fkey"
  FOREIGN KEY ("streamId") REFERENCES "live_streams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "gifts_streamId_createdAt_idx" ON "gifts"("streamId", "createdAt");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_liveStreamId_fkey"
  FOREIGN KEY ("liveStreamId") REFERENCES "live_streams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
