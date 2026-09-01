import 'server-only';

import type { CallEndReason } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { closeRoom, countRoomParticipants } from '@/lib/livekit';
import { applyLedgerEntry, splitEarnings, InsufficientTokensError } from '@/lib/tokens';

export interface BillingTickResult {
  ok: boolean;
  balance: number;
  tokensCharged: number;
  billedSeconds: number;
  /** true si hay que cortar la llamada ya */
  shouldTerminate: boolean;
  reason?: CallEndReason;
  /** Llamada sin tarifa: prueba gratuita */
  isFreeTrial: boolean;
  /** Segundos gratis que quedan (null si la llamada es de pago o sin limite) */
  freeSecondsRemaining: number | null;
  /** El otro participante aun no esta en la sala: no se cobra */
  waitingForPartner: boolean;
}

/**
 * Cobra el tiempo transcurrido desde el ultimo tick.
 *
 * Reglas:
 *
 *  - El importe NO depende del cliente: se calcula con timestamps de servidor,
 *    asi que acelerar o falsear los ticks no altera lo que se cobra.
 *
 *  - Solo se cobra el tiempo en que HAY DOS PERSONAS en la sala. La presencia
 *    se consulta a LiveKit, que es la unica fuente fiable; mientras esperas a
 *    que se una la otra persona el contador no corre.
 *
 *  - El redondeo se hace UNA VEZ sobre el total acumulado, no en cada tick.
 *    Redondear al alza cada 15 s inflaba la factura (a 40 tokens/min se
 *    cobraban 48). Ahora: total = ceil(tarifa * segundos / 60) y se cobra la
 *    diferencia con lo ya cobrado.
 *
 *  - Las llamadas sin tarifa son la prueba gratuita y se cortan al llegar a
 *    config.economy.freeCallSeconds.
 */
export async function processBillingTick(
  sessionId: string,
  requesterId: string,
): Promise<BillingTickResult> {
  const session = await prisma.callSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      type: true,
      callerId: true,
      calleeId: true,
      ratePerMinute: true,
      startedAt: true,
      lastBilledAt: true,
      billedSeconds: true,
      tokensSpent: true,
      roomName: true,
    },
  });

  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (session.callerId !== requesterId && session.calleeId !== requesterId) {
    throw new Error('FORBIDDEN');
  }

  const balanceOf = async (userId: string) =>
    (await prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }))
      ?.balance ?? 0;

  const isFreeTrial = session.ratePerMinute <= 0 || !session.calleeId;
  const freeLimit = config.economy.freeCallSeconds;

  if (session.status !== 'ACTIVE' || !session.startedAt) {
    return {
      ok: false,
      balance: await balanceOf(requesterId),
      tokensCharged: 0,
      billedSeconds: session.billedSeconds,
      shouldTerminate: true,
      reason: 'DISCONNECTED',
      isFreeTrial,
      freeSecondsRemaining: null,
      waitingForPartner: false,
    };
  }

  const now = new Date();
  const since = session.lastBilledAt ?? session.startedAt;
  const deltaSeconds = Math.max(
    0,
    Math.floor((now.getTime() - since.getTime()) / 1000),
  );

  // Presencia real en la sala. Si LiveKit no esta configurado devuelve null y
  // se asume que hay compania, para no romper el modo demo local.
  const participants = await countRoomParticipants(session.roomName);
  const bothPresent = participants === null || participants >= 2;

  // Solo (esperando o el otro colgo): el reloj no corre.
  if (!bothPresent) {
    await prisma.callSession.update({
      where: { id: session.id },
      data: { lastBilledAt: now },
    });
    return {
      ok: true,
      balance: await balanceOf(requesterId),
      tokensCharged: 0,
      billedSeconds: session.billedSeconds,
      shouldTerminate: false,
      isFreeTrial,
      freeSecondsRemaining: isFreeTrial && freeLimit > 0
        ? Math.max(0, freeLimit - session.billedSeconds)
        : null,
      waitingForPartner: true,
    };
  }

  const newBilledSeconds = session.billedSeconds + deltaSeconds;

  // --- Prueba gratuita ------------------------------------------------------
  if (isFreeTrial) {
    const capped =
      freeLimit > 0 ? Math.min(newBilledSeconds, freeLimit) : newBilledSeconds;

    await prisma.callSession.update({
      where: { id: session.id },
      data: { billedSeconds: capped, lastBilledAt: now },
    });

    const exhausted = freeLimit > 0 && newBilledSeconds >= freeLimit;
    if (exhausted) {
      await endCall(session.id, requesterId, 'FREE_LIMIT_REACHED');
    }

    return {
      ok: true,
      balance: await balanceOf(requesterId),
      tokensCharged: 0,
      billedSeconds: capped,
      shouldTerminate: exhausted,
      reason: exhausted ? 'FREE_LIMIT_REACHED' : undefined,
      isFreeTrial: true,
      freeSecondsRemaining: freeLimit > 0 ? Math.max(0, freeLimit - capped) : null,
      waitingForPartner: false,
    };
  }

  // --- Llamada de pago ------------------------------------------------------
  const payerId = session.callerId;
  const earnerId = session.calleeId!;

  // Aun no toca cobrar (protege contra ticks duplicados o agresivos)
  if (deltaSeconds < 5) {
    return {
      ok: true,
      balance: await balanceOf(payerId),
      tokensCharged: 0,
      billedSeconds: session.billedSeconds,
      shouldTerminate: false,
      isFreeTrial: false,
      freeSecondsRemaining: null,
      waitingForPartner: false,
    };
  }

  // Redondeo unico sobre el acumulado, no por tick.
  const dueTotal = Math.ceil((session.ratePerMinute * newBilledSeconds) / 60);
  const tokensDue = Math.max(0, dueTotal - session.tokensSpent);

  if (tokensDue === 0) {
    await prisma.callSession.update({
      where: { id: session.id },
      data: { billedSeconds: newBilledSeconds, lastBilledAt: now },
    });
    return {
      ok: true,
      balance: await balanceOf(payerId),
      tokensCharged: 0,
      billedSeconds: newBilledSeconds,
      shouldTerminate: false,
      isFreeTrial: false,
      freeSecondsRemaining: null,
      waitingForPartner: false,
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { platformFeeTokens, modelTokens } = splitEarnings(tokensDue);

      const debit = await applyLedgerEntry(tx, {
        userId: payerId,
        type: 'CALL_CHARGE',
        tokens: tokensDue,
        description: `Llamada ${session.type} - ${deltaSeconds}s`,
        callSessionId: session.id,
        platformFeeTokens,
      });

      if (modelTokens > 0) {
        await applyLedgerEntry(tx, {
          userId: earnerId,
          type: 'CALL_EARNING',
          tokens: modelTokens,
          description: `Ganancia llamada ${session.type} - ${deltaSeconds}s`,
          callSessionId: session.id,
        });
      }

      await tx.callBillingTick.create({
        data: {
          sessionId: session.id,
          seconds: deltaSeconds,
          tokensCharged: tokensDue,
          tokensCredited: modelTokens,
          feeTokens: platformFeeTokens,
        },
      });

      const updated = await tx.callSession.update({
        where: { id: session.id },
        data: {
          lastBilledAt: now,
          billedSeconds: newBilledSeconds,
          tokensSpent: { increment: tokensDue },
          tokensEarned: { increment: modelTokens },
          platformFeeTokens: { increment: platformFeeTokens },
        },
        select: { billedSeconds: true },
      });

      return { balance: debit.balanceAfter, billedSeconds: updated.billedSeconds };
    });

    // Corta si ya no le da para el siguiente intervalo
    const nextIntervalCost = Math.ceil(
      (session.ratePerMinute * config.economy.callBillingIntervalSeconds) / 60,
    );
    const shouldTerminate = result.balance < nextIntervalCost;

    if (shouldTerminate) {
      await endCall(session.id, payerId, 'INSUFFICIENT_TOKENS');
    }

    return {
      ok: true,
      balance: result.balance,
      tokensCharged: tokensDue,
      billedSeconds: result.billedSeconds,
      shouldTerminate,
      reason: shouldTerminate ? 'INSUFFICIENT_TOKENS' : undefined,
      isFreeTrial: false,
      freeSecondsRemaining: null,
      waitingForPartner: false,
    };
  } catch (error) {
    if (error instanceof InsufficientTokensError) {
      await endCall(session.id, payerId, 'INSUFFICIENT_TOKENS');
      return {
        ok: false,
        balance: error.available,
        tokensCharged: 0,
        billedSeconds: session.billedSeconds,
        shouldTerminate: true,
        reason: 'INSUFFICIENT_TOKENS',
        isFreeTrial: false,
        freeSecondsRemaining: null,
        waitingForPartner: false,
      };
    }
    throw error;
  }
}

/**
 * Cierra las llamadas que se quedaron colgadas.
 *
 * Hace falta porque el cobro lo dispara el navegador: si alguien cierra la
 * pestana de golpe, mata el proceso o simplemente deja de mandar ticks, la
 * sesion se quedaria ACTIVE para siempre y la prueba gratuita seria infinita.
 * Lo ejecuta el timer de systemd (deploy/fantasylive-sweep.timer).
 */
export async function sweepStaleCalls(): Promise<{
  freeExpired: number;
  abandoned: number;
}> {
  const now = Date.now();
  const freeLimit = config.economy.freeCallSeconds;

  const active = await prisma.callSession.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      callerId: true,
      ratePerMinute: true,
      calleeId: true,
      startedAt: true,
      lastBilledAt: true,
      billedSeconds: true,
    },
  });

  let freeExpired = 0;
  let abandoned = 0;

  for (const session of active) {
    const reference = session.lastBilledAt ?? session.startedAt;
    const silentSeconds = reference
      ? Math.floor((now - reference.getTime()) / 1000)
      : Infinity;

    // Sin ticks durante 3 intervalos: nadie esta al otro lado.
    if (silentSeconds > config.economy.callBillingIntervalSeconds * 3 + 30) {
      await endCall(session.id, session.callerId, 'DISCONNECTED');
      abandoned++;
      continue;
    }

    const isFree = session.ratePerMinute <= 0 || !session.calleeId;
    if (isFree && freeLimit > 0 && session.billedSeconds >= freeLimit) {
      await endCall(session.id, session.callerId, 'FREE_LIMIT_REACHED');
      freeExpired++;
    }
  }

  return { freeExpired, abandoned };
}

/** Marca la sesion como ACTIVE cuando ambos han conectado. */
export async function activateCall(sessionId: string) {
  const now = new Date();
  await prisma.callSession.updateMany({
    where: { id: sessionId, status: 'PENDING' },
    data: { status: 'ACTIVE', startedAt: now, lastBilledAt: now },
  });
}

/**
 * Finaliza una llamada: cobra el ultimo tramo, cierra la sala y actualiza
 * las metricas del perfil de la modelo.
 */
export async function endCall(
  sessionId: string,
  actorId: string,
  reason: CallEndReason = 'USER_HANGUP',
) {
  const session = await prisma.callSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      roomName: true,
      calleeId: true,
      callerId: true,
      startedAt: true,
      billedSeconds: true,
      bookingId: true,
    },
  });
  if (!session || session.status === 'ENDED') return;

  // Cobro final del tramo pendiente (silencioso si falla por saldo).
  //
  // OJO con la recursion: estos dos motivos los decide processBillingTick, que
  // acto seguido llama aqui. Volver a cobrar desde el cierre haria que el tick
  // detectase otra vez la misma condicion y llamase de nuevo a endCall, en
  // bucle infinito: la peticion se quedaba colgada para siempre. Cuando el
  // cierre viene del cobro, el tramo ya esta cobrado.
  const yaCobradoPorElTick: CallEndReason[] = [
    'INSUFFICIENT_TOKENS',
    'FREE_LIMIT_REACHED',
  ];
  if (session.status === 'ACTIVE' && !yaCobradoPorElTick.includes(reason)) {
    try {
      await processBillingTick(sessionId, actorId);
    } catch {
      // no bloquear el cierre por un fallo de cobro final
    }
  }

  const ended = await prisma.callSession.update({
    where: { id: sessionId },
    data: { status: 'ENDED', endedAt: new Date(), endReason: reason },
    select: {
      calleeId: true,
      billedSeconds: true,
      tokensEarned: true,
      bookingId: true,
    },
  });

  // Metricas de la modelo
  if (ended.calleeId) {
    const profile = await prisma.modelProfile.findUnique({
      where: { userId: ended.calleeId },
      select: { id: true },
    });
    if (profile) {
      await prisma.modelProfile.update({
        where: { id: profile.id },
        data: {
          totalCalls: { increment: 1 },
          totalMinutes: { increment: Math.round(ended.billedSeconds / 60) },
          totalTokensEarned: { increment: ended.tokensEarned },
        },
      });
    }
  }

  if (ended.bookingId) {
    await prisma.booking.updateMany({
      where: { id: ended.bookingId, status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  await closeRoom(session.roomName);
}

/** Estado ligero de la llamada para el poll del cliente. */
export async function getCallState(sessionId: string, userId: string) {
  const session = await prisma.callSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      type: true,
      status: true,
      callerId: true,
      calleeId: true,
      roomName: true,
      ratePerMinute: true,
      startedAt: true,
      billedSeconds: true,
      tokensSpent: true,
      endReason: true,
    },
  });
  if (!session) return null;
  if (session.callerId !== userId && session.calleeId !== userId) return null;
  return session;
}
