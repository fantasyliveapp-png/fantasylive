-- AlterTable
ALTER TABLE "distributor_orders" ADD COLUMN     "proofKey" TEXT,
ADD COLUMN     "proofUploadedAt" TIMESTAMP(3),
ADD COLUMN     "rejectReason" TEXT;
