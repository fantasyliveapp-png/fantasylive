import 'server-only';

import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * PEDIDOS Y CITAS DENTRO DEL CHAT
 *
 * Todo lo de un fan con un creador vive en su conversacion: los pedidos a
 * medida y las citas se ven como tarjetas en el hilo. Si aun no tenian chat,
 * se crea; pero si el creador cobra por abrir chat, el fan solo gestiona sus
 * tarjetas hasta que lo abra pagando (chatUnlocked = false).
 */

type Db = PrismaClient | Prisma.TransactionClient;

export async function ensureDealConversation(db: Db, userId: string, modelId: string) {
  const now = new Date();
  const existing = await db.conversation.findUnique({
    where: { userId_modelId: { userId, modelId } },
    select: { id: true },
  });
  if (existing) {
    await db.conversation.update({ where: { id: existing.id }, data: { lastMessageAt: now } });
    return existing.id;
  }
  const model = await db.modelProfile.findUniqueOrThrow({
    where: { id: modelId },
    select: { messagingEnabled: true, messagePriceTokens: true },
  });
  const created = await db.conversation.create({
    data: {
      userId,
      modelId,
      unlockPriceTokens: 0,
      acceptedAt: now,
      lastMessageAt: now,
      chatUnlocked: model.messagingEnabled && model.messagePriceTokens <= 0,
    },
    select: { id: true },
  });
  return created.id;
}

/** Enlace al chat de esa pareja fan-creador (para avisos). */
export async function dealChatHref(userId: string, modelId: string) {
  const c = await prisma.conversation.findUnique({
    where: { userId_modelId: { userId, modelId } },
    select: { id: true },
  });
  return c ? `/mensajes/${c.id}` : '/mensajes';
}
