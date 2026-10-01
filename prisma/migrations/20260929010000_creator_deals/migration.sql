-- Trato negociado con una creadora: % propios mientras este vigente.
ALTER TABLE "model_profiles" ADD COLUMN "dealPlatformPercent" INTEGER;
ALTER TABLE "model_profiles" ADD COLUMN "dealAmbassadorPercent" INTEGER;
ALTER TABLE "model_profiles" ADD COLUMN "dealUntil" TIMESTAMP(3);
ALTER TABLE "model_profiles" ADD COLUMN "dealNotes" TEXT;
ALTER TABLE "model_profiles" ADD COLUMN "dealUpdatedAt" TIMESTAMP(3);
