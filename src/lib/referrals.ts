import 'server-only';

import type { Prisma } from '@prisma/client';

import { DEAL_SELECT, effectiveTerms, STANDARD_AMBASSADOR_PERCENT } from '@/lib/deals';

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
 * 3. RECLUTADORES: personas que no crean contenido y solo traen creadoras.
 *    Los da de alta el equipo con condiciones negociadas (su %, cuantos
 *    meses y un cupo maximo de creadoras). Cobran de la comision de la
 *    plataforma, igual que las embajadoras.
 *
 * 4. TRATOS: una creadora puede tener % negociados con el equipo (lo que
 *    retiene la plataforma y lo que cobra como embajadora); ver lib/deals.ts.
 *
 * Nadie cobra por registrarse ni por adelantado, y quien paga nunca cobra
 * comision de si mismo.
 */

/**
 * Cookie de quien invito: "<userId>" (creadora) o "r:<recruiterId>"
 * (reclutador). Gana el ultimo enlace que abrio antes de registrarse.
 */
export const REF_COOKIE = 'fl_ref';
export const REF_COOKIE_MAX_AGE = 30 * 24 * 3600;

export const FOUNDER_SPOTS = 100;
/** % estandar de embajadora; con trato puede ser otro (ver lib/deals.ts). */
export const AMBASSADOR_PERCENT = STANDARD_AMBASSADOR_PERCENT;
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
  /** A quien hay que pagar comision de referidos (embajadora, reclutador). */
  referrers: { userId: string; tokens: number; kind: 'ambassador' | 'recruiter' }[];
  /** Si la creadora es de un reclutador y esta venta NO le deja nada, por que. */
  recruiterSkip: RecruiterSkip | null;
  /** Su % exacto de esta venta, en centesimas de token (se acumula). */
  recruiterAccrued: number;
}

/** Por que una venta de una creadora reclutada no le deja comision al reclutador. */
export type RecruiterSkip = 'paused' | 'expired' | 'out_of_quota' | 'self';

/**
 * Desglose de una venta que se guarda en el movimiento de la creadora, para
 * poder ver despues cada venta con lo que se llevo cada parte.
 */
export function saleMetadata(
  split: ReferralSplit,
  params: { payerId: string; tokens: number },
  base?: Prisma.InputJsonValue,
): Prisma.InputJsonValue {
  const sale = {
    grossTokens: params.tokens,
    creatorTokens: split.modelTokens,
    platformFeeTokens: split.platformFeeTokens,
    platformPercent: split.platformPercent,
    payerId: params.payerId,
    referrals: split.referrers.map((r) => ({ kind: r.kind, userId: r.userId, tokens: r.tokens })),
    recruiterSkip: split.recruiterSkip,
    recruiterAccrued: split.recruiterAccrued,
  };
  const isObject = base != null && typeof base === 'object' && !Array.isArray(base);
  return { ...(isObject ? (base as Record<string, Prisma.InputJsonValue>) : {}), sale };
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
        recruitedById: true,
        modelProfile: { select: { createdAt: true, ...DEAL_SELECT } },
      },
    }),
  ]);

  // 4. Trato: si la creadora tiene un % de plataforma negociado, es su base.
  const basePercent = effectiveTerms(earner?.modelProfile).platformPercent;

  // 2. Fan traido por esta misma creadora, dentro de sus 12 meses (si su
  //    trato ya es mejor que el 30%, se queda con el trato).
  const fanLink =
    payer?.referredById === earnerId && payer.createdAt >= monthsAgo(FAN_LINK_MONTHS);
  const platformPercent = fanLink ? Math.min(FAN_LINK_PLATFORM_PERCENT, basePercent) : basePercent;

  let platformFeeTokens = Math.round((tokens * platformPercent) / 100);
  const modelTokens = tokens - platformFeeTokens;

  const referrers: ReferralSplit['referrers'] = [];
  let recruiterSkip: RecruiterSkip | null = null;
  let recruiterAccrued = 0;

  // 1. Embajadora: quien invito a esta creadora cobra su % (de la comision).
  const referrerId = earner?.referredById;
  if (referrerId && referrerId !== payerId && earner?.modelProfile) {
    const referrer = await tx.modelProfile.findUnique({
      where: { userId: referrerId },
      select: { kycStatus: true, ...DEAL_SELECT },
    });
    const inWindow =
      referrer?.founderNumber != null ||
      earner.modelProfile.createdAt >= monthsAgo(AMBASSADOR_MONTHS);
    if (referrer?.kycStatus === 'APPROVED' && inWindow) {
      // Su % de embajadora: el de su trato si lo tiene, si no el estandar.
      const percent = effectiveTerms(referrer).ambassadorPercent;
      const share = Math.min(platformFeeTokens, Math.floor((tokens * percent) / 100));
      if (share > 0) {
        referrers.push({ userId: referrerId, tokens: share, kind: 'ambassador' });
        platformFeeTokens -= share;
      }
    }
  }

  // 3. Reclutador: su % negociado, dentro de sus meses y de su cupo.
  if (earner?.recruitedById && earner.modelProfile) {
    const recruiter = await tx.recruiter.findUnique({
      where: { id: earner.recruitedById },
      select: {
        id: true,
        userId: true,
        active: true,
        commissionPercent: true,
        months: true,
        maxCreators: true,
      },
    });
    const creatorSince = earner.modelProfile.createdAt;
    const inWindow =
      recruiter?.months == null || creatorSince >= monthsAgo(recruiter.months);
    // Cupo: solo cuentan sus N primeras creadoras (por orden de alta).
    const inQuota =
      recruiter?.maxCreators == null ||
      (await tx.user.count({
        where: {
          recruitedById: recruiter.id,
          modelProfile: { createdAt: { lt: creatorSince } },
        },
      })) < recruiter.maxCreators;
    if (recruiter?.active && recruiter.userId !== payerId && inWindow && inQuota) {
      // Cobra de TODO lo que gana la creadora, aunque sea poco: su % se suma
      // en centesimas de token y se le abona cada token que se completa. Sin
      // esto, un tramo de llamada de 1 token (5% = 0,05) le daria siempre 0.
      // El UPDATE bloquea la fila hasta el commit, asi que dos ventas a la vez
      // no pueden cobrar la misma fraccion.
      recruiterAccrued = tokens * recruiter.commissionPercent;
      const [row] = await tx.$queryRaw<{ carry: number }[]>`
        UPDATE recruiters
        SET "commissionCarry" = "commissionCarry" + ${recruiterAccrued}
        WHERE id = ${recruiter.id}
        RETURNING "commissionCarry" AS carry`;
      const share = Math.min(platformFeeTokens, Math.floor((row?.carry ?? 0) / 100));
      if (share > 0) {
        await tx.recruiter.update({
          where: { id: recruiter.id },
          data: { commissionCarry: { decrement: share * 100 } },
        });
        referrers.push({ userId: recruiter.userId, tokens: share, kind: 'recruiter' });
        platformFeeTokens -= share;
      }
    } else if (recruiter) {
      recruiterSkip = !recruiter.active
        ? 'paused'
        : recruiter.userId === payerId
          ? 'self'
          : !inWindow
            ? 'expired'
            : 'out_of_quota';
    }
  }

  return { platformFeeTokens, modelTokens, platformPercent, referrers, recruiterSkip, recruiterAccrued };
}

/** Asienta en el monedero de cada referidor lo que le toca de un cobro. */
export async function payReferrers(
  tx: Tx,
  referrers: ReferralSplit['referrers'],
  meta: {
    description: string;
    fromCreatorUserId: string;
    applyLedgerEntry: (tx: Tx, entry: {
      userId: string;
      type: 'REFERRAL_EARNING';
      tokens: number;
      description: string;
      metadata: Prisma.InputJsonValue;
      callSessionId?: string;
      bookingId?: string;
    }) => Promise<unknown>;
    callSessionId?: string;
    bookingId?: string;
  },
) {
  for (const r of referrers) {
    await meta.applyLedgerEntry(tx, {
      userId: r.userId,
      type: 'REFERRAL_EARNING',
      tokens: r.tokens,
      description: `${r.kind === 'recruiter' ? 'Reclutador' : 'Embajadora'}: ${meta.description}`,
      metadata: { kind: r.kind, fromCreatorUserId: meta.fromCreatorUserId },
      ...(meta.callSessionId ? { callSessionId: meta.callSessionId } : {}),
      ...(meta.bookingId ? { bookingId: meta.bookingId } : {}),
    });
  }
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
