import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import {
  RING_SECONDS,
  RINGING_WHERE,
  expireRingingCalls,
  heartbeat,
  reapStalePresence,
} from '@/lib/call-presence';
import { prisma } from '@/lib/prisma';
import { formatRate } from '@/lib/rates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/calls/incoming -> { available, call }
 *
 * Lo consulta la web del creador cada pocos segundos mientras tiene activado
 * "Recibo llamadas". Devuelve la llamada que le esta sonando (si hay) y de paso
 * cuenta como latido de presencia.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user?.modelProfileId) return NextResponse.json({ available: false, call: null }, { headers: NO_STORE });

  const profile = await prisma.modelProfile.findUnique({
    where: { id: user.modelProfileId },
    select: { id: true, isOnline: true, lastOnlineAt: true },
  });
  if (!profile) return NextResponse.json({ available: false, call: null }, { headers: NO_STORE });

  if (profile.isOnline) await heartbeat(profile.id, profile.lastOnlineAt);
  await Promise.all([reapStalePresence(), expireRingingCalls({ calleeId: user.id })]);

  const ringing = await prisma.callSession.findFirst({
    where: {
      ...RINGING_WHERE,
      calleeId: user.id,
      createdAt: { gt: new Date(Date.now() - RING_SECONDS * 1000) },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      rateCentitokens: true,
      caller: { select: { name: true, username: true, image: true } },
    },
  });

  // En directo con privados: aceptar termina el directo (se avisa en pantalla).
  const live = ringing
    ? Boolean(await prisma.liveStream.findFirst({ where: { modelId: profile.id, status: 'LIVE' }, select: { id: true } }))
    : false;

  return NextResponse.json(
    {
      available: profile.isOnline,
      live,
      call: ringing
        ? {
            sessionId: ringing.id,
            name: ringing.caller.name ?? ringing.caller.username ?? 'Un fan',
            image: ringing.caller.image,
            rate: formatRate(ringing.rateCentitokens),
            // Segundos que le quedan sonando.
            secondsLeft: Math.max(
              0,
              RING_SECONDS - Math.floor((Date.now() - ringing.createdAt.getTime()) / 1000),
            ),
          }
        : null,
    },
    { headers: NO_STORE },
  );
}
