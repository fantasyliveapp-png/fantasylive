-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PayoutMethod" ADD VALUE 'WIRE_TRANSFER';
ALTER TYPE "PayoutMethod" ADD VALUE 'USDT_TRC20';

-- AlterTable
-- Bloqueo geografico gestionado por cada modelo (ISO 3166-1 alpha-2)
ALTER TABLE "model_profiles" ADD COLUMN     "blockedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
-- Pais resuelto del usuario al entrar en la cola de emparejamiento
ALTER TABLE "match_queue_entries" ADD COLUMN     "selfCountry" TEXT;

-- AlterTable
-- Destino de cobro enmascarado (el campo "destination" pasa a guardarse cifrado)
ALTER TABLE "payout_requests" ADD COLUMN     "destinationMasked" TEXT;
