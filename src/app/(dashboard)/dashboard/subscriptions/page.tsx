import type { Metadata } from 'next';

import { SubscriptionsManager } from '@/components/subscriptions/subscriptions-manager';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Mis suscripciones' };
export const dynamic = 'force-dynamic';

export default async function UserSubscriptionsPage() {
  const user = await requireUser('/dashboard/subscriptions');

  const subscriptions = await prisma.subscription.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      model: {
        select: {
          stageName: true,
          slug: true,
          avatarUrl: true,
          isOnline: true,
        },
      },
    },
  });

  const now = new Date();

  return (
    <div className="container py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Mis suscripciones</h1>
        <p className="mt-2 text-muted-foreground">
          Las creadoras a las que estas suscrito y tu historial de
          suscripciones.
        </p>
      </div>

      <SubscriptionsManager
        subscriptions={subscriptions.map((s) => ({
          id: s.id,
          modelId: s.modelId,
          modelSlug: s.model.slug,
          modelStageName: s.model.stageName,
          modelAvatarUrl: s.model.avatarUrl,
          modelIsOnline: s.model.isOnline,
          priceTokens: s.priceTokens,
          discountPercent: s.discountPercent,
          startedAt: s.startedAt.toISOString(),
          currentPeriodEnd: s.currentPeriodEnd.toISOString(),
          cancelledAt: s.cancelledAt?.toISOString() ?? null,
          isActive: s.status === 'ACTIVE' && s.currentPeriodEnd > now,
        }))}
      />
    </div>
  );
}
