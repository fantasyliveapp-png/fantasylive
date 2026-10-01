-- AlterTable
ALTER TABLE "distributor_accounts" ALTER COLUMN "pricePer100" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "distributor_sales" ADD COLUMN     "packageId" TEXT,
ADD COLUMN     "paymentProofKey" TEXT;

-- AlterTable
ALTER TABLE "distributors" ADD COLUMN     "isAvailable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "distributor_packages" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distributor_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "distributor_packages_accountId_active_idx" ON "distributor_packages"("accountId", "active");

-- AddForeignKey
ALTER TABLE "distributor_packages" ADD CONSTRAINT "distributor_packages_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "distributor_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_sales" ADD CONSTRAINT "distributor_sales_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "distributor_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Metodos que ya existian: paquetes de 100, 500 y 1000 tokens a su precio de antes.
INSERT INTO "distributor_packages" ("id", "accountId", "tokens", "price")
SELECT 'pk' || md5(a."id" || t.n::text), a."id", t.n, (a."pricePer100" * t.n / 100)
FROM "distributor_accounts" a CROSS JOIN (VALUES (100), (500), (1000)) AS t(n)
WHERE a."pricePer100" > 0;
