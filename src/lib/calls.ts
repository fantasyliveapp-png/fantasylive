import 'server-only';

import type { CallEndReason } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { closeRoom } from '@/lib/livekit';
import { applyLedgerEntry, splitEarnings, InsufficientTokensError } from '@/lib/tokens';

export interface BillingTickResult {
  ok: boolean;
  balance: number;
  tokensCharged: number;
  billedSeconds: number;
  /** true si hay que cortar la llamada ya */
  shouldTerminate: boolean;
  reason?: CallEndReason;
}

/**
 * Cobra el tiempo transcurrido desde el ultimo tick.
 *
 * Se llama desde el cliente cada CALL_BILLING_INTERVAL_SECONDS, pero el importe
 * NO depende del cliente: se calcula con timestamps de servidor, asi que
 * manipular el intervalo no cambia lo que se cobra.
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

  if (session.status !== 'ACTIVE' || !session.startedAt) {
    return {
      ok: false,
      balance: await balanceOf(session.callerId),
      tokensCharged: 0,
      billedSeconds: session.billedSeconds,
      shouldTerminate: true,
      reason: 'DISCONNECTED',
    };
  }

  // Llamada gratuita: solo actualiza duracion
  if (session.ratePerMinute <= 0 || !session.calleeId) {
    const elapsed = Math.floor(
      (Date.now() - session.startedAt.getTime()) / 1000,
    );
    await prisma.callSession.update({
      where: { id: session.id },
      data: { billedSeconds: elapsed, lastBilledAt: new Date() },
    });
    return {
      ok: true,
      balance: await balanceOf(requesterId),
      tokensCharged: 0,
      billedSeconds: elapsed,
      shouldTerminate: false,
    };
  }

  const payerId = session.callerId;
  const earnerId = session.calleeId;

  const now = new Date();
  const since = session.lastBilledAt ?? session.startedAt;
  const deltaSeconds = Math.floor((now.getTime() - since.getTime()) / 1000);

  // Aun no toca cobrar (protege contra ticks duplicados/agresivos)
  if (deltaSeconds < 5) {
    return {
      ok: true,
      balance: await balanceOf(payerId),
      tokensCharged: 0,
      billedSeconds: session.billedSeconds,
      shouldTerminate: false,
    };
  }

  // Cobro proporcional al segundo, redondeado hacia arriba al token
  const tokensDue = Math.ceil((session.ratePerMinute * deltaSeconds) / 60);

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
          billedSeconds: { increment: deltaSeconds },
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
      };
    }
    throw error;
  }
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

  // Cobro final del tramo pendiente (silencioso si falla por saldo)
  if (session.status === 'ACTIVE' && reason !== 'INSUFFICIENT_TOKENS') {
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
