-- CreateEnum
CREATE TYPE "VaultSection" AS ENUM ('TEASER', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'SPECIAL');


-- AlterTable
ALTER TABLE "message_attachments" ADD COLUMN     "vaultItemId" TEXT;

-- AlterTable
ALTER TABLE "model_profiles" ADD COLUMN     "vaultPriceLevel1" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "vaultPriceLevel2" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "vaultPriceLevel3" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "vaultPriceSpecial" INTEGER NOT NULL DEFAULT 200;

-- CreateTable
CREATE TABLE "vault_folders" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_items" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "section" "VaultSection" NOT NULL,
    "folderId" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "note" TEXT,
    "priceTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vault_folders_modelId_name_key" ON "vault_folders"("modelId", "name");

-- CreateIndex
CREATE INDEX "vault_items_modelId_section_createdAt_idx" ON "vault_items"("modelId", "section", "createdAt");

-- CreateIndex
CREATE INDEX "message_attachments_vaultItemId_idx" ON "message_attachments"("vaultItemId");

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_vaultItemId_fkey" FOREIGN KEY ("vaultItemId") REFERENCES "vault_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_folders" ADD CONSTRAINT "vault_folders_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "vault_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

