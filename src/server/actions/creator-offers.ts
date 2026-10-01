'use server';

import { revalidatePath } from 'next/cache';
import type { CouponTarget } from '@prisma/client';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { assertCreatorVerified } from '@/lib/creator-kyc';
import { clampOfferPercent, CREATOR_OFFER_LIMITS } from '@/lib/creator-offer-rules';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';

/**
 * OFERTAS DEL CREADOR: las lanza el propio creador desde Mi panel > Ofertas
 * (o el cupon, desde el chat con el fan). El descuento sale de su precio.
 */

export interface OfferActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const HOUR = 3600_000;

async function requireCreator() {
  const user = await getAuthedUserOrThrow();
  const profile = await prisma.modelProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, userId: true, slug: true, stageName: true },
  });
  if (!profile) throw new Error('MODEL_PROFILE_MISSING');
  await assertCreatorVerified({ modelId: profile.id });
  return profile;
}

function validPercent(p: number) {
  return Number.isFinite(p) && p >= CREATOR_OFFER_LIMITS.minPercent && p <= CREATOR_OFFER_LIMITS.maxPercent;
}

function done(slug: string, message: string): OfferActionResult {
  revalidatePath('/dashboard/model/ofertas');
  revalidatePath(`/models/${slug}`);
  revalidatePath('/feed');
  return { ok: true, message };
}

/** Happy hour: -X% en privados desde ya, durante 1-3 h. Sustituye a la que hubiera. */
export async function startHappyHourAction(percentOff: number, hours: number): Promise<OfferActionResult> {
  try {
    const me = await requireCreator();
    if (!validPercent(percentOff)) return { ok: false, error: 'Elige un descuento entre 10% y 50%.' };
    if (!(CREATOR_OFFER_LIMITS.happyHourHours as readonly number[]).includes(hours)) {
      return { ok: false, error: 'Elige 1, 2 o 3 horas.' };
    }
    const now = new Date();
    await prisma.$transaction([
      prisma.creatorOffer.updateMany({
        where: { modelId: me.id, kind: 'HAPPY_HOUR', active: true },
        data: { active: false },
      }),
      prisma.creatorOffer.create({
        data: {
          modelId: me.id,
          kind: 'HAPPY_HOUR',
          percentOff: clampOfferPercent(percentOff),
          startsAt: now,
          endsAt: new Date(now.getTime() + hours * HOUR),
        },
      }),
    ]);
    return done(me.slug, `Happy hour activa: −${percentOff}% en tus privados durante ${hours} h.`);
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Rebajas flash: -X% en todo su contenido de pago durante 24-72 h. */
export async function startFlashSaleAction(
  percentOff: number,
  hours: number,
  notifyFollowers: boolean,
): Promise<OfferActionResult> {
  try {
    const me = await requireCreator();
    if (!validPercent(percentOff)) return { ok: false, error: 'Elige un descuento entre 10% y 50%.' };
    if (!(CREATOR_OFFER_LIMITS.flashSaleHours as readonly number[]).includes(hours)) {
      return { ok: false, error: 'Elige 24, 48 o 72 horas.' };
    }
    const now = new Date();
    // Rebajas creibles: como mucho 4 dias de rebajas en los ultimos 7.
    const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR);
    const recent = await prisma.creatorOffer.findMany({
      where: { modelId: me.id, kind: 'FLASH_SALE', endsAt: { gt: weekAgo }, active: true },
      select: { startsAt: true, endsAt: true },
    });
    const usedHours = recent.reduce((sum, o) => {
      const from = Math.max(o.startsAt.getTime(), weekAgo.getTime());
      const to = Math.min(o.endsAt!.getTime(), now.getTime());
      return sum + Math.max(0, to - from) / HOUR;
    }, 0);
    if (recent.some((o) => o.endsAt! > now)) {
      return { ok: false, error: 'Ya tienes unas rebajas en curso. Párala primero si quieres cambiarla.' };
    }
    if (usedHours + hours > CREATOR_OFFER_LIMITS.flashSaleMaxHoursPerWeek) {
      return {
        ok: false,
        error: 'Para que tus rebajas sean creíbles, puedes tener rebajas como mucho 4 días por semana.',
      };
    }

    await prisma.creatorOffer.create({
      data: {
        modelId: me.id,
        kind: 'FLASH_SALE',
        percentOff: clampOfferPercent(percentOff),
        startsAt: now,
        endsAt: new Date(now.getTime() + hours * HOUR),
      },
    });

    let notified = 0;
    if (notifyFollowers) {
      const followers = await prisma.follow.findMany({
        where: { modelId: me.id, notifyPosts: true },
        select: { userId: true },
      });
      for (let i = 0; i < followers.length; i += 1000) {
        await prisma.notification.createMany({
          data: followers.slice(i, i + 1000).map((f) => ({
            userId: f.userId,
            type: 'ANNOUNCEMENT' as const,
            title: `${me.stageName} tiene rebajas: −${percentOff}% en todo su contenido`,
            body: `Solo ${hours} horas.`,
            link: `/models/${me.slug}`,
          })),
        });
      }
      notified = followers.length;
    }
    return done(
      me.slug,
      `Rebajas activas: −${percentOff}% durante ${hours} h.${notified ? ` Avisamos a ${notified} seguidores.` : ''}`,
    );
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Primer mes o primera llamada: activa (con su %) o apaga (percentOff = null). */
export async function setStandingOfferAction(
  kind: 'FIRST_MONTH' | 'FIRST_CALL',
  percentOff: number | null,
): Promise<OfferActionResult> {
  try {
    const me = await requireCreator();
    if (percentOff != null && !validPercent(percentOff)) {
      return { ok: false, error: 'Elige un descuento entre 10% y 50%.' };
    }
    if (kind === 'FIRST_MONTH' && percentOff != null) {
      const p = await prisma.modelProfile.findUnique({
        where: { id: me.id },
        select: { subscriptionEnabled: true, subscriptionPriceTokens: true },
      });
      if (!p?.subscriptionEnabled || !p.subscriptionPriceTokens) {
        return { ok: false, error: 'Activa primero tu suscripción en Precios.' };
      }
    }
    await prisma.$transaction(async (tx) => {
      await tx.creatorOffer.updateMany({ where: { modelId: me.id, kind, active: true }, data: { active: false } });
      if (percentOff != null) {
        await tx.creatorOffer.create({
          data: { modelId: me.id, kind, percentOff: clampOfferPercent(percentOff) },
        });
      }
    });
    const what = kind === 'FIRST_MONTH' ? 'Primer mes' : 'Primera llamada';
    return done(me.slug, percentOff != null ? `${what}: −${percentOff}% activado.` : `${what} desactivado.`);
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Cupon personal para un fan con el que ya tiene chat: 24 h, un uso. */
export async function sendCouponAction(
  fanId: string,
  target: CouponTarget,
  percentOff: number,
): Promise<OfferActionResult> {
  try {
    const me = await requireCreator();
    if (!validPercent(percentOff)) return { ok: false, error: 'Elige un descuento entre 10% y 50%.' };
    if (target !== 'CALL' && target !== 'CONTENT') return { ok: false, error: 'Elige en qué vale el cupón.' };
    const conversation = await prisma.conversation.findFirst({
      where: { modelId: me.id, userId: fanId },
      select: { id: true },
    });
    if (!conversation) return { ok: false, error: 'Solo puedes enviar cupones a fans con los que tienes chat.' };

    const now = new Date();
    const live = await prisma.creatorOffer.findFirst({
      where: { modelId: me.id, kind: 'COUPON', fanId, target, usedAt: null, active: true, endsAt: { gt: now } },
      select: { id: true },
    });
    if (live) return { ok: false, error: 'Ya le enviaste un cupón de este tipo que sigue sin usar.' };

    await prisma.creatorOffer.create({
      data: {
        modelId: me.id,
        kind: 'COUPON',
        percentOff: clampOfferPercent(percentOff),
        fanId,
        target,
        startsAt: now,
        endsAt: new Date(now.getTime() + CREATOR_OFFER_LIMITS.couponHours * HOUR),
      },
    });
    await createNotification(prisma, {
      userId: fanId,
      type: 'ANNOUNCEMENT',
      title: `${me.stageName} te ha enviado un cupón: −${percentOff}% en ${target === 'CALL' ? 'tu próxima videollamada' : 'su contenido'}`,
      body: 'Vale 24 horas.',
      link: `/mensajes/${conversation.id}`,
    });
    revalidatePath(`/mensajes/${conversation.id}`);
    revalidatePath('/dashboard/model/ofertas');
    return { ok: true, message: `Cupón enviado: −${percentOff}% durante 24 h.` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Para cualquier oferta suya antes de tiempo. */
export async function stopOfferAction(offerId: string): Promise<OfferActionResult> {
  try {
    const me = await requireCreator();
    const { count } = await prisma.creatorOffer.updateMany({
      where: { id: offerId, modelId: me.id, active: true },
      data: { active: false },
    });
    if (count === 0) return { ok: false, error: 'Esa oferta ya no está activa.' };
    return done(me.slug, 'Oferta parada.');
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesión.';
    if (error.message === 'MODEL_PROFILE_MISSING') return 'Solo para creadores.';
    return error.message;
  }
  return 'No se pudo completar.';
}
