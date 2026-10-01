/**
 * REGLAS DE LAS OFERTAS DEL CREADOR
 *
 * Compartidas por el servidor (lo que se cobra) y por el panel del creador
 * (lo que ve antes de lanzarlas). No importa nada.
 */

export type CreatorOfferKindKey = 'HAPPY_HOUR' | 'FLASH_SALE' | 'FIRST_MONTH' | 'FIRST_CALL' | 'COUPON';

export const CREATOR_OFFER_LIMITS = {
  minPercent: 10,
  maxPercent: 50,
  /** Happy hour: horas que puede durar. */
  happyHourHours: [1, 2, 3] as const,
  /** Rebajas flash: horas que puede durar. */
  flashSaleHours: [24, 48, 72] as const,
  /** Para que las rebajas sean creibles: como mucho 4 dias de rebajas por semana. */
  flashSaleMaxHoursPerWeek: 96,
  couponHours: 24,
} as const;

/** Los % que se ofrecen como botones en el panel. */
export const CREATOR_OFFER_PERCENTS = [10, 20, 30, 40, 50] as const;

export const CREATOR_OFFER_INFO: Record<
  CreatorOfferKindKey,
  { title: string; short: string; fanLabel: string }
> = {
  HAPPY_HOUR: {
    title: 'Happy hour',
    short: 'Tus privados más baratos durante unas horas, desde ya.',
    fanLabel: 'Happy hour',
  },
  FLASH_SALE: {
    title: 'Rebajas flash',
    short: 'Todo tu contenido de pago rebajado durante 1 a 3 días.',
    fanLabel: 'Rebajas',
  },
  FIRST_MONTH: {
    title: 'Primer mes',
    short: 'Quien se suscribe por primera vez paga menos el primer mes.',
    fanLabel: 'Primer mes',
  },
  FIRST_CALL: {
    title: 'Primera llamada',
    short: 'Los fans que nunca te han llamado pagan menos su primera videollamada.',
    fanLabel: 'Primera llamada',
  },
  COUPON: {
    title: 'Cupón para un fan',
    short: 'Un descuento solo para un fan, desde vuestro chat. Vale 24 h y un uso.',
    fanLabel: 'Cupón',
  },
};

/** Precio con descuento (tokens enteros, nunca 0 si costaba algo). */
export function discountTokens(priceTokens: number, percentOff: number): number {
  if (priceTokens <= 0 || percentOff <= 0) return priceTokens;
  return Math.max(1, Math.round((priceTokens * (100 - percentOff)) / 100));
}

export function clampOfferPercent(p: number): number {
  return Math.min(CREATOR_OFFER_LIMITS.maxPercent, Math.max(CREATOR_OFFER_LIMITS.minPercent, Math.round(p)));
}
