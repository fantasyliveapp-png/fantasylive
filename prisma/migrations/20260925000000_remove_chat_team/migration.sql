-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('NEW_FOLLOWER', 'NEW_SUBSCRIBER', 'NEW_REVIEW', 'CONTENT_REQUEST_RECEIVED', 'CONTENT_REQUEST_QUOTED', 'CONTENT_REQUEST_DELIVERED', 'NEW_MESSAGE', 'MESSAGE_ATTACHMENT_UNLOCKED', 'INCOMING_CALL', 'LIVE_STARTED', 'NEW_POST', 'GIFT_RECEIVED', 'POST_INSIGHT', 'MODERATION', 'ANNOUNCEMENT', 'SUPPORT_REPLY');
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "public"."NotificationType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TransactionType_new" AS ENUM ('TOKEN_PURCHASE', 'SIGNUP_BONUS', 'ADMIN_CREDIT', 'ADMIN_DEBIT', 'CALL_CHARGE', 'CALL_EARNING', 'CONTENT_UNLOCK', 'CONTENT_EARNING', 'TIP', 'TIP_EARNING', 'BOOKING_HOLD', 'BOOKING_REFUND', 'PAYOUT', 'REFUND', 'PLATFORM_FEE', 'SUBSCRIPTION_PURCHASE', 'SUBSCRIPTION_EARNING', 'CONTENT_REQUEST_PAYMENT', 'CONTENT_REQUEST_EARNING', 'MESSAGE_UNLOCK', 'MESSAGE_UNLOCK_EARNING', 'MESSAGE_ATTACHMENT_UNLOCK', 'MESSAGE_ATTACHMENT_EARNING', 'POST_UNLOCK', 'POST_EARNING', 'PAYOUT_FEE', 'REFERRAL_EARNING');
ALTER TABLE "transactions" ALTER COLUMN "type" TYPE "TransactionType_new" USING ("type"::text::"TransactionType_new");
ALTER TYPE "TransactionType" RENAME TO "TransactionType_old";
ALTER TYPE "TransactionType_new" RENAME TO "TransactionType";
DROP TYPE "public"."TransactionType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "chat_assistants" DROP CONSTRAINT "chat_assistants_modelId_fkey";

-- DropForeignKey
ALTER TABLE "chat_assistants" DROP CONSTRAINT "chat_assistants_userId_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_writtenById_fkey";

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "writtenById";

-- DropTable
DROP TABLE "chat_assistants";

-- DropEnum
DROP TYPE "ChatAssistantStatus";

