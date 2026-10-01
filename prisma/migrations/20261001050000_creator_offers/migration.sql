-- CreateEnum
CREATE TYPE "CreatorOfferKind" AS ENUM ('HAPPY_HOUR', 'FLASH_SALE', 'FIRST_MONTH', 'FIRST_CALL', 'COUPON');

-- CreateEnum
CREATE TYPE "CouponTarget" AS ENUM ('CALL', 'CONTENT');

-- CreateTable
CREATE TABLE "creator_offers" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "kind" "CreatorOfferKind" NOT NULL,
    "percentOff" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "fanId" TEXT,
    "target" "CouponTarget",
    "usedAt" TIMESTAMP(3),
    "uses" INTEGER NOT NULL DEFAULT 0,
    "tokensPaid" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creator_offers_modelId_kind_active_idx" ON "creator_offers"("modelId", "kind", "active");

-- CreateIndex
CREATE INDEX "creator_offers_fanId_usedAt_idx" ON "creator_offers"("fanId", "usedAt");

-- AddForeignKey
ALTER TABLE "creator_offers" ADD CONSTRAINT "creator_offers_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_offers" ADD CONSTRAINT "creator_offers_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

