import { prisma } from '@/lib/prisma';

const SUBSCRIPTION_PERIOD_DAYS = 30;

export function subscriptionPeriodEnd(from: Date = new Date()): Date {
  const end = new Date(from);
  end.setDate(end.getDate() + SUBSCRIPTION_PERIOD_DAYS);
  return end;
}

/**
 * Suscripcion activa de un usuario a una modelo, o null.
 * No hay renovacion automatica: al pasar `currentPeriodEnd` deja de contar
 * como activa aunque el registro siga en estado ACTIVE en la base.
 */
export async function getActiveSubscription(userId: string, modelId: string) {
  const sub = await prisma.subscription.findUnique({
    where: { userId_modelId: { userId, modelId } },
  });
  if (!sub || sub.status !== 'ACTIVE' || sub.currentPeriodEnd <= new Date()) {
    return null;
  }
  return sub;
}

/** Tarifa por minuto ya con el descuento de suscriptor aplicado (si corresponde). */
export function applySubscriberDiscount(
  ratePerMinute: number,
  discountPercent: number,
): number {
  if (discountPercent <= 0) return ratePerMinute;
  const discounted = ratePerMinute * (1 - discountPercent / 100);
  return Math.max(1, Math.round(discounted));
}
