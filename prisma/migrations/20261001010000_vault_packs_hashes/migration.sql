
-- AlterTable
ALTER TABLE "post_assets" ADD COLUMN     "contentHash" TEXT;

-- AlterTable
ALTER TABLE "vault_items" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "packId" TEXT;

-- CreateTable
CREATE TABLE "vault_packs" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceTokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_packs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vault_packs_modelId_createdAt_idx" ON "vault_packs"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "vault_items_modelId_contentHash_idx" ON "vault_items"("modelId", "contentHash");

-- AddForeignKey
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_packId_fkey" FOREIGN KEY ("packId") REFERENCES "vault_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_packs" ADD CONSTRAINT "vault_packs_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateIndex
CREATE INDEX "post_assets_contentHash_idx" ON "post_assets"("contentHash");
