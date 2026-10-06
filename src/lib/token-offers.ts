import 'server-only';

import type { TokenPackage } from '@prisma/client';

import { config } from '@/lib/config';
import { FOUNDER_PLATFORM_PERCENT } from '@/lib/deals';
import { roundBonusTokens, roundOfferPrice } from '@/lib/price-rounding';
import { prisma } from '@/lib/prisma';
import { FAN_LINK_MONTHS, FAN_LINK_PLATFORM_PERCENT } from '@/lib/referrals';
import { getActiveTokenPromo, promoPriceCents, type ActivePromo } from '@/lib/token-promos';


/**
 * OFERTAS DE TOKENS
 *
 * Cada fan puede tener varias ofertas a la vez; en cada paquete se aplica
 * SOLO la que mas le conviene (nunca se suman):
 *
 *   - Bienvenida      primera compra, paquete mas barato: +40% de tokens.
 *   - Primeras 24 h   primera compra en sus 24 h tras registrarse, los dos
 *                     paquetes mas baratos: -25%.
 *   - Promocion       la del equipo (Hora loca, Fin de semana, Fechas
 *                     especiales...), en todos los paquetes.
 *   - Saldo bajo      ya compro antes, le quedan menos de 50 tokens y hace mas
 *                     de 24 h de su ultima compra: +10% de tokens.
 *   - Te echamos de menos  30 dias sin comprar: -15% durante 48 h.
 *
 * NUNCA SE PIERDE DINERO: ninguna oferta deja un paquete por debajo de lo que
 * cuesta pagar sus tokens al creador en el peor caso (un Fundador, 60%; o el
 * creador que trajo a este fan, 70%) mas la comision de la pasarela. Si una
 * oferta se pasa, en ese paquete se recorta hasta el maximo seguro. Los tratos
 * que el equipo negocia a mano quedan fuera: son decision suya.
 *
 * El precio y los tokens se deciden SIEMPRE aqui, en el servidor; el navegador
 * solo los enseña.
 */

export type OfferKind = 'welcome' | 'first24h' | 'promo' | 'lowBalance' | 'winback';

export const OFFER_RULES = {
  welcomeBonusPercent: 40,
  first24hPercentOff: 25,
  lowBalanceBonusPercent: 10,
  /** Por debajo de este saldo se ofrece "Saldo bajo". */
  lowBalanceTokens: 50,
  winbackPercentOff: 15,
  winbackAfterDays: 30,
  winbackHours: 48,
} as const;

export interface PackageOffer {
  kind: OfferKind;
  label: string;
  /** Descuento en el precio (0 si la oferta regala tokens). */
  percentOff: number;
  /** Tokens extra en % (0 si la oferta rebaja el precio). */
  bonusPercent: number;
  /** Se recorto por el limite de seguridad. */
  capped: boolean;
  endsAt: string | null;
}

export interface PricedPackage {
  id: string;
  name: string;
  description: string | null;
  currency: string;
  isPopular: boolean;
  tokens: number;
  /** Regalo fijo del paquete. */
  bonusTokens: number;
  /** Tokens extra por la oferta. */
  offerBonusTokens: number;
  /** Total que se acredita. */
  totalTokens: number;
  basePriceCents: number;
  /** Lo que se cobra. */
  priceCents: number;
  offer: PackageOffer | null;
}

/** Oferta personal en curso, para el aviso de arriba del monedero. */
export interface OfferBanner {
  kind: OfferKind;
  title: string;
  text: string;
  endsAt: string | null;
}

export interface OfferContext {
  /** % maximo que puede llevarse un creador con las compras de este fan. */
  maxCreatorPercent: number;
  promo: ActivePromo | null;
  welcome: boolean;
  first24hEndsAt: Date | null;
  lowBalance: boolean;
  winbackEndsAt: Date | null;
}

// ---------------------------------------------------------------------------
// Limite de seguridad
// ---------------------------------------------------------------------------

/** Lo que cuesta, en centavos, pagar un token al creador en el peor caso. */
function worstTokenCostCents(maxCreatorPercent: number) {
  return (config.economy.modelPayoutCentsPerToken * maxCreatorPercent) / 100;
}

/** Lo que llega de una venta despues de la pasarela. */
function netCents(priceCents: number) {
  return (priceCents * (100 - config.economy.paymentFeePercent)) / 100;
}

/** True si vender esos tokens a ese precio no hace perder dinero. */
export function isSafe(priceCents: number, totalTokens: number, maxCreatorPercent: number) {
  return netCents(priceCents) >= totalTokens * worstTokenCostCents(maxCreatorPercent);
}

/** Precio minimo (centavos) al que se pueden vender esos tokens sin perder. */
export function minSafePriceCents(totalTokens: number, maxCreatorPercent = defaultMaxCreatorPercent()) {
  return Math.ceil((totalTokens * worstTokenCostCents(maxCreatorPercent) * 100) / (100 - config.economy.paymentFeePercent));
}

/** % de descuento maximo en este paquete sin perder dinero. */
export function maxSafePercentOff(
  pkg: Pick<TokenPackage, 'priceCents' | 'tokens' | 'bonusTokens'>,
  maxCreatorPercent = defaultMaxCreatorPercent(),
) {
  const total = pkg.tokens + pkg.bonusTokens;
  const floorPrice = (total * worstTokenCostCents(maxCreatorPercent) * 100) / (100 - config.economy.paymentFeePercent);
  const pct = Math.floor((1 - floorPrice / pkg.priceCents) * 100);
  return Math.max(0, pct);
}

/** % de tokens extra maximo en este paquete sin perder dinero. */
export function maxSafeBonusPercent(
  pkg: Pick<TokenPackage, 'priceCents' | 'tokens' | 'bonusTokens'>,
  maxCreatorPercent = defaultMaxCreatorPercent(),
) {
  const total = pkg.tokens + pkg.bonusTokens;
  const maxTokens = netCents(pkg.priceCents) / worstTokenCostCents(maxCreatorPercent);
  const pct = Math.floor((maxTokens / total - 1) * 100);
  return Math.max(0, pct);
}

/** El peor caso general: un Fundador (o el estandar si es mayor). */
export function defaultMaxCreatorPercent() {
  return 100 - Math.min(config.economy.platformCommissionPercent, FOUNDER_PLATFORM_PERCENT);
}

// ---------------------------------------------------------------------------
// Que ofertas tiene cada fan
// ---------------------------------------------------------------------------

function monthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

/** Ofertas de un fan (o de un visitante sin cuenta: solo la promocion). */
export async function getOfferContext(userId: string | null, now = new Date()): Promise<OfferContext> {
  const promo = await getActiveTokenPromo(now);
  const base: OfferContext = {
    maxCreatorPercent: defaultMaxCreatorPercent(),
    promo,
    welcome: false,
    first24hEndsAt: null,
    lowBalance: false,
    winbackEndsAt: null,
  };
  if (!userId) return base;

  const [user, purchases, lastPurchase] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        createdAt: true,
        winbackOfferStartedAt: true,
        wallet: { select: { balance: true } },
        referredBy: { select: { modelProfile: { select: { id: true } } } },
      },
    }),
    prisma.transaction.count({ where: { userId, type: 'TOKEN_PURCHASE', status: 'COMPLETED' } }),
    prisma.transaction.findFirst({
      where: { userId, type: 'TOKEN_PURCHASE', status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  if (!user) return base;

  // Fan traido por un creador: ese creador se lleva mas de sus compras.
  const fanLink = Boolean(user.referredBy?.modelProfile) && user.createdAt >= monthsAgo(FAN_LINK_MONTHS);
  const maxCreatorPercent = fanLink
    ? Math.max(base.maxCreatorPercent, 100 - FAN_LINK_PLATFORM_PERCENT)
    : base.maxCreatorPercent;

  const ctx: OfferContext = { ...base, maxCreatorPercent };
  const hour = 3600_000;

  if (purchases === 0) {
    // Una detras de otra, nunca las dos a la vez: el primer dia "Primeras 24 h";
    // si no compro en ese dia, desde entonces "Bienvenida" hasta su primera compra.
    const ends = new Date(user.createdAt.getTime() + 24 * hour);
    if (ends > now) ctx.first24hEndsAt = ends;
    else ctx.welcome = true;
  } else if (lastPurchase) {
    const sinceLast = now.getTime() - lastPurchase.createdAt.getTime();
    ctx.lowBalance = (user.wallet?.balance ?? 0) < OFFER_RULES.lowBalanceTokens && sinceLast >= 24 * hour;
    const started = user.winbackOfferStartedAt;
    if (started && started > lastPurchase.createdAt) {
      const ends = new Date(started.getTime() + OFFER_RULES.winbackHours * hour);
      if (ends > now) ctx.winbackEndsAt = ends;
    }
  }
  return ctx;
}

/**
 * Abre la ventana de 48 h de "Te echamos de menos" si lleva 30 dias sin
 * comprar y aun no se le abrio desde su ultima compra. Devuelve true si se
 * acaba de abrir (para avisarle).
 */
export async function startWinbackIfDue(userId: string, now = new Date()): Promise<boolean> {
  const [user, lastPurchase] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { winbackOfferStartedAt: true } }),
    prisma.transaction.findFirst({
      where: { userId, type: 'TOKEN_PURCHASE', status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  if (!user || !lastPurchase) return false;
  const due = now.getTime() - lastPurchase.createdAt.getTime() >= OFFER_RULES.winbackAfterDays * 24 * 3600_000;
  const alreadyOpened = user.winbackOfferStartedAt && user.winbackOfferStartedAt > lastPurchase.createdAt;
  if (!due || alreadyOpened) return false;
  const { count } = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ winbackOfferStartedAt: null }, { winbackOfferStartedAt: { lte: lastPurchase.createdAt } }],
    },
    data: { winbackOfferStartedAt: now },
  });
  if (count === 0) return false;
  await prisma.notification.create({
    data: {
      userId,
      type: 'ANNOUNCEMENT',
      title: `Te echamos de menos: −${OFFER_RULES.winbackPercentOff}% en tokens`,
      body: `Solo para ti durante ${OFFER_RULES.winbackHours} horas.`,
      link: '/wallet',
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Precio de cada paquete
// ---------------------------------------------------------------------------

interface Candidate {
  kind: OfferKind;
  label: string;
  percentOff: number;
  bonusPercent: number;
  endsAt: Date | null;
}

/** Ofertas que aplican a un paquete (posicion = 0 el mas barato). */
function candidatesFor(ctx: OfferContext, position: number): Candidate[] {
  const out: Candidate[] = [];
  if (ctx.welcome && position === 0) {
    out.push({ kind: 'welcome', label: 'Bienvenida', percentOff: 0, bonusPercent: OFFER_RULES.welcomeBonusPercent, endsAt: null });
  }
  if (ctx.first24hEndsAt && position <= 1) {
    out.push({ kind: 'first24h', label: 'Primeras 24 h', percentOff: OFFER_RULES.first24hPercentOff, bonusPercent: 0, endsAt: ctx.first24hEndsAt });
  }
  if (ctx.promo) {
    out.push({ kind: 'promo', label: ctx.promo.title, percentOff: ctx.promo.percentOff, bonusPercent: 0, endsAt: new Date(ctx.promo.endsAt) });
  }
  if (ctx.lowBalance) {
    out.push({ kind: 'lowBalance', label: 'Saldo bajo', percentOff: 0, bonusPercent: OFFER_RULES.lowBalanceBonusPercent, endsAt: null });
  }
  if (ctx.winbackEndsAt) {
    out.push({ kind: 'winback', label: 'Te echamos de menos', percentOff: OFFER_RULES.winbackPercentOff, bonusPercent: 0, endsAt: ctx.winbackEndsAt });
  }
  return out;
}

/** Aplica las ofertas a los paquetes (ya ordenados por sortOrder). */
export function pricePackages(packages: TokenPackage[], ctx: OfferContext): PricedPackage[] {
  const byPrice = [...packages].sort((a, b) => a.priceCents - b.priceCents).map((p) => p.id);

  return packages.map((pkg) => {
    const baseTotal = pkg.tokens + pkg.bonusTokens;
    const plain: PricedPackage = {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      currency: pkg.currency,
      isPopular: pkg.isPopular,
      tokens: pkg.tokens,
      bonusTokens: pkg.bonusTokens,
      offerBonusTokens: 0,
      totalTokens: baseTotal,
      basePriceCents: pkg.priceCents,
      priceCents: pkg.priceCents,
      offer: null,
    };

    let best: PricedPackage = plain;
    for (const c of candidatesFor(ctx, byPrice.indexOf(pkg.id))) {
      let percentOff = c.percentOff;
      let bonusPercent = c.bonusPercent;
      const maxOff = maxSafePercentOff(pkg, ctx.maxCreatorPercent);
      const maxBonus = maxSafeBonusPercent(pkg, ctx.maxCreatorPercent);
      const capped = percentOff > maxOff || bonusPercent > maxBonus;
      percentOff = Math.min(percentOff, maxOff);
      bonusPercent = Math.min(bonusPercent, maxBonus);
      if (percentOff <= 0 && bonusPercent <= 0) continue;

      // Precio redondo (X,99) y regalo redondo (multiplo de 5).
      const offerBonusTokens = roundBonusTokens(Math.floor((baseTotal * bonusPercent) / 100));
      const totalTokens = baseTotal + offerBonusTokens;
      let priceCents = pkg.priceCents;
      if (percentOff > 0) {
        const rounded = roundOfferPrice(
          promoPriceCents(pkg.priceCents, percentOff),
          pkg.priceCents,
          minSafePriceCents(totalTokens, ctx.maxCreatorPercent),
        );
        if (rounded == null) continue;
        priceCents = rounded;
        // El % que se ve es el real del precio redondeado.
        percentOff = Math.round((1 - priceCents / pkg.priceCents) * 100);
      }
      if (offerBonusTokens <= 0 && priceCents >= pkg.priceCents) continue;
      if (!isSafe(priceCents, totalTokens, ctx.maxCreatorPercent)) continue;

      // Gana la que deja el token mas barato al fan.
      if (priceCents / totalTokens < best.priceCents / best.totalTokens) {
        best = {
          ...plain,
          offerBonusTokens,
          totalTokens,
          priceCents,
          offer: {
            kind: c.kind,
            label: c.label,
            percentOff,
            bonusPercent: offerBonusTokens > 0 ? bonusPercent : 0,
            capped,
            endsAt: c.endsAt ? c.endsAt.toISOString() : null,
          },
        };
      }
    }
    return best;
  });
}

/** Avisos de las ofertas personales/promocion en curso para el monedero. */
export function offerBanners(ctx: OfferContext): OfferBanner[] {
  const out: OfferBanner[] = [];
  if (ctx.first24hEndsAt) {
    out.push({
      kind: 'first24h',
      title: 'Tus primeras 24 horas',
      text: `−${OFFER_RULES.first24hPercentOff}% en tu primera compra de los paquetes pequeños.`,
      endsAt: ctx.first24hEndsAt.toISOString(),
    });
  }
  if (ctx.welcome) {
    out.push({
      kind: 'welcome',
      title: 'Regalo de bienvenida',
      text: `+${OFFER_RULES.welcomeBonusPercent}% de tokens en tu primer paquete.`,
      endsAt: null,
    });
  }
  if (ctx.winbackEndsAt) {
    out.push({
      kind: 'winback',
      title: 'Te echamos de menos',
      text: `−${OFFER_RULES.winbackPercentOff}% en todos los paquetes, solo para ti.`,
      endsAt: ctx.winbackEndsAt.toISOString(),
    });
  }
  if (ctx.lowBalance) {
    out.push({
      kind: 'lowBalance',
      title: 'Te queda poco saldo',
      text: `Recarga ahora y te regalamos un ${OFFER_RULES.lowBalanceBonusPercent}% más de tokens.`,
      endsAt: null,
    });
  }
  if (ctx.promo) {
    out.push({
      kind: 'promo',
      title: ctx.promo.title,
      text: `Hasta −${ctx.promo.percentOff}% en los paquetes.`,
      endsAt: ctx.promo.endsAt,
    });
  }
  return out;
}

/** Atajo: paquetes activos con las ofertas de este fan ya aplicadas. */
export async function getPricedPackages(userId: string | null) {
  const [packages, ctx] = await Promise.all([
    prisma.tokenPackage.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    getOfferContext(userId),
  ]);
  return { packages: pricePackages(packages, ctx), banners: offerBanners(ctx), ctx };
}
