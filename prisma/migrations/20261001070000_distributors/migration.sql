-- CreateEnum
CREATE TYPE "DistributorStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DistributorOrderStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'DISTRIBUTOR_CREDIT';

-- CreateTable
CREATE TABLE "distributors" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "taxId" TEXT,
    "publicContact" TEXT NOT NULL,
    "status" "DistributorStatus" NOT NULL DEFAULT 'ACTIVE',
    "centsPerToken" INTEGER NOT NULL,
    "dailyLimitTokens" INTEGER NOT NULL,
    "stockTokens" INTEGER NOT NULL DEFAULT 0,
    "idVerifiedAt" TIMESTAMP(3),
    "sanctionsCheckedAt" TIMESTAMP(3),
    "contractSignedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributor_orders" (
    "id" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "centsPerToken" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "DistributorOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentRef" TEXT,
    "confirmedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distributor_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributor_transfers" (
    "id" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distributor_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "distributors_userId_key" ON "distributors"("userId");

-- CreateIndex
CREATE INDEX "distributors_status_country_idx" ON "distributors"("status", "country");

-- CreateIndex
CREATE INDEX "distributor_orders_status_createdAt_idx" ON "distributor_orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "distributor_orders_distributorId_createdAt_idx" ON "distributor_orders"("distributorId", "createdAt");

-- CreateIndex
CREATE INDEX "distributor_transfers_distributorId_createdAt_idx" ON "distributor_transfers"("distributorId", "createdAt");

-- CreateIndex
CREATE INDEX "distributor_transfers_toUserId_createdAt_idx" ON "distributor_transfers"("toUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_orders" ADD CONSTRAINT "distributor_orders_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "distributors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_transfers" ADD CONSTRAINT "distributor_transfers_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "distributors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_transfers" ADD CONSTRAINT "distributor_transfers_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

