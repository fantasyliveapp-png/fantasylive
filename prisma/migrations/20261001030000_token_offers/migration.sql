-- Ofertas de tokens: ventana de "Te echamos de menos" (48 h) por usuario.
ALTER TABLE "users" ADD COLUMN "winbackOfferStartedAt" TIMESTAMP(3);

-- Paquetes (opcion A): descuento por volumen que nunca hace perder dinero,
-- ni con creadores Fundadores al 60%.
UPDATE "token_packages" SET "tokens" = 100,  "bonusTokens" = 0,   "priceCents" = 999,   "description" = 'Ideal para probar la plataforma'          WHERE "sku" = 'starter-100';
UPDATE "token_packages" SET "tokens" = 300,  "bonusTokens" = 15,  "priceCents" = 2899,  "description" = '15 tokens de regalo'                      WHERE "sku" = 'basic-300';
UPDATE "token_packages" SET "tokens" = 750,  "bonusTokens" = 50,  "priceCents" = 6999,  "description" = 'El mas elegido: 50 tokens extra'          WHERE "sku" = 'popular-750';
UPDATE "token_packages" SET "tokens" = 1600, "bonusTokens" = 150, "priceCents" = 14499, "description" = '150 tokens extra + acceso anticipado'     WHERE "sku" = 'premium-1600';
UPDATE "token_packages" SET "tokens" = 4000, "bonusTokens" = 400, "priceCents" = 34999, "description" = '400 tokens extra + soporte prioritario'   WHERE "sku" = 'whale-4000';
