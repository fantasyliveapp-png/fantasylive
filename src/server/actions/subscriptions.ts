'use server';

import { revalidatePath } from 'next/cache';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { InsufficientTokensError, transferWithCommission } from '@/lib/tokens';
import { getActiveSubscription, subscriptionPeriodEnd } from '@/lib/subscriptions';

export interface SubscriptionActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  active?: boolean;
}

/** Suscribe al usuario a una modelo, cobrando el precio mensual vigente. */
export async function subscribeAction(
  modelId: string,
  slug: string,
): Promise<SubscriptionActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const model = await prisma.modelProfile.findUnique({
      where: { id: modelId },
      select: {
        userId: true,
        subscriptionEnabled: true,
        subscriptionPriceTokens: true,
        subscriptionDiscountPercent: true,
      },
    });
    if (!model) return { ok: false, error: 'Modelo no encontrada.' };
    if (model.userId === user.id) {
      return { ok: false, error: 'No podes suscribirte a vos misma.' };
    }
    if (!model.subscriptionEnabled || model.subscriptionPriceTokens <= 0) {
      return { ok: false, error: 'Esta modelo no tiene suscripcion activada.' };
    }

    const already = await getActiveSubscription(user.id, modelId);
    if (already) {
      return { ok: true, active: true, message: 'Ya estas suscrito.' };
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.subscription.findUnique({
        where: { userId_modelId: { userId: user.id, modelId } },
        select: { id: true },
      });

      const periodEnd = subscriptionPeriodEnd();

      const subscription = existing
        ? await tx.subscription.update({
            where: { id: existing.id },
            data: {
              status: 'ACTIVE',
              priceTokens: model.subscriptionPriceTokens,
              discountPercent: model.subscriptionDiscountPercent,
              startedAt: new Date(),
              currentPeriodEnd: periodEnd,
              cancelledAt: null,
            },
            select: { id: true },
          })
        : await tx.subscription.create({
            data: {
              userId: user.id,
              modelId,
              priceTokens: model.subscriptionPriceTokens,
              discountPercent: model.subscriptionDiscountPercent,
              currentPeriodEnd: periodEnd,
            },
            select: { id: true },
          });

      await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: model.userId,
        tokens: model.subscriptionPriceTokens,
        debitType: 'SUBSCRIPTION_PURCHASE',
        creditType: 'SUBSCRIPTION_EARNING',
        description: 'Suscripcion mensual',
        subscriptionId: subscription.id,
      });

      await tx.modelProfile.update({
        where: { id: modelId },
        data: { subscribersCount: { increment: 1 } },
      });

      await createNotification(tx, {
        userId: model.userId,
        type: 'NEW_SUBSCRIBER',
        title: `${user.name ?? 'Alguien'} se suscribio por ${model.subscriptionPriceTokens} tokens/mes`,
        link: '/dashboard/model',
      });
    });

    revalidatePath(`/models/${slug}`);
    revalidatePath('/wallet');
    return {
      ok: true,
      active: true,
      message: `Suscripcion activada por ${model.subscriptionPriceTokens} tokens/mes.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Cancela la suscripcion de inmediato (no hay reembolso ni periodo de gracia). */
export async function cancelSubscriptionAction(
  modelId: string,
  slug: string,
): Promise<SubscriptionActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const sub = await getActiveSubscription(user.id, modelId);
    if (!sub) return { ok: true, active: false, message: 'No estabas suscrito.' };

    await prisma.$transaction([
      prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      }),
      prisma.modelProfile.update({
        where: { id: modelId },
        data: { subscribersCount: { decrement: 1 } },
      }),
    ]);

    revalidatePath(`/models/${slug}`);
    return { ok: true, active: false, message: 'Suscripcion cancelada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof InsufficientTokensError) return error.message;
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion para suscribirte.';
    return error.message;
  }
  return 'No se pudo actualizar. Intenta de nuevo.';
}
