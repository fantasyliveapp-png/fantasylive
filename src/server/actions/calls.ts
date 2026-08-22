'use server';

import { revalidatePath } from 'next/cache';
import type { CallEndReason, Gender } from '@prisma/client';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { createLiveKitToken, isLiveKitConfigured } from '@/lib/livekit';
import {
  activateCall,
  endCall,
  getCallState,
  processBillingTick,
} from '@/lib/calls';
import { applySubscriberDiscount, getActiveSubscription } from '@/lib/subscriptions';
import {
  joinQueue,
  leaveQueue,
  pollQueue,
  registerSkip,
} from '@/lib/matchmaking';
import { randomRoomName } from '@/lib/utils';

export interface CallActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

// ---------------------------------------------------------------------------
// MATCHMAKING
// ---------------------------------------------------------------------------

export async function joinQueueAction(input: {
  mode: 'RANDOM' | 'VIP';
  genderPreference?: Gender[];
  countryPreference?: string;
}): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: { gender: true, wallet: { select: { balance: true } } },
    });

    // El modo VIP cobra por minuto: exige saldo minimo para 1 minuto
    if (input.mode === 'VIP') {
      const cheapest = await prisma.modelProfile.findFirst({
        where: { isVipEnabled: true, isAvailableForVip: true, isOnline: true },
        orderBy: { vipRatePerMinute: 'asc' },
        select: { vipRatePerMinute: true },
      });
      const minRate = cheapest?.vipRatePerMinute ?? 20;
      if ((profile?.wallet?.balance ?? 0) < minRate) {
        return {
          ok: false,
          error: `Necesitas al menos ${minRate} tokens para entrar en la sala VIP.`,
        };
      }
    }

    const result = await joinQueue({
      userId: user.id,
      mode: input.mode,
      selfGender: profile?.gender ?? null,
      genderPreference: input.genderPreference ?? [],
      countryPreference: input.countryPreference ?? null,
    });

    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function pollQueueAction(
  entryId: string,
): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const result = await pollQueue(entryId, user.id);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function leaveQueueAction(
  entryId: string,
): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    await leaveQueue(entryId, user.id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Cuelga la llamada actual, registra el skip y vuelve a la cola. */
export async function skipAndRequeueAction(input: {
  sessionId: string;
  mode: 'RANDOM' | 'VIP';
  genderPreference?: Gender[];
}): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const session = await prisma.callSession.findUnique({
      where: { id: input.sessionId },
      select: { callerId: true, calleeId: true },
    });

    if (session) {
      const partnerId =
        session.callerId === user.id ? session.calleeId : session.callerId;
      if (partnerId) await registerSkip(user.id, partnerId);
      await endCall(input.sessionId, user.id, 'NEXT_SKIP');
    }

    return joinQueueAction({
      mode: input.mode,
      genderPreference: input.genderPreference,
    });
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// SESION DE LLAMADA
// ---------------------------------------------------------------------------

/** Devuelve el token de acceso al media server para esta sesion. */
export async function getCallTokenAction(
  sessionId: string,
): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const session = await getCallState(sessionId, user.id);
    if (!session) return { ok: false, error: 'Llamada no encontrada.' };
    if (session.status === 'ENDED') {
      return { ok: false, error: 'Esta llamada ya ha finalizado.' };
    }

    const token = await createLiveKitToken({
      roomName: session.roomName,
      identity: user.id,
      name: user.name ?? 'Invitado',
      metadata: { role: user.role, isVip: user.isVip },
    });

    await activateCall(sessionId);

    return {
      ok: true,
      data: {
        token,
        url: process.env.NEXT_PUBLIC_LIVEKIT_URL || '',
        roomName: session.roomName,
        configured: isLiveKitConfigured(),
        ratePerMinute: session.ratePerMinute,
        billingIntervalSeconds: config.economy.callBillingIntervalSeconds,
      },
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Tick de cobro por minuto. El importe se calcula en servidor. */
export async function billingTickAction(
  sessionId: string,
): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const result = await processBillingTick(sessionId, user.id);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function endCallAction(
  sessionId: string,
  reason: CallEndReason = 'USER_HANGUP',
): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    await endCall(sessionId, user.id, reason);
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function getCallStateAction(
  sessionId: string,
): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const state = await getCallState(sessionId, user.id);
    if (!state) return { ok: false, error: 'Llamada no encontrada.' };
    return { ok: true, data: state };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Inicia una llamada privada directa con una modelo (fuera de reserva).
 * Verifica saldo para el minimo de minutos exigido por la modelo.
 */
export async function startPrivateCallAction(
  modelSlug: string,
): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const model = await prisma.modelProfile.findUnique({
      where: { slug: modelSlug },
      select: {
        id: true,
        userId: true,
        stageName: true,
        isOnline: true,
        privateRatePerMinute: true,
        minPrivateMinutes: true,
        kycStatus: true,
      },
    });

    if (!model) return { ok: false, error: 'Modelo no encontrada.' };
    if (model.userId === user.id) {
      return { ok: false, error: 'No puedes llamarte a ti misma/o.' };
    }
    if (config.moderation.requireKycToStream && model.kycStatus !== 'APPROVED') {
      return { ok: false, error: 'Esta modelo aun no esta verificada.' };
    }
    if (!model.isOnline) {
      return {
        ok: false,
        error: 'La modelo no esta en linea. Reserva una videollamada privada.',
      };
    }

    const subscription = await getActiveSubscription(user.id, model.id);
    const ratePerMinute = subscription
      ? applySubscriberDiscount(
          model.privateRatePerMinute,
          subscription.discountPercent,
        )
      : model.privateRatePerMinute;

    const required = ratePerMinute * model.minPrivateMinutes;
    const wallet = await prisma.wallet.findUnique({
      where: { userId: user.id },
      select: { balance: true },
    });

    if ((wallet?.balance ?? 0) < required) {
      return {
        ok: false,
        error: `Necesitas ${required} tokens (minimo ${model.minPrivateMinutes} min a ${ratePerMinute}/min).`,
      };
    }

    const session = await prisma.callSession.create({
      data: {
        type: 'PRIVATE',
        status: 'PENDING',
        callerId: user.id,
        calleeId: model.userId,
        roomName: randomRoomName('priv'),
        ratePerMinute,
      },
      select: { id: true },
    });

    return { ok: true, data: { sessionId: session.id } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Reporta a la otra persona durante o despues de una llamada. */
export async function reportUserAction(input: {
  reportedId: string;
  sessionId?: string;
  reason:
    | 'UNDERAGE'
    | 'NON_CONSENSUAL'
    | 'HARASSMENT'
    | 'SPAM'
    | 'IMPERSONATION'
    | 'PAYMENT_DISPUTE'
    | 'TECHNICAL_ISSUE'
    | 'OTHER';
  details?: string;
}): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    await prisma.report.create({
      data: {
        reporterId: user.id,
        reportedId: input.reportedId,
        sessionId: input.sessionId ?? null,
        reason: input.reason,
        details: input.details ?? null,
      },
    });

    // Bloqueo permanente entre ambos tras un reporte
    await prisma.blockedPair.upsert({
      where: {
        blockerId_blockedId: {
          blockerId: user.id,
          blockedId: input.reportedId,
        },
      },
      create: {
        blockerId: user.id,
        blockedId: input.reportedId,
        isSkip: false,
      },
      update: { expiresAt: null },
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'ACCOUNT_BANNED') return 'Tu cuenta esta suspendida.';
    if (error.message === 'FORBIDDEN') return 'No participas en esta llamada.';
    if (error.message === 'SESSION_NOT_FOUND') return 'Llamada no encontrada.';
    return error.message;
  }
  return 'Error inesperado.';
}
