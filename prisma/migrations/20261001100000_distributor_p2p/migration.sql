-- CreateEnum
CREATE TYPE "DistributorSaleStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'COMPLETED', 'CANCELLED', 'DISPUTED');

-- AlterTable
ALTER TABLE "distributor_transfers" ADD COLUMN     "saleId" TEXT;

-- AlterTable
ALTER TABLE "distributors" ALTER COLUMN "countries" DROP DEFAULT,
ALTER COLUMN "paymentMethods" DROP DEFAULT;

-- CreateTable
CREATE TABLE "distributor_accounts" (
    "id" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "pricePer100" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributor_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributor_sales" (
    "id" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "referenceAmount" INTEGER NOT NULL,
    "status" "DistributorSaleStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "paymentRef" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "disputedAt" TIMESTAMP(3),
    "disputeBy" TEXT,
    "disputeReason" TEXT,
    "resolvedById" TEXT,
    "rating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distributor_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "distributor_accounts_distributorId_active_idx" ON "distributor_accounts"("distributorId", "active");

-- CreateIndex
CREATE INDEX "distributor_sales_distributorId_status_idx" ON "distributor_sales"("distributorId", "status");

-- CreateIndex
CREATE INDEX "distributor_sales_fanId_createdAt_idx" ON "distributor_sales"("fanId", "createdAt");

-- CreateIndex
CREATE INDEX "distributor_sales_status_expiresAt_idx" ON "distributor_sales"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "distributor_accounts" ADD CONSTRAINT "distributor_accounts_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "distributors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_sales" ADD CONSTRAINT "distributor_sales_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "distributors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_sales" ADD CONSTRAINT "distributor_sales_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_sales" ADD CONSTRAINT "distributor_sales_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "distributor_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

