-- El minimo por minuto pasa de 1,75 a 17,5 tokens (rango 17,5 - 250, default 25).
-- Las tarifas existentes se escalan x10 y se recortan al nuevo rango.
ALTER TABLE "model_profiles" ALTER COLUMN "vipRateCentitokens" SET DEFAULT 2500,
                             ALTER COLUMN "privateRateCentitokens" SET DEFAULT 2500;

UPDATE "model_profiles" SET
  "vipRateCentitokens"     = LEAST(25000, GREATEST(1750, "vipRateCentitokens" * 10)),
  "privateRateCentitokens" = LEAST(25000, GREATEST(1750, "privateRateCentitokens" * 10))
WHERE "vipRateCentitokens" < 1750 OR "privateRateCentitokens" < 1750;
