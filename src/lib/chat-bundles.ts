import 'server-only';

import crypto from 'node:crypto';

import sharp from 'sharp';

import { prisma } from '@/lib/prisma';
import { getObjectBuffer, putObject } from '@/lib/storage';

/**
 * ENVIOS DEL CHAT: uno o varios archivos con UN precio y UNA compra.
 *
 * Antes de pagar el fan solo ve miniaturas diminutas y borrosas (y cuantas
 * fotos y videos trae); el original se firma solo tras desbloquear.
 */

export const MAX_BUNDLE_FILES = 20;

export interface BundleFileInput {
  storageKey: string;
  mimeType: string;
  sizeBytes?: number | null;
  previewKey?: string | null;
  vaultItemId?: string | null;
}

/** Miniatura borrosa de una foto. null si no es foto o no se pudo leer. */
export async function makeBlurredPreview(key: string, mimeType: string, prefix: string) {
  if (!mimeType.startsWith('image/')) return null;
  if (/^https?:\/\/picsum\.photos\//.test(key)) {
    return `${key.replace(/\/\d+\/\d+(\?.*)?$/, '/32/40')}?blur=2`;
  }
  try {
    const original = await getObjectBuffer(key);
    if (!original) return null;
    const small = await sharp(original).rotate().resize(32).blur(1.5).jpeg({ quality: 60 }).toBuffer();
    const previewKey = `${prefix}/${crypto.randomUUID()}-preview.jpg`;
    return (await putObject(previewKey, small, 'image/jpeg')) ? previewKey : null;
  } catch {
    return null;
  }
}

/** La miniatura de un archivo de la Boveda (se crea una vez y se guarda). */
export async function vaultItemPreview(item: {
  id: string;
  modelId: string;
  storageKey: string;
  mimeType: string;
  previewKey: string | null;
}) {
  if (item.previewKey) return item.previewKey;
  const previewKey = await makeBlurredPreview(item.storageKey, item.mimeType, `models/${item.modelId}/vault`);
  if (previewKey) {
    await prisma.vaultItem.update({ where: { id: item.id }, data: { previewKey } });
  }
  return previewKey;
}

export function bundleSummary(files: { mimeType: string }[]) {
  const photos = files.filter((f) => f.mimeType.startsWith('image/')).length;
  const videos = files.filter((f) => f.mimeType.startsWith('video/')).length;
  return { photos, videos };
}

export function bundleLabel(files: { mimeType: string }[]) {
  const { photos, videos } = bundleSummary(files);
  const parts: string[] = [];
  if (photos) parts.push(`${photos} ${photos === 1 ? 'foto' : 'fotos'}`);
  if (videos) parts.push(`${videos} ${videos === 1 ? 'video' : 'videos'}`);
  return parts.join(' y ') || 'un archivo';
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Crea el mensaje con su envio (dentro de una transaccion). */
export async function createBundleMessage(
  tx: Tx,
  input: {
    conversationId: string;
    senderId: string;
    body: string | null;
    priceTokens: number;
    files: BundleFileInput[];
  },
) {
  const [first] = input.files;
  if (!first) throw new Error('Elige al menos un archivo.');
  const message = await tx.message.create({
    data: { conversationId: input.conversationId, senderId: input.senderId, body: input.body },
    select: { id: true },
  });
  await tx.messageAttachment.create({
    data: {
      messageId: message.id,
      storageKey: first.storageKey,
      mimeType: first.mimeType,
      sizeBytes: first.sizeBytes ?? null,
      priceTokens: input.priceTokens,
      vaultItemId: first.vaultItemId ?? null,
      files: {
        create: input.files.map((f, i) => ({
          storageKey: f.storageKey,
          previewKey: f.previewKey ?? null,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes ?? null,
          vaultItemId: f.vaultItemId ?? null,
          sortOrder: i,
        })),
      },
    },
  });
  await tx.conversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: new Date() },
  });
  return message;
}

/**
 * Pedido a medida que se entrega en este chat: tiene que estar pagado, ser
 * de esta creadora y de este fan. Se entrega gratis (ya lo pago).
 */
export async function deliverableRequest(requestId: string, modelId: string, fanId: string) {
  const request = await prisma.contentRequest.findFirst({
    where: { id: requestId, modelId, userId: fanId },
    select: { id: true, status: true },
  });
  if (!request) throw new Error('Pedido no encontrado.');
  if (request.status === 'DELIVERED') throw new Error('Ese pedido ya esta entregado.');
  if (request.status !== 'PAID') throw new Error('Ese pedido todavia no esta pagado.');
  return request;
}

export async function markRequestDelivered(tx: Tx, requestId: string, messageId: string) {
  await tx.contentRequest.update({
    where: { id: requestId },
    data: { status: 'DELIVERED', deliveredMessageId: messageId, deliveredAt: new Date() },
  });
}
