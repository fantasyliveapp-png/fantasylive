-- Distribuidores: paises donde venden y metodos de pago que aceptan (filtros del fan).
ALTER TABLE "distributors" ADD COLUMN "countries" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "distributors" ADD COLUMN "paymentMethods" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "distributors" SET "countries" = ARRAY["country"] WHERE cardinality("countries") = 0;
-- Mismo % para todos: el precio especial deja de usarse.
UPDATE "distributors" SET "centsPerToken" = NULL;
