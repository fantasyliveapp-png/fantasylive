import type { Metadata } from 'next';

import { CreatorOffersPanel, type OfferRow } from '@/components/model/creator-offers-panel';
import { requireModel } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { effectiveTerms } from '@/lib/deals';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Ofertas' };
export const dynamic = 'force-dynamic';

/**
 * OFERTAS DEL CREADOR: happy hour, rebajas, primer mes, primera llamada y
 * cupones. Todo en una pantalla, con lo que gana en $ antes de activarlo.
 */
export default async function CreatorOffersPage() {
  const { profile } = await requireModel();
  const now = new Date();

  const [offers, coupons, typicalPost] = await Promise.all([
    prisma.creatorOffer.findMany({
      where: {
        modelId: profile.id,
        kind: { not: 'COUPON' },
        active: true,
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.creatorOffer.findMany({
      where: { modelId: profile.id, kind: 'COUPON' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { fan: { select: { name: true, username: true } } },
    }),
    // Precio tipico de su contenido, para el ejemplo de las rebajas.
    prisma.post.aggregate({
      where: { modelId: profile.id, visibility: 'LOCKED', priceTokens: { gt: 0 }, removedAt: null },
      _avg: { priceTokens: true },
    }),
  ]);

  const row = (o: (typeof offers)[number]): OfferRow => ({
    id: o.id,
    kind: o.kind,
    percentOff: o.percentOff,
    endsAt: o.endsAt?.toISOString() ?? null,
    uses: o.uses,
    tokensPaid: o.tokensPaid,
  });

  return (
    <CreatorOffersPanel
      economy={{
        platformCommissionPercent: effectiveTerms(profile).platformPercent,
        payoutCentsPerToken: config.economy.modelPayoutCentsPerToken,
        payoutFeePercent: config.economy.payoutFeePercent,
      }}
      privateRateCentitokens={profile.privateRateCentitokens}
      subscription={
        profile.subscriptionEnabled && profile.subscriptionPriceTokens > 0 ? profile.subscriptionPriceTokens : null
      }
      typicalContentTokens={Math.round(typicalPost._avg.priceTokens ?? 50)}
      active={{
        HAPPY_HOUR: offers.find((o) => o.kind === 'HAPPY_HOUR') ? row(offers.find((o) => o.kind === 'HAPPY_HOUR')!) : null,
        FLASH_SALE: offers.find((o) => o.kind === 'FLASH_SALE') ? row(offers.find((o) => o.kind === 'FLASH_SALE')!) : null,
        FIRST_MONTH: offers.find((o) => o.kind === 'FIRST_MONTH') ? row(offers.find((o) => o.kind === 'FIRST_MONTH')!) : null,
        FIRST_CALL: offers.find((o) => o.kind === 'FIRST_CALL') ? row(offers.find((o) => o.kind === 'FIRST_CALL')!) : null,
      }}
      coupons={coupons.map((c) => ({
        id: c.id,
        fanName: c.fan?.name ?? c.fan?.username ?? 'Fan',
        target: c.target ?? 'CONTENT',
        percentOff: c.percentOff,
        status: c.usedAt ? 'used' : c.active && c.endsAt && c.endsAt > now ? 'live' : 'expired',
      }))}
    />
  );
}
