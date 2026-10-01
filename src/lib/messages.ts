import type { MessageRow } from '@/components/messages/message-thread';
import { bundleSummary } from '@/lib/chat-bundles';
import { discountTokens } from '@/lib/creator-offer-rules';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';

interface MessageWithAttachment {
  id: string;
  body: string | null;
  createdAt: Date;
  senderId: string;
  isAiGenerated: boolean;
  deliveredRequest?: { id: string } | null;
  attachment: {
    id: string;
    mimeType: string;
    priceTokens: number;
    storageKey: string;
    files?: { id: string; storageKey: string; previewKey: string | null; mimeType: string }[];
  } | null;
}

/**
 * Resuelve los mensajes de una conversacion para el hilo. Un envio puede
 * traer varios archivos con un solo precio: bloqueado, solo se sirven sus
 * miniaturas borrosas; desbloqueado (o para quien lo envio), los originales.
 */
export async function buildMessageRows(
  messages: MessageWithAttachment[],
  viewerId: string,
  /** Oferta del creador en su contenido para quien mira (rebajas o cupon). */
  contentOffer: { percentOff: number; label: string } | null = null,
): Promise<MessageRow[]> {
  const paidAttachmentIds = messages
    .filter((m) => m.attachment && m.attachment.priceTokens > 0 && m.senderId !== viewerId)
    .map((m) => m.attachment!.id);

  const unlocks = paidAttachmentIds.length
    ? await prisma.messageAttachmentUnlock.findMany({
        where: { userId: viewerId, attachmentId: { in: paidAttachmentIds } },
        select: { attachmentId: true },
      })
    : [];
  const unlockedSet = new Set(unlocks.map((u) => u.attachmentId));

  // Lo que envio quien mira (la creadora): ¿ya se lo han comprado?
  const mySoldIds = messages
    .filter((m) => m.attachment && m.attachment.priceTokens > 0 && m.senderId === viewerId)
    .map((m) => m.attachment!.id);
  const sold = mySoldIds.length
    ? await prisma.messageAttachmentUnlock.findMany({
        where: { attachmentId: { in: mySoldIds } },
        select: { attachmentId: true },
      })
    : [];
  const soldSet = new Set(sold.map((u) => u.attachmentId));

  return Promise.all(
    messages.map(async (m) => {
      let attachment: MessageRow['attachment'] = null;

      if (m.attachment) {
        const a = m.attachment;
        const isSender = m.senderId === viewerId;
        const isUnlocked = isSender || a.priceTokens <= 0 || unlockedSet.has(a.id);
        // Envios antiguos sin filas de archivos: el propio adjunto es el unico.
        const files = a.files?.length
          ? a.files
          : [{ id: a.id, storageKey: a.storageKey, previewKey: null, mimeType: a.mimeType }];

        const discounted = !isUnlocked && contentOffer && a.priceTokens > 0;
        attachment = {
          id: a.id,
          mimeType: a.mimeType,
          priceTokens: discounted ? discountTokens(a.priceTokens, contentOffer.percentOff) : a.priceTokens,
          originalPriceTokens: discounted ? a.priceTokens : null,
          offerLabel: discounted ? `${contentOffer.label} −${contentOffer.percentOff}%` : null,
          locked: !isUnlocked,
          sold: isSender && a.priceTokens > 0 ? soldSet.has(a.id) : null,
          ...bundleSummary(files),
          files: await Promise.all(
            files.map(async (f) => ({
              id: f.id,
              mimeType: f.mimeType,
              url: isUnlocked ? await resolveAssetUrl(f.storageKey, { isPublic: false }) : null,
              previewUrl: f.previewKey ? await resolveAssetUrl(f.previewKey, { isPublic: false }) : null,
            })),
          ),
        };
      }

      return {
        id: m.id,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        isMine: m.senderId === viewerId,
        isAiGenerated: m.isAiGenerated,
        isRequestDelivery: Boolean(m.deliveredRequest),
        attachment,
      };
    }),
  );
}
