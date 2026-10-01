import 'server-only';

import { prisma } from '@/lib/prisma';
import type { SubscriptionRow } from '@/components/subscriptions/subscriptions-manager';

/**
 * Suscripciones de un fan (activas y pasadas), con lo que necesita para
 * decidir: cuanto le queda, cuanto contenido exclusivo tiene la creadora y a
 * que precio volveria a suscribirse hoy.
 */
export async function getMySubscriptions(userId: string): Promise<SubscriptionRow[]> {
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    orderBy: { currentPeriodEnd: 'desc' },
    include: {
      model: {
        select: {
          id: true,
          stageName: true,
          slug: true,
          avatarUrl: true,
          isOnline: true,
          gender: true,
          subscriptionEnabled: true,
          subscriptionPriceTokens: true,
        },
      },
    },
  });

  const exclusive = subscriptions.length
    ? await prisma.post.groupBy({
        by: ['modelId'],
        where: {
          modelId: { in: subscriptions.map((s) => s.modelId) },
          visibility: 'SUBSCRIBERS',
          isPublished: true,
          removedAt: null,
          createdAt: { lte: new Date() },
        },
        _count: { _all: true },
      })
    : [];
  const exclusiveBy = new Map(exclusive.map((e) => [e.modelId, e._count._all]));

  const now = new Date();
  return subscriptions.map((s) => ({
    id: s.id,
    modelId: s.modelId,
    modelSlug: s.model.slug,
    modelStageName: s.model.stageName,
    modelAvatarUrl: s.model.avatarUrl,
    modelIsOnline: s.model.isOnline,
    modelGender: s.model.gender,
    priceTokens: s.priceTokens,
    discountPercent: s.discountPercent,
    startedAt: s.startedAt.toISOString(),
    currentPeriodEnd: s.currentPeriodEnd.toISOString(),
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    isActive: s.status === 'ACTIVE' && s.currentPeriodEnd > now,
    exclusivePosts: exclusiveBy.get(s.modelId) ?? 0,
    // Precio de hoy para volver (null si ya no ofrece suscripcion).
    renewPriceTokens: s.model.subscriptionEnabled ? s.model.subscriptionPriceTokens : null,
  }));
}
