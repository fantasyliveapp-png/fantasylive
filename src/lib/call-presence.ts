import 'server-only';

import { ensureDealConversation } from '@/lib/deal-chat';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';

/**
 * DISPONIBILIDAD PARA LLAMADAS PRIVADAS
 *
 * Un solo interruptor: "Recibo llamadas" (isOnline). Mientras esta activo, la
 * web del creador pregunta cada pocos segundos si le estan llamando, y esa
 * misma pregunta sirve de latido: si cierra la web (o se le apaga el movil)
 * deja de latir y a los pocos minutos pasa sola a "No disponible", para que
 * ningun fan llame a alguien que no esta.
 */

/** Sin latido durante este tiempo, el creador deja de recibir llamadas. */
export const PRESENCE_TTL_MS = 3 * 60_000;
/** Lo que suena una llamada antes de darse por perdida. */
export const RING_SECONDS = 30;
/** No se escribe el latido en cada consulta, solo cada tanto. */
const HEARTBEAT_EVERY_MS = 30_000;

/** Llamada directa (no la de una cita): la unica que "suena". */
export const RINGING_WHERE = { type: 'PRIVATE', bookingId: null, status: 'PENDING' } as const;

/**
 * Apaga a quien lleva rato sin latir. No toca a quien esta en una llamada o
 * en directo: en esas pantallas no hay latido, pero siguen ahi.
 */
export async function reapStalePresence() {
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS);
  await prisma.modelProfile.updateMany({
    where: {
      isOnline: true,
      OR: [{ lastOnlineAt: null }, { lastOnlineAt: { lt: cutoff } }],
      user: { callsReceived: { none: { status: 'ACTIVE' } } },
      streams: { none: { status: 'LIVE' } },
    },
    data: { isOnline: false, isAvailableForVip: false },
  });
}

/** Latido del creador (throttled). */
export async function heartbeat(modelId: string, lastOnlineAt: Date | null) {
  if (lastOnlineAt && Date.now() - lastOnlineAt.getTime() < HEARTBEAT_EVERY_MS) return;
  await prisma.modelProfile.update({ where: { id: modelId }, data: { lastOnlineAt: new Date() } });
}

/** Si el creador sigue de verdad al otro lado (ha latido hace poco). */
export function isFresh(lastOnlineAt: Date | null) {
  return Boolean(lastOnlineAt && Date.now() - lastOnlineAt.getTime() < PRESENCE_TTL_MS);
}

/**
 * Se le puede llamar ya: en directo, si acepta privados en ese directo;
 * fuera de directo, si tiene "Recibo llamadas" y la web abierta. Nunca si ya
 * esta en otra llamada.
 */
export async function canCallNow(model: {
  id: string;
  userId: string;
  isOnline: boolean;
  lastOnlineAt: Date | null;
}) {
  const [live, busy] = await Promise.all([
    prisma.liveStream.findFirst({ where: { modelId: model.id, status: 'LIVE' }, select: { acceptsPrivate: true } }),
    isInCall(model.userId),
  ]);
  if (busy) return false;
  return live ? live.acceptsPrivate : model.isOnline && isFresh(model.lastOnlineAt);
}

/** En otra llamada ahora mismo (en curso). */
export async function isInCall(userId: string) {
  const busy = await prisma.callSession.findFirst({
    where: {
      OR: [{ callerId: userId }, { calleeId: userId }],
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  return Boolean(busy);
}

/**
 * Llamadas que sonaron y nadie cogio: se cancelan y el creador recibe
 * "Llamada perdida", que lleva al chat con ese fan.
 */
export async function expireRingingCalls(filter: { calleeId?: string; id?: string } = {}) {
  const cutoff = new Date(Date.now() - RING_SECONDS * 1000);
  const stale = await prisma.callSession.findMany({
    where: { ...RINGING_WHERE, ...filter, createdAt: { lt: cutoff } },
    select: { id: true, callerId: true, calleeId: true, caller: { select: { name: true } } },
    take: 20,
  });
  for (const call of stale) {
    const done = await prisma.callSession.updateMany({
      where: { id: call.id, status: 'PENDING' },
      data: { status: 'CANCELLED', endReason: 'TIMEOUT', endedAt: new Date() },
    });
    if (done.count === 0 || !call.calleeId) continue;
    await notifyMissed(call.callerId, call.calleeId, call.caller.name);
  }
}

async function notifyMissed(callerId: string, calleeId: string, callerName: string | null) {
  const model = await prisma.modelProfile.findUnique({ where: { userId: calleeId }, select: { id: true } });
  if (!model) return;
  const chatId = await ensureDealConversation(prisma, callerId, model.id);
  await createNotification(prisma, {
    userId: calleeId,
    type: 'INCOMING_CALL',
    title: `Llamada perdida de ${callerName ?? 'un fan'}`,
    body: 'Escríbele o activa "Recibo llamadas" para que vuelva a llamar.',
    link: `/mensajes/${chatId}`,
  });
}
