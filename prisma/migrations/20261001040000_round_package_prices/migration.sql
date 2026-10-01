-- Precios redondos: Basic 29,99 y Premium 149,99 (antes 28,99 y 144,99).
UPDATE "token_packages" SET "priceCents" = 2999  WHERE "sku" = 'basic-300'    AND "priceCents" = 2899;
UPDATE "token_packages" SET "priceCents" = 14999 WHERE "sku" = 'premium-1600' AND "priceCents" = 14499;
