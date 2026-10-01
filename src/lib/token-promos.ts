import { prisma } from '@/lib/prisma';

/**
 * PROMOCIONES DE TOKENS
 *
 * El equipo lanza desde admin un % de descuento en todos los paquetes durante
 * unas fechas. El precio rebajado se calcula SIEMPRE aqui, en el servidor, y
 * es el que se cobra en cualquier pasarela: el navegador solo lo enseña.
 */

export interface ActivePromo {
  id: string;
  title: string;
  percentOff: number;
  endsAt: string;
}

export const PROMO_LIMITS = { min: 5, max: 80 } as const;

/** La promocion en curso (si hay varias a la vez, la mayor). */
export async function getActiveTokenPromo(now = new Date()): Promise<ActivePromo | null> {
  const promo = await prisma.tokenPromo.findFirst({
    where: { active: true, startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { percentOff: 'desc' },
    select: { id: true, title: true, percentOff: true, endsAt: true },
  });
  return promo ? { ...promo, endsAt: promo.endsAt.toISOString() } : null;
}

/** Precio con la promocion aplicada (nunca menos de 0,50). */
export function promoPriceCents(priceCents: number, percentOff: number | null | undefined) {
  if (!percentOff) return priceCents;
  return Math.max(50, Math.round((priceCents * (100 - percentOff)) / 100));
}
