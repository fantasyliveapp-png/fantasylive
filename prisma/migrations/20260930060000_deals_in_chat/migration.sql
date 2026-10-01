
-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "chatUnlocked" BOOLEAN NOT NULL DEFAULT true;


-- Los pedidos y citas viven ahora dentro del chat con ese fan. A las parejas
-- fan-creador que ya tenian pedidos o citas pero no chat se les crea uno.
-- Si el creador cobra por abrir chat, el fan solo gestiona sus tarjetas
-- hasta que lo abra pagando (chatUnlocked = false).
INSERT INTO "conversations" ("id", "userId", "modelId", "unlockPriceTokens", "lastMessageAt", "acceptedAt", "chatUnlocked", "createdAt")
SELECT
  'deal_' || md5(p."userId" || p."modelId"),
  p."userId",
  p."modelId",
  0,
  p.at,
  p.at,
  (m."messagingEnabled" AND m."messagePriceTokens" = 0),
  p.at
FROM (
  SELECT "userId", "modelId", max("createdAt") AS at FROM (
    SELECT "userId", "modelId", "createdAt" FROM "content_requests"
    UNION ALL
    SELECT "userId", "modelId", "createdAt" FROM "bookings"
  ) x
  GROUP BY "userId", "modelId"
) p
JOIN "model_profiles" m ON m."id" = p."modelId"
WHERE NOT EXISTS (
  SELECT 1 FROM "conversations" c WHERE c."userId" = p."userId" AND c."modelId" = p."modelId"
);
