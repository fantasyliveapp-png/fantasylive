-- AlterEnum
-- PayPal como proveedor de pago de las transacciones.
ALTER TYPE "PaymentProvider" ADD VALUE 'PAYPAL';

-- AlterTable
-- Perfiles atendidos por IA. isAi no es un detalle interno: la mensajeria se
-- cobra en tokens, asi que la interfaz lo declara en el catalogo, en la ficha
-- y en cada mensaje generado.
ALTER TABLE "model_profiles"
  ADD COLUMN "isAi" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiPersona" TEXT,
  ADD COLUMN "aiModel" TEXT NOT NULL DEFAULT 'claude-opus-5';

-- AlterTable
-- Marca del mensaje generado por el asistente de un perfil isAi.
ALTER TABLE "messages"
  ADD COLUMN "isAiGenerated" BOOLEAN NOT NULL DEFAULT false;
