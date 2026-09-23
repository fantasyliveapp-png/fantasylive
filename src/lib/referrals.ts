import 'server-only';

import type { Prisma } from '@prisma/client';

import { config } from '@/lib/config';

type Tx = Prisma.TransactionClient;

/**
 * PROGRAMA DE REFERIDOS (sin capital: todo sale de la comision de la
 * plataforma y SOLO cuando ya ha entrado dinero real).
 *
 * 1. EMBAJADORAS: una creadora invita a otra con su enlace. Cuando la
 *    invitada vende, la que la invito cobra el 5% de cada venta, restado de
 *    la comision de la plataforma. Las 100 primeras creadoras verificadas
 *    (FUNDADORAS) lo cobran para siempre; el resto, 12 meses desde que la
 *    invitada se hizo creadora.
 *
 * 2. TUS FANS, TU COMISION: los fans que llegan por el enlace de una
 *    creadora le dejan mas dinero a ella: en lo que gasten CON ELLA, la
 *    plataforma se queda el 30% en vez del 40% (ella, el 70%) durante sus
 *    primeros 12 meses.
 *
 * Nadie cobra por registrarse ni por adelantado, y quien paga nunca cobra
 * comision de si mismo.
 */

export const REF_COOKIE = 'fl_ref';
export const REF_COOKIE_MAX_AGE = 30 * 24 * 3600;

export const FOUNDER_SPOTS = 100;
export const AMBASSADOR_PERCENT = 5;
export const AMBASSADOR_MONTHS = 12;
export const FAN_LINK_PLATFORM_PERCENT = 30;
export const FAN_LINK_MONTHS = 12;

function monthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

export interface ReferralSplit {
  platformFeeTokens: number;
  modelTokens: number;
  /** % de la plataforma aplicado (40 normal, 30 con fan propio). */
  platformPercent: number;
  /** Comision de embajadora, si toca. */
  ambassador: { userId: string; tokens: number } | null;
}

/**
 * Reparto de un gasto `tokens` que hace `payerId` a la creadora `earnerId`,
 * aplicando las reglas de referidos.
 */
export async function referralSplit(
  tx: Tx,
  params: { payerId: string; earnerId: string; tokens: number },
): Promise<ReferralSplit> {
  const { payerId, earnerId, tokens } = params;
  const [payer, earner] = await Promise.all([
    tx.user.findUnique({
      where: { id: payerId },
      select: { referredById: true, createdAt: true },
    }),
    tx.user.findUnique({
      where: { id: earnerId },
      select: {
        referredById: true,
        modelProfile: { select: { createdAt: true } },
      },
    }),
  ]);

  // 2. Fan traido por esta misma creadora, dentro de sus 12 meses.
  const fanLink =
    payer?.referredById === earnerId && payer.createdAt >= monthsAgo(FAN_LINK_MONTHS);
  const platformPercent = fanLink
    ? Math.min(FAN_LINK_PLATFORM_PERCENT, config.economy.platformCommissionPercent)
    : config.economy.platformCommissionPercent;

  let platformFeeTokens = Math.round((tokens * platformPercent) / 100);
  const modelTokens = tokens - platformFeeTokens;

  // 1. Embajadora: quien invito a esta creadora cobra su % (de la comision).
  let ambassador: ReferralSplit['ambassador'] = null;
  const referrerId = earner?.referredById;
  if (referrerId && referrerId !== payerId && earner?.modelProfile) {
    const referrer = await tx.modelProfile.findUnique({
      where: { userId: referrerId },
      select: { kycStatus: true, founderNumber: true },
    });
    const inWindow =
      referrer?.founderNumber != null ||
      earner.modelProfile.createdAt >= monthsAgo(AMBASSADOR_MONTHS);
    if (referrer?.kycStatus === 'APPROVED' && inWindow) {
      const share = Math.min(
        platformFeeTokens,
        Math.floor((tokens * AMBASSADOR_PERCENT) / 100),
      );
      if (share > 0) {
        ambassador = { userId: referrerId, tokens: share };
        platformFeeTokens -= share;
      }
    }
  }

  return { platformFeeTokens, modelTokens, platformPercent, ambassador };
}

/**
 * Da a una creadora recien verificada su numero de Fundadora si aun quedan
 * plazas (las 100 primeras). Idempotente.
 */
export async function assignFounderNumber(tx: Tx, modelId: string): Promise<number | null> {
  const profile = await tx.modelProfile.findUnique({
    where: { id: modelId },
    select: { founderNumber: true },
  });
  if (!profile) return null;
  if (profile.founderNumber != null) return profile.founderNumber;

  const last = await tx.modelProfile.aggregate({ _max: { founderNumber: true } });
  const next = (last._max.founderNumber ?? 0) + 1;
  if (next > FOUNDER_SPOTS) return null;
  await tx.modelProfile.update({ where: { id: modelId }, data: { founderNumber: next } });
  return next;
}
