import { config } from '@/lib/config';

/**
 * TRATOS CON CREADORAS
 *
 * El equipo puede negociar con una creadora condiciones distintas de las
 * estandar: que la plataforma se quede con menos de sus ventas y/o que cobre
 * mas por cada creadora que invite. Se guardan en su ModelProfile y valen
 * hasta `dealUntil` (o para siempre si no tiene fecha).
 *
 * Todo lo que se paga a reclutadores y embajadoras sale de la comision de la
 * plataforma y nunca la supera (ver referralSplit), asi que un trato nunca
 * hace que una venta cueste dinero: como mucho, la plataforma gana menos.
 */

export const STANDARD_AMBASSADOR_PERCENT = 5;

/**
 * FUNDADORES: los 100 primeros creadores verificados ganan el 60% de sus
 * ventas (la plataforma se queda el 40%) en vez del 50%. Un trato activo
 * manda sobre esto, para poder mejorarlo con quien se negocie.
 */
export const FOUNDER_PLATFORM_PERCENT = 40;

export const DEAL_LIMITS = {
  platformMin: 5,
  platformMax: 60,
  ambassadorMin: 1,
  ambassadorMax: 20,
} as const;

export interface DealFields {
  dealPlatformPercent: number | null;
  dealAmbassadorPercent: number | null;
  dealUntil: Date | null;
  /** Numero de Fundador: si lo tiene, su % base es el de fundadores. */
  founderNumber?: number | null;
}

export function isDealActive(p: DealFields, now = new Date()) {
  const hasTerms = p.dealPlatformPercent != null || p.dealAmbassadorPercent != null;
  return hasTerms && (p.dealUntil == null || p.dealUntil > now);
}

/** % base de la plataforma: el de fundadores si lo es, si no el estandar. */
export function basePlatformPercent(p: Pick<DealFields, 'founderNumber'> | null | undefined) {
  const standard = config.economy.platformCommissionPercent;
  return p?.founderNumber != null ? Math.min(FOUNDER_PLATFORM_PERCENT, standard) : standard;
}

/** Los % que se le aplican HOY a una creadora (su trato, fundadora o el estandar). */
export function effectiveTerms(p: DealFields | null | undefined, now = new Date()) {
  const active = p ? isDealActive(p, now) : false;
  return {
    active,
    platformPercent:
      active && p!.dealPlatformPercent != null ? p!.dealPlatformPercent : basePlatformPercent(p),
    ambassadorPercent:
      active && p!.dealAmbassadorPercent != null ? p!.dealAmbassadorPercent : STANDARD_AMBASSADOR_PERCENT,
    until: active ? (p!.dealUntil ?? null) : null,
  };
}

export const DEAL_SELECT = {
  founderNumber: true,
  dealPlatformPercent: true,
  dealAmbassadorPercent: true,
  dealUntil: true,
} as const;
