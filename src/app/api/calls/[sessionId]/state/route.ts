import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import { getCallState } from '@/lib/calls';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/calls/:sessionId/state
 * Estado de la llamada + saldo actual, para el HUD del cliente.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;
  const state = await getCallState(sessionId, user.id);

  if (!state) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const [wallet, partner] = await Promise.all([
    prisma.wallet.findUnique({
      where: { userId: user.id },
      select: { balance: true },
    }),
    (async () => {
      const partnerId =
        state.callerId === user.id ? state.calleeId : state.callerId;
      if (!partnerId) return null;
      return prisma.user.findUnique({
        where: { id: partnerId },
        select: {
          id: true,
          name: true,
          image: true,
          country: true,
          modelProfile: {
            select: { stageName: true, slug: true, tier: true, avatarUrl: true },
          },
        },
      });
    })(),
  ]);

  return NextResponse.json({
    session: state,
    balance: wallet?.balance ?? 0,
    isPayer: state.callerId === user.id,
    partner,
  });
}
