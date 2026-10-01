-- Los PACKS antiguos pasan a ser publicaciones normales antes de borrar sus
-- tablas (en una base donde ya se convirtieron, esto no hace nada):
--   gratis -> publicacion gratis, de pago -> de pago, de suscriptores -> suscriptores.
-- Quien los compro los conserva desbloqueados y sus movimientos del monedero
-- quedan enlazados a la publicacion. Las miniaturas borrosas de archivos
-- propios se generan despues con `npm run db:backfill-previews`.

INSERT INTO "posts" ("id", "modelId", "body", "visibility", "priceTokens", "isPublished", "unlockCount", "tokensEarned", "createdAt", "updatedAt")
SELECT
  'pk_' || p."id",
  p."modelId",
  concat_ws(E'\n\n', p."title", NULLIF(p."description", '')),
  (CASE WHEN p."subscriberOnly" THEN 'SUBSCRIBERS' WHEN p."priceTokens" > 0 THEN 'LOCKED' ELSE 'PUBLIC' END)::"PostVisibility",
  CASE WHEN NOT p."subscriberOnly" AND p."priceTokens" > 0 THEN p."priceTokens" ELSE 0 END,
  p."isPublished",
  (SELECT count(*) FROM "content_unlocks" u WHERE u."packageId" = p."id"),
  p."tokensEarned",
  p."createdAt",
  now()
FROM "content_packages" p
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "post_assets" ("id", "postId", "storageKey", "previewKey", "mimeType", "sizeBytes", "width", "height", "durationSec", "sortOrder", "createdAt")
SELECT
  'pk_' || a."id",
  'pk_' || a."packageId",
  a."storageKey",
  CASE WHEN a."storageKey" ~ '^https?://picsum\.photos/'
    THEN regexp_replace(a."storageKey", '/[0-9]+/[0-9]+$', '/32/40') || '?blur=2' END,
  a."mimeType", a."sizeBytes", a."width", a."height", a."durationSec", a."sortOrder", a."createdAt"
FROM "content_assets" a
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "post_unlocks" ("id", "userId", "postId", "tokensSpent", "createdAt")
SELECT 'pk_' || u."id", u."userId", 'pk_' || u."packageId", u."tokensSpent", u."createdAt"
FROM "content_unlocks" u
ON CONFLICT DO NOTHING;

UPDATE "transactions"
SET "postId" = 'pk_' || "contentPackageId"
WHERE "contentPackageId" IS NOT NULL AND "postId" IS NULL
  AND EXISTS (SELECT 1 FROM "posts" WHERE "id" = 'pk_' || "contentPackageId");


-- DropForeignKey
ALTER TABLE "content_assets" DROP CONSTRAINT "content_assets_packageId_fkey";

-- DropForeignKey
ALTER TABLE "content_packages" DROP CONSTRAINT "content_packages_modelId_fkey";

-- DropForeignKey
ALTER TABLE "content_requests" DROP CONSTRAINT "content_requests_deliveredPackageId_fkey";

-- DropForeignKey
ALTER TABLE "content_unlocks" DROP CONSTRAINT "content_unlocks_packageId_fkey";

-- DropForeignKey
ALTER TABLE "content_unlocks" DROP CONSTRAINT "content_unlocks_userId_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_contentPackageId_fkey";

-- DropIndex
DROP INDEX "content_requests_deliveredPackageId_key";

-- AlterTable
ALTER TABLE "content_requests" DROP COLUMN "deliveredPackageId";

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "contentPackageId";

-- DropTable
DROP TABLE "content_assets";

-- DropTable
DROP TABLE "content_packages";

-- DropTable
DROP TABLE "content_unlocks";

-- DropEnum
DROP TYPE "ContentType";

