import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import { getUnreadChatCount } from '@/lib/chat';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/messages/unread -> { count }: chats con mensajes sin leer y, para
 * los creadores, pedidos y citas que esperan respuesta (viven en Mensajes).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ count: 0 });
  const modelId = user.modelProfileId ?? null;
  const [chats, orders] = await Promise.all([
    getUnreadChatCount(user.id, modelId),
    modelId
      ? Promise.all([
          prisma.booking.count({ where: { modelId, status: 'PENDING_CONFIRMATION' } }),
          prisma.contentRequest.count({ where: { modelId, status: { in: ['PENDING', 'PAID'] } } }),
        ]).then(([a, b]) => a + b)
      : Promise.resolve(0),
  ]);
  const count = chats + orders;
  return NextResponse.json({ count }, { headers: { 'Cache-Control': 'no-store' } });
}
