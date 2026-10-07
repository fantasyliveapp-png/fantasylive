-- Bloqueo por paises con memoria (paises vistos y de pago) y deteccion de VPN.
ALTER TABLE "users" ADD COLUMN "seenCountries" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN "paymentCountries" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "match_queue_entries" ADD COLUMN "selfCountries" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "match_queue_entries" ADD COLUMN "selfVpn" BOOLEAN NOT NULL DEFAULT false;
