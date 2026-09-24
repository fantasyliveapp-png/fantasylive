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
    const created = await tx.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      },
      select: { id: true },
    });
    if (!NO_PUSH.has(input.type)) schedulePush(created.id, input);
  } catch {
    // No interrumpir la accion principal por un fallo al notificar.
  }
}

/** Avisos que se quedan dentro de la app (serian demasiados en el movil). */
const NO_PUSH = new Set<NotificationType>(['NEW_POST', 'POST_INSIGHT']);

/**
 * El aviso al movil sale un momento despues y solo si la notificacion sigue
 * existiendo: si la accion se deshizo (transaccion fallida), no se avisa.
 */
function schedulePush(
  notificationId: string,
  input: { userId: string; type: NotificationType; title: string; body?: string; link?: string },
) {
  setTimeout(async () => {
    try {
      const still = await prisma.notification.findUnique({
        where: { id: notificationId },
        select: { id: true },
      });
      if (!still) return;
      const { sendPush } = await import('@/lib/push');
      await sendPush([input.userId], {
        title: input.title,
        body: input.body,
        url: input.link ?? '/',
        // Varios mensajes del mismo chat se agrupan en un solo aviso.
        tag: input.link ?? input.type,
      });
    } catch {
      // Un aviso que no sale no debe romper nada.
    }
  }, 1500);
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  // Las de publicaciones programadas llevan fecha futura: aun no cuentan.
  return prisma.notification.count({
    where: { userId, isRead: false, createdAt: { lte: new Date() } },
  });
}
