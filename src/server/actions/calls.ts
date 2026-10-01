'use server';

import { applyRateOffer, getCallOffer, markCallOfferUsed } from '@/lib/creator-offers';
import { revalidatePath } from 'next/cache';
import type { CallEndReason, Gender } from '@prisma/client';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { gw } from '@/lib/gender-words';
import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notifications';
import {
  GEO_BLOCKED_MESSAGE,
  getViewerCountry,
  isBlockedForViewer,
} from '@/lib/geo';
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
  DEFAULT_RATE_CENTITOKENS,
  formatRate,
  tokensForMinutes,
} from '@/lib/rates';
import {
  joinQueue,
  leaveQueue,
  pollQueue,
  registerSkip,
} from '@/lib/matchmaking';
import { randomRoomName } from '@/lib/utils';
import {
  RING_SECONDS,
  RINGING_WHERE,
  expireRingingCalls,
  isFresh,
  isInCall,
  reapStalePresence,
} from '@/lib/call-presence';
import { ensureDealConversation } from '@/lib/deal-chat';
import { broadcastLiveState } from '@/lib/live-controls';
import { endStreamAction } from '@/server/actions/live';

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
    await reapStalePresence();
    const user = await getAuthedUserOrThrow();

    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: { gender: true, wallet: { select: { balance: true } } },
    });

    // El modo VIP cobra por minuto: exige saldo minimo para 1 minuto
    if (input.mode === 'VIP') {
      const cheapest = await prisma.modelProfile.findFirst({
        where: { isVipEnabled: true, isAvailableForVip: true, isOnline: true },
        orderBy: { vipRateCentitokens: 'asc' },
        select: { vipRateCentitokens: true },
      });
      // La tarifa viene en centitokens/min: hay que traducirla a los tokens
      // enteros que cuesta un minuto antes de compararla con el saldo.
      const cheapestRate =
        cheapest?.vipRateCentitokens ?? DEFAULT_RATE_CENTITOKENS;
      const minTokens = tokensForMinutes(cheapestRate, 1);
      if ((profile?.wallet?.balance ?? 0) < minTokens) {
        return {
          ok: false,
          error: `Necesitas al menos ${minTokens} tokens para entrar en la sala VIP.`,
        };
      }
    }

    const result = await joinQueue({
      userId: user.id,
      mode: input.mode,
      selfGender: profile?.gender ?? null,
      genderPreference: input.genderPreference ?? [],
      countryPreference: input.countryPreference ?? null,
      // Se resuelve aqui (hay contexto de peticion) y viaja con la entrada de
      // cola para que el emparejamiento respete los bloqueos por pais.
      selfCountry: await getViewerCountry(),
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

    // Llamada directa que aun suena: quien llama no la activa (ni empieza a
    // pagar) hasta que el creador la coge.
    if (session.status === 'CANCELLED') {
      return { ok: false, error: 'Esta llamada ya no esta disponible.' };
    }
    const stillRinging =
      session.status === 'PENDING' && session.type === 'PRIVATE' && session.callerId === user.id;

    const token = await createLiveKitToken({
      roomName: session.roomName,
      identity: user.id,
      name: user.name ?? 'Invitado',
      metadata: { role: user.role, isVip: user.isVip },
    });

    if (!stillRinging) await activateCall(sessionId);

    return {
      ok: true,
      data: {
        token,
        url: process.env.NEXT_PUBLIC_LIVEKIT_URL || '',
        roomName: session.roomName,
        configured: isLiveKitConfigured(),
        rateCentitokens: session.rateCentitokens,
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
    // Sin revalidatePath: /dashboard ya es force-dynamic, y revalidar desde
    // esta accion re-renderizaba la propia pagina de la llamada, que al verla
    // terminada redirigia al panel y se saltaba la pantalla final.
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
 * Llama ahora a un creador que tiene activado "Recibo llamadas". La llamada
 * SUENA en su pantalla (Aceptar / Rechazar) durante unos segundos; si no la
 * coge, se da por perdida. No se cobra nada hasta que la acepta.
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
        lastOnlineAt: true,
        privateRateCentitokens: true,
        minPrivateMinutes: true,
        kycStatus: true,
        blockedCountries: true,
        gender: true,
      },
    });

    if (!model) return { ok: false, error: 'Perfil no encontrado.' };
    if (model.userId === user.id) {
      return { ok: false, error: 'No puedes llamarte a tu propio perfil.' };
    }
    if (await isBlockedForViewer(model.blockedCountries)) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }
    if (config.moderation.requireKycToStream && model.kycStatus !== 'APPROVED') {
      return {
        ok: false,
        error: `${model.stageName} aun no esta ${gw(model.gender, { f: 'verificada', m: 'verificado', pl: 'verificados' })}.`,
      };
    }
    // En directo: solo si al empezar dijo que acepta privados 1 a 1.
    const live = await prisma.liveStream.findFirst({
      where: { modelId: model.id, status: 'LIVE' },
      select: { acceptsPrivate: true },
    });
    if (live && !live.acceptsPrivate) {
      return { ok: false, error: `${model.stageName} esta en directo y ahora no acepta privados.` };
    }
    // Fuera de directo: "Recibo llamadas" activado y con la web abierta.
    if (!live && (!model.isOnline || !isFresh(model.lastOnlineAt))) {
      return {
        ok: false,
        error: `${model.stageName} no recibe llamadas ahora. Puedes reservar una videollamada o escribirle.`,
      };
    }
    if ((await isInCall(model.userId)) || (await prisma.callSession.findFirst({
      where: { ...RINGING_WHERE, calleeId: model.userId, createdAt: { gt: new Date(Date.now() - RING_SECONDS * 1000) } },
      select: { id: true },
    }))) {
      return { ok: false, error: `${model.stageName} esta en otra llamada. Prueba en unos minutos.` };
    }

    const [subscription, offer] = await Promise.all([
      getActiveSubscription(user.id, model.id),
      // Happy hour, primera llamada o cupon del creador (sale de su precio).
      getCallOffer({ id: model.id, userId: model.userId }, user.id),
    ]);
    const subscriberRate = subscription
      ? applySubscriberDiscount(
          model.privateRateCentitokens,
          subscription.discountPercent,
        )
      : model.privateRateCentitokens;
    // No se suman: gana el descuento mayor.
    const offerRate = offer ? applyRateOffer(model.privateRateCentitokens, offer.percentOff) : Infinity;
    const usedOffer = offer && offerRate < subscriberRate ? offer : null;
    const rateCentitokens = usedOffer ? offerRate : subscriberRate;

    // Minimo facturable: hay que poder pagar los minutos minimos completos
    // antes de empezar, porque se cobran igual si se cuelga antes.
    const required = tokensForMinutes(rateCentitokens, model.minPrivateMinutes);
    const wallet = await prisma.wallet.findUnique({
      where: { userId: user.id },
      select: { balance: true },
    });

    if ((wallet?.balance ?? 0) < required) {
      return {
        ok: false,
        error: `Necesitas ${required} tokens (minimo ${model.minPrivateMinutes} min a ${formatRate(rateCentitokens)}).`,
      };
    }

    const session = await prisma.$transaction(async (tx) => {
      // La llamada queda tambien en su chat (tarjeta "Videollamada").
      await ensureDealConversation(tx, user.id, model.id);
      return tx.callSession.create({
        data: {
          type: 'PRIVATE',
          status: 'PENDING',
          callerId: user.id,
          calleeId: model.userId,
          roomName: randomRoomName('priv'),
          rateCentitokens,
          // El minimo que fija el creador: lo paga el fan si cuelga antes.
          minBilledSeconds: model.minPrivateMinutes * 60,
          creatorOfferId: usedOffer?.id ?? null,
        },
        select: { id: true },
      });
    });

    // Aviso de respaldo: la llamada suena en su web, pero si la tiene en
    // segundo plano le llega tambien como notificacion (y push).
    await createNotification(prisma, {
      userId: model.userId,
      type: 'INCOMING_CALL',
      title: `${user.name ?? 'Alguien'} te esta llamando`,
      body: `Videollamada privada a ${formatRate(rateCentitokens)}${usedOffer ? ` (${usedOffer.label} −${usedOffer.percentOff}%)` : ''}`,
      link: `/call/${session.id}`,
    });

    return { ok: true, data: { sessionId: session.id } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Creador: coge la llamada que le suena. */
export async function acceptCallAction(sessionId: string): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    await expireRingingCalls({ id: sessionId });
    const done = await prisma.callSession.updateMany({
      where: { id: sessionId, calleeId: user.id, ...RINGING_WHERE },
      data: { status: 'ACTIVE', startedAt: new Date(), lastBilledAt: new Date() },
    });
    if (done.count === 0) return { ok: false, error: 'La llamada ya no esta sonando.' };
    // Si empezo con una oferta del creador, cuenta ahora (un cupon se gasta al cogerla).
    await markCallOfferUsed(sessionId);

    // Estaba en directo: el directo termina y la sala se entera de por que.
    if (user.modelProfileId) {
      const live = await prisma.liveStream.findFirst({
        where: { modelId: user.modelProfileId, status: { in: ['PREPARING', 'LIVE'] } },
        select: { id: true, roomName: true },
      });
      if (live) {
        await broadcastLiveState(live.roomName, { wentPrivate: true, acceptsPrivate: false });
        await endStreamAction(live.id);
      }
    }
    return { ok: true, data: { sessionId } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Creador: rechaza la llamada. Al fan se le ofrece reservar o escribir. */
export async function declineCallAction(sessionId: string): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    await prisma.callSession.updateMany({
      where: { id: sessionId, calleeId: user.id, ...RINGING_WHERE },
      data: { status: 'CANCELLED', endReason: 'PARTNER_HANGUP', endedAt: new Date() },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Fan: cuelga antes de que la cojan. */
export async function cancelRingingCallAction(sessionId: string): Promise<CallActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    await prisma.callSession.updateMany({
      where: { id: sessionId, callerId: user.id, ...RINGING_WHERE },
      data: { status: 'CANCELLED', endReason: 'USER_HANGUP', endedAt: new Date() },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Fan, mientras suena: si ya la han cogido, rechazado o se ha perdido.
 * 'ringing' | 'accepted' | 'declined' | 'missed' | 'cancelled'
 */
export async function getRingStateAction(
  sessionId: string,
): Promise<CallActionResult<{ state: string; secondsLeft: number }>> {
  try {
    const user = await getAuthedUserOrThrow();
    await expireRingingCalls({ id: sessionId });
    const s = await prisma.callSession.findUnique({
      where: { id: sessionId },
      select: { callerId: true, status: true, endReason: true, createdAt: true },
    });
    if (!s || s.callerId !== user.id) return { ok: false, error: 'Llamada no encontrada.' };
    const secondsLeft = Math.max(0, RING_SECONDS - Math.floor((Date.now() - s.createdAt.getTime()) / 1000));
    const state =
      s.status === 'PENDING'
        ? 'ringing'
        : s.status === 'ACTIVE'
          ? 'accepted'
          : s.endReason === 'PARTNER_HANGUP'
            ? 'declined'
            : s.endReason === 'TIMEOUT'
              ? 'missed'
              : 'cancelled';
    return { ok: true, data: { state, secondsLeft } };
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
