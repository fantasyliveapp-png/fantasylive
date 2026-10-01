import 'server-only';

import type { CallEndReason } from '@prisma/client';

import { addOfferTokens } from '@/lib/creator-offers';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { closeRoom, countRoomParticipants, listRoomParticipants } from '@/lib/livekit';
import { tokensForSeconds } from '@/lib/rates';
import { payReferrers, referralSplit, saleMetadata } from '@/lib/referrals';
import { applyLedgerEntry, InsufficientTokensError } from '@/lib/tokens';

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
  /**
   * Segundos que faltan para cumplir el minimo de la llamada (0 si ya se
   * supero). Si el fan cuelga antes, se le cobran igual.
   */
  minimumPaddingSeconds: number;
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
 *  - La tarifa viaja en CENTITOKENS por minuto (1 token = 100), porque el
 *    minimo que puede pedir una creadora (17,5 tokens/min) tiene decimales.
 *    Ver src/lib/rates.ts.
 *
 *  - MINIMO DE LA LLAMADA (minBilledSeconds, lo fija el creador): durante la
 *    llamada solo se cobra el tiempo usado. Al colgar (ver endCall), si fue EL
 *    FAN quien colgo antes del minimo, se le cobra hasta el minimo; si colgo
 *    el creador (o se fue de la sala), solo lo usado. Cerrar la pestana no lo
 *    esquiva: si dejan de llegar los ticks del fan, el barrido lo trata como
 *    que colgo el.
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
      rateCentitokens: true,
      startedAt: true,
      lastBilledAt: true,
      billedSeconds: true,
      tokensSpent: true,
      roomName: true,
      minBilledSeconds: true,
      bookingId: true,
    },
  });

  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (session.callerId !== requesterId && session.calleeId !== requesterId) {
    throw new Error('FORBIDDEN');
  }

  const balanceOf = async (userId: string) =>
    (await prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }))
      ?.balance ?? 0;

  // Las videollamadas reservadas ya estan pagadas (tarifa 0) pero NO son la
  // prueba gratuita: no se cortan a los pocos minutos.
  const isFreeTrial = !session.bookingId && (session.rateCentitokens <= 0 || !session.calleeId);
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
      minimumPaddingSeconds: 0,
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
      minimumPaddingSeconds: 0,
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
      minimumPaddingSeconds: 0,
      waitingForPartner: false,
    };
  }

  // --- Llamada de pago ------------------------------------------------------
  const payerId = session.callerId;
  const earnerId = session.calleeId!;

  // Durante la llamada solo se cobra lo usado; el minimo se decide al colgar.
  const chargeableSeconds = newBilledSeconds;
  const minimumPaddingSeconds = Math.max(0, session.minBilledSeconds - newBilledSeconds);

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
      minimumPaddingSeconds,
      waitingForPartner: false,
    };
  }

  // Redondeo unico sobre el acumulado, no por tick.
  const dueTotal = tokensForSeconds(session.rateCentitokens, chargeableSeconds);
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
      minimumPaddingSeconds,
      waitingForPartner: false,
    };
  }

  try {
    const result = await recordCharge(session, tokensDue, {
      seconds: deltaSeconds,
      description: `Llamada ${session.type} - ${deltaSeconds}s`,
      billedSeconds: newBilledSeconds,
      now,
    });

    // Corta si ya no le da para el siguiente intervalo
    const nextIntervalCost = tokensForSeconds(
      session.rateCentitokens,
      config.economy.callBillingIntervalSeconds,
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
      minimumPaddingSeconds,
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
        minimumPaddingSeconds: 0,
        waitingForPartner: false,
      };
    }
    throw error;
  }
}

type ChargeableSession = {
  id: string;
  type: string;
  callerId: string;
  calleeId: string | null;
};

/** Cobra al fan y paga al creador (con comision y referidos) en una transaccion. */
async function recordCharge(
  session: ChargeableSession,
  tokensDue: number,
  opts: { seconds: number; description: string; billedSeconds: number; now: Date },
) {
  const payerId = session.callerId;
  const earnerId = session.calleeId!;
  return prisma.$transaction(async (tx) => {
    // Reparto con las reglas de referidos (fan propio / embajadora).
    const split = await referralSplit(tx, { payerId, earnerId, tokens: tokensDue });
    const { platformFeeTokens, modelTokens, referrers } = split;

    const debit = await applyLedgerEntry(tx, {
      userId: payerId,
      type: 'CALL_CHARGE',
      tokens: tokensDue,
      description: opts.description,
      callSessionId: session.id,
      platformFeeTokens,
    });

    if (modelTokens > 0) {
      await applyLedgerEntry(tx, {
        userId: earnerId,
        type: 'CALL_EARNING',
        tokens: modelTokens,
        description: `Ganancia ${opts.description.charAt(0).toLowerCase()}${opts.description.slice(1)}`,
        callSessionId: session.id,
        metadata: saleMetadata(split, { payerId, tokens: tokensDue }),
      });
    }

    await payReferrers(tx, referrers, {
      description: `llamada ${session.type}`,
      fromCreatorUserId: earnerId,
      applyLedgerEntry,
      callSessionId: session.id,
    });

    await tx.callBillingTick.create({
      data: {
        sessionId: session.id,
        seconds: opts.seconds,
        tokensCharged: tokensDue,
        tokensCredited: modelTokens,
        feeTokens: platformFeeTokens,
      },
    });

    const updated = await tx.callSession.update({
      where: { id: session.id },
      data: {
        lastBilledAt: opts.now,
        billedSeconds: opts.billedSeconds,
        tokensSpent: { increment: tokensDue },
        tokensEarned: { increment: modelTokens },
        platformFeeTokens: { increment: platformFeeTokens },
      },
      select: { billedSeconds: true },
    });

    return { balance: debit.balanceAfter, billedSeconds: updated.billedSeconds };
  });
}

/**
 * El fan colgo antes del minimo: se le cobra hasta completarlo (o lo que le
 * quede de saldo, si gasto en regalos durante la llamada).
 */
async function chargeUpToMinimum(sessionId: string) {
  const s = await prisma.callSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      type: true,
      callerId: true,
      calleeId: true,
      rateCentitokens: true,
      minBilledSeconds: true,
      billedSeconds: true,
      tokensSpent: true,
    },
  });
  if (!s || !s.calleeId || s.rateCentitokens <= 0) return;
  if (s.billedSeconds <= 0 || s.billedSeconds >= s.minBilledSeconds) return;

  const due = tokensForSeconds(s.rateCentitokens, s.minBilledSeconds) - s.tokensSpent;
  if (due <= 0) return;
  const wallet = await prisma.wallet.findUnique({ where: { userId: s.callerId }, select: { balance: true } });
  const tokens = Math.min(due, wallet?.balance ?? 0);
  if (tokens <= 0) return;

  const mins = Math.round(s.minBilledSeconds / 60);
  try {
    await recordCharge(s, tokens, {
      seconds: 0,
      description: `Llamada ${s.type} - minimo de ${mins} min (colgo el fan)`,
      billedSeconds: s.billedSeconds,
      now: new Date(),
    });
  } catch {
    // Sin saldo suficiente a ultima hora: se queda en lo ya cobrado.
  }
}

/** El creador sigue en la sala (en modo demo, sin LiveKit, se asume que si). */
async function calleeInRoom(roomName: string, calleeId: string | null) {
  if (!calleeId) return false;
  const count = await countRoomParticipants(roomName);
  if (count === null) return true;
  const people = await listRoomParticipants(roomName);
  return people.some((p) => p.identity === calleeId);
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
      rateCentitokens: true,
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
      // Los ticks los manda el navegador del fan: si dejan de llegar, fue el
      // quien se fue (y paga el minimo, como si hubiera colgado).
      await endCall(session.id, session.callerId, 'DISCONNECTED', { payerAbandoned: true });
      abandoned++;
      continue;
    }

    const isFree = session.rateCentitokens <= 0 || !session.calleeId;
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
  opts: { payerAbandoned?: boolean } = {},
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
      minBilledSeconds: true,
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

  // Minimo: solo si colgo EL FAN (o se fue cerrando la pestana) y el
  // creador seguia ahi. Si colgo el creador, solo se paga lo usado.
  const payerLeft =
    opts.payerAbandoned ||
    (actorId === session.callerId && (reason === 'USER_HANGUP' || reason === 'NEXT_SKIP'));
  if (
    session.status === 'ACTIVE' &&
    session.minBilledSeconds > 0 &&
    payerLeft &&
    (await calleeInRoom(session.roomName, session.calleeId))
  ) {
    await chargeUpToMinimum(sessionId);
  }

  const ended = await prisma.callSession.update({
    where: { id: sessionId },
    data: { status: 'ENDED', endedAt: new Date(), endReason: reason },
    select: {
      calleeId: true,
      billedSeconds: true,
      tokensEarned: true,
      tokensSpent: true,
      bookingId: true,
      creatorOfferId: true,
    },
  });

  // Lo que pago el fan cuenta en las ventas de la oferta del creador.
  if (ended.creatorOfferId) await addOfferTokens(prisma, ended.creatorOfferId, ended.tokensSpent);

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
      rateCentitokens: true,
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
