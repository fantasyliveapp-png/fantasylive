import 'server-only';

import type { CreatorOffer, CreatorOfferKind, Prisma } from '@prisma/client';

import { CREATOR_OFFER_INFO } from '@/lib/creator-offer-rules';
import { prisma } from '@/lib/prisma';
import { MIN_RATE_CENTITOKENS } from '@/lib/rates';

/**
 * OFERTAS DEL CREADOR: que descuento le toca a un fan.
 *
 * El descuento sale del precio del creador. La plataforma cobra su % de lo
 * que el fan paga de verdad, asi que una oferta nunca le hace perder dinero.
 * Nunca se suman: si tiene varias (o su descuento de suscriptor en llamadas),
 * se aplica la mayor.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface AppliedOffer {
  id: string;
  kind: CreatorOfferKind;
  label: string;
  percentOff: number;
  endsAt: string | null;
}

function toApplied(o: CreatorOffer): AppliedOffer {
  return {
    id: o.id,
    kind: o.kind,
    label: CREATOR_OFFER_INFO[o.kind].fanLabel,
    percentOff: o.percentOff,
    endsAt: o.endsAt ? o.endsAt.toISOString() : null,
  };
}

function best(offers: CreatorOffer[]): AppliedOffer | null {
  if (offers.length === 0) return null;
  return toApplied(offers.reduce((a, b) => (b.percentOff > a.percentOff ? b : a)));
}

/** Ofertas en curso (o cupones vivos) de uno o varios creadores. */
function liveWhere(now: Date): Prisma.CreatorOfferWhereInput {
  return {
    active: true,
    startsAt: { lte: now },
    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
  };
}

/** Cupones sin usar de este fan con este creador. */
async function liveCoupons(db: Db, modelId: string, fanId: string | null, now: Date) {
  if (!fanId) return [];
  return db.creatorOffer.findMany({
    where: { ...liveWhere(now), modelId, kind: 'COUPON', fanId, usedAt: null },
  });
}

/** Tarifa por minuto rebajada, sin bajar del minimo de la plataforma. */
export function applyRateOffer(rateCentitokens: number, percentOff: number) {
  if (percentOff <= 0) return rateCentitokens;
  return Math.max(MIN_RATE_CENTITOKENS, Math.round((rateCentitokens * (100 - percentOff)) / 100));
}

/** Ha tenido ya alguna videollamada privada (cobrada) con este creador. */
async function hasCalledBefore(db: Db, fanId: string, modelUserId: string) {
  const call = await db.callSession.findFirst({
    where: { type: 'PRIVATE', callerId: fanId, calleeId: modelUserId, billedSeconds: { gt: 0 } },
    select: { id: true },
  });
  return Boolean(call);
}

/** Mejor oferta en la proxima videollamada: happy hour, primera llamada o cupon. */
export async function getCallOffer(
  model: { id: string; userId: string },
  fanId: string | null,
  db: Db = prisma,
  now = new Date(),
): Promise<AppliedOffer | null> {
  const [offers, coupons] = await Promise.all([
    db.creatorOffer.findMany({
      where: { ...liveWhere(now), modelId: model.id, kind: { in: ['HAPPY_HOUR', 'FIRST_CALL'] } },
    }),
    liveCoupons(db, model.id, fanId, now),
  ]);
  let candidates = [...offers, ...coupons.filter((c) => c.target === 'CALL')];
  if (candidates.some((o) => o.kind === 'FIRST_CALL') && fanId && (await hasCalledBefore(db, fanId, model.userId))) {
    candidates = candidates.filter((o) => o.kind !== 'FIRST_CALL');
  }
  return best(candidates);
}

/** Mejor oferta en su contenido de pago: rebajas flash o cupon de contenido. */
export async function getContentOffer(
  modelId: string,
  fanId: string | null,
  db: Db = prisma,
  now = new Date(),
): Promise<AppliedOffer | null> {
  const [offers, coupons] = await Promise.all([
    db.creatorOffer.findMany({ where: { ...liveWhere(now), modelId, kind: 'FLASH_SALE' } }),
    liveCoupons(db, modelId, fanId, now),
  ]);
  return best([...offers, ...coupons.filter((c) => c.target === 'CONTENT')]);
}

/** Lo mismo para muchos creadores a la vez (feed, perfil, busqueda). */
export async function getContentOffersFor(
  modelIds: string[],
  fanId: string | null,
  now = new Date(),
): Promise<Map<string, AppliedOffer>> {
  const ids = [...new Set(modelIds)];
  const out = new Map<string, AppliedOffer>();
  if (ids.length === 0) return out;
  const offers = await prisma.creatorOffer.findMany({
    where: {
      ...liveWhere(now),
      modelId: { in: ids },
      OR: [
        { kind: 'FLASH_SALE' },
        ...(fanId ? [{ kind: 'COUPON' as const, target: 'CONTENT' as const, fanId, usedAt: null }] : []),
      ],
    },
  });
  for (const id of ids) {
    const b = best(offers.filter((o) => o.modelId === id));
    if (b) out.set(id, b);
  }
  return out;
}

/** Primer mes rebajado si nunca se ha suscrito a este creador. */
export async function getFirstMonthOffer(
  modelId: string,
  fanId: string | null,
  db: Db = prisma,
  now = new Date(),
): Promise<AppliedOffer | null> {
  const offer = await db.creatorOffer.findFirst({
    where: { ...liveWhere(now), modelId, kind: 'FIRST_MONTH' },
    orderBy: { percentOff: 'desc' },
  });
  if (!offer) return null;
  if (fanId) {
    const before = await db.subscription.findUnique({
      where: { userId_modelId: { userId: fanId, modelId } },
      select: { id: true },
    });
    if (before) return null;
  }
  return toApplied(offer);
}

/**
 * Apunta una venta hecha con la oferta. Un cupon se gasta aqui: si ya estaba
 * usado (dos pestanas a la vez), lanza y la transaccion se deshace.
 */
export async function recordOfferUse(db: Db, offer: AppliedOffer, tokensPaid: number) {
  if (offer.kind === 'COUPON') {
    const { count } = await db.creatorOffer.updateMany({
      where: { id: offer.id, usedAt: null },
      data: { usedAt: new Date(), uses: { increment: 1 }, tokensPaid: { increment: tokensPaid } },
    });
    if (count === 0) throw new Error('Ese cupón ya se ha usado.');
    return;
  }
  await db.creatorOffer.update({
    where: { id: offer.id },
    data: { uses: { increment: 1 }, tokensPaid: { increment: tokensPaid } },
  });
}

/**
 * La llamada con oferta se cogio: cuenta como venta de la oferta y, si era un
 * cupon, se gasta. Si llamo y no se cogio, el cupon sigue disponible.
 */
export async function markCallOfferUsed(sessionId: string) {
  const s = await prisma.callSession.findUnique({ where: { id: sessionId }, select: { creatorOfferId: true } });
  if (!s?.creatorOfferId) return;
  await prisma.creatorOffer.updateMany({
    where: { id: s.creatorOfferId },
    data: { uses: { increment: 1 } },
  });
  await prisma.creatorOffer.updateMany({
    where: { id: s.creatorOfferId, kind: 'COUPON', usedAt: null },
    data: { usedAt: new Date() },
  });
}

/** Suma tokens pagados a una oferta ya contada (los minutos de una llamada). */
export async function addOfferTokens(db: Db, offerId: string, tokens: number) {
  if (tokens <= 0) return;
  await db.creatorOffer.update({ where: { id: offerId }, data: { tokensPaid: { increment: tokens } } });
}

/** Ofertas que ve un fan en el perfil de un creador. */
export async function getProfileOffers(
  model: { id: string; userId: string },
  fanId: string | null,
): Promise<{ call: AppliedOffer | null; content: AppliedOffer | null; firstMonth: AppliedOffer | null }> {
  const [call, content, firstMonth] = await Promise.all([
    getCallOffer(model, fanId),
    getContentOffer(model.id, fanId),
    getFirstMonthOffer(model.id, fanId),
  ]);
  return { call, content, firstMonth };
}
