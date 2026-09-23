import type { NotificationType, PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Crea una notificacion para un usuario. Nunca lanza: una notificacion que
 * falla no debe tumbar la accion principal (pago, mensaje, etc).
 */
export async function createNotification(
  tx: Tx,
  input: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string;
    link?: string;
  },
): Promise<void> {
  try {
    await tx.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      },
    });
  } catch {
    // No interrumpir la accion principal por un fallo al notificar.
  }
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, isRead: false } });
}
