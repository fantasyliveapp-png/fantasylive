
-- AlterTable
ALTER TABLE "content_requests" ADD COLUMN     "deliveredMessageId" TEXT;

-- AlterTable
ALTER TABLE "vault_items" ADD COLUMN     "previewKey" TEXT;

-- CreateTable
CREATE TABLE "message_attachment_files" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "previewKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "vaultItemId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachment_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_attachment_files_attachmentId_sortOrder_idx" ON "message_attachment_files"("attachmentId", "sortOrder");

-- CreateIndex
CREATE INDEX "message_attachment_files_vaultItemId_idx" ON "message_attachment_files"("vaultItemId");

-- CreateIndex
CREATE UNIQUE INDEX "content_requests_deliveredMessageId_key" ON "content_requests"("deliveredMessageId");

-- AddForeignKey
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_deliveredMessageId_fkey" FOREIGN KEY ("deliveredMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachment_files" ADD CONSTRAINT "message_attachment_files_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "message_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachment_files" ADD CONSTRAINT "message_attachment_files_vaultItemId_fkey" FOREIGN KEY ("vaultItemId") REFERENCES "vault_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Los adjuntos que ya existian pasan a ser envios de un solo archivo.
INSERT INTO "message_attachment_files" ("id", "attachmentId", "storageKey", "mimeType", "sizeBytes", "vaultItemId", "sortOrder", "createdAt")
SELECT 'maf_' || "id", "id", "storageKey", "mimeType", "sizeBytes", "vaultItemId", 0, "createdAt"
FROM "message_attachments";
