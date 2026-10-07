-- Se descarta el bloqueo por pais del medio de pago.
ALTER TABLE "users" DROP COLUMN "paymentCountries";
