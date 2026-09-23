-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "modelReadAt" TIMESTAMP(3),
ADD COLUMN     "userReadAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "peer_chats" ADD COLUMN     "readAtA" TIMESTAMP(3),
ADD COLUMN     "readAtB" TIMESTAMP(3);


-- Empieza de cero: lo anterior cuenta como leido (antes no se guardaba).
UPDATE "conversations" SET "userReadAt" = NOW(), "modelReadAt" = NOW();
UPDATE "peer_chats" SET "readAtA" = NOW(), "readAtB" = NOW();
