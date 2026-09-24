import type { MessageRow } from '@/components/messages/message-thread';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';

interface MessageWithAttachment {
  id: string;
  body: string | null;
  createdAt: Date;
  senderId: string;
  isAiGenerated: boolean;
  /** Chatter que lo escribio en nombre de la creadora. */
  writtenById?: string | null;
  writtenBy?: { username: string | null } | null;
  attachment: {
    id: string;
    mimeType: string;
    priceTokens: number;
    storageKey: string;
  } | null;
}

/**
 * Resuelve los mensajes de una conversacion para el hilo, incluyendo el
 * estado de bloqueo y la URL firmada de cada adjunto segun quien mira.
 */
export async function buildMessageRows(
  messages: MessageWithAttachment[],
  viewerId: string,
  /** Lado de la creadora (ella o su equipo): ve quien escribio cada mensaje. */
  showAuthor = false,
): Promise<MessageRow[]> {
  const paidAttachmentIds = messages
    .filter(
      (m) =>
        m.attachment && m.attachment.priceTokens > 0 && m.senderId !== viewerId,
    )
    .map((m) => m.attachment!.id);

  const unlocks = paidAttachmentIds.length
    ? await prisma.messageAttachmentUnlock.findMany({
        where: { userId: viewerId, attachmentId: { in: paidAttachmentIds } },
        select: { attachmentId: true },
      })
    : [];
  const unlockedSet = new Set(unlocks.map((u) => u.attachmentId));

  return Promise.all(
    messages.map(async (m) => {
      let attachment: MessageRow['attachment'] = null;

      if (m.attachment) {
        const isSender = m.senderId === viewerId;
        const isFree = m.attachment.priceTokens <= 0;
        const isUnlocked = isSender || isFree || unlockedSet.has(m.attachment.id);

        attachment = {
          id: m.attachment.id,
          mimeType: m.attachment.mimeType,
          priceTokens: m.attachment.priceTokens,
          locked: !isUnlocked,
          url: isUnlocked
            ? await resolveAssetUrl(m.attachment.storageKey, { isPublic: false })
            : null,
        };
      }

      return {
        id: m.id,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        isMine: m.senderId === viewerId,
        isAiGenerated: m.isAiGenerated,
        writtenBy:
          showAuthor && m.writtenById !== undefined
            ? m.writtenBy?.username
              ? `@${m.writtenBy.username}`
              : m.writtenById
                ? 'Equipo'
                : null
            : null,
        attachment,
      };
    }),
  );
}
