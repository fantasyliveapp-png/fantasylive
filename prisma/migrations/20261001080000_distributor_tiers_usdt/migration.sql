-- CreateEnum
CREATE TYPE "DistributorPayMethod" AS ENUM ('WIRE', 'USDT');

-- AlterTable
ALTER TABLE "distributor_orders" ADD COLUMN     "discountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentMethod" "DistributorPayMethod" NOT NULL DEFAULT 'WIRE';

-- AlterTable
ALTER TABLE "distributor_transfers" ADD COLUMN     "peerChatId" TEXT;

-- AlterTable
ALTER TABLE "distributors" ALTER COLUMN "centsPerToken" DROP NOT NULL;


-- Pedidos anteriores: el precio estaba en centavos, ahora en milesimas de centavo.
UPDATE "distributor_orders" SET "centsPerToken" = "centsPerToken" * 1000 WHERE "centsPerToken" < 1000;
