import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { startWinbackIfDue } from '@/lib/token-offers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications
 * Ultimas notificaciones del usuario actual + cantidad sin leer, para la
 * campanita de la navbar.
 */
/**
 * Ultima vez que se miro si a alguien le toca "Te echamos de menos" (por
 * proceso): como mucho una vez por hora, no en cada sondeo de la campana.
 */
const winbackCheckedAt = new Map<string, number>();
const WINBACK_CHECK_MS = 3600_000;

export async function GET(_request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const last = winbackCheckedAt.get(user.id) ?? 0;
  if (Date.now() - last > WINBACK_CHECK_MS) {
    winbackCheckedAt.set(user.id, Date.now());
    // Si toca, se crea su aviso antes de leer la lista (asi sale ya).
    await startWinbackIfDue(user.id).catch(() => false);
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id, createdAt: { lte: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.notification.count({
      where: { userId: user.id, isRead: false, createdAt: { lte: new Date() } },
    }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}
