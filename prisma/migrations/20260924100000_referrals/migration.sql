-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'REFERRAL_EARNING';

-- AlterTable
ALTER TABLE "model_profiles" ADD COLUMN     "founderNumber" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "referredById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "model_profiles_founderNumber_key" ON "model_profiles"("founderNumber");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Fundadoras: las creadoras ya verificadas, por orden de alta.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt") AS n
  FROM "model_profiles" WHERE "kycStatus" = 'APPROVED'
)
UPDATE "model_profiles" m SET "founderNumber" = o.n
FROM ordered o WHERE m.id = o.id AND o.n <= 100;
