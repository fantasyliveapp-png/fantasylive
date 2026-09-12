import type { Metadata } from 'next';
import Link from 'next/link';
import { Radio } from 'lucide-react';

import { FeedTabs } from '@/components/feed/feed-tabs';
import { LiveCard } from '@/components/live/live-card';
import { ModelCard } from '@/components/models/model-card';
import { Button } from '@/components/ui/button';
import { getVisibilityContext } from '@/lib/geo';
import { getI18n } from '@/lib/i18n/server';
import { getLiveStreams } from '@/lib/live';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Directos' };
export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const [{ t }, { filter: geoFilter }] = await Promise.all([
    getI18n(),
    getVisibilityContext(),
  ]);

  const [streams, onlineModels] = await Promise.all([
    getLiveStreams({ geoFilter, take: 24 }),
    // Quien esta conectada pero no emitiendo: si no hay directos, la pagina
    // sigue ofreciendo algo que hacer en vez de quedarse vacia.
    prisma.modelProfile.findMany({
      where: {
        isOnline: true,
        kycStatus: 'APPROVED',
        ...geoFilter,
      },
      orderBy: [{ ratingAvg: 'desc' }],
      take: 8,
      select: {
        id: true,
        slug: true,
        stageName: true,
        headline: true,
        gender: true,
        orientation: true,
        tier: true,
        country: true,
        avatarUrl: true,
        coverUrl: true,
        isOnline: true,
        isAi: true,
        isVipEnabled: true,
        isAvailableForVip: true,
        vipRateCentitokens: true,
        privateRateCentitokens: true,
        ratingAvg: true,
        ratingCount: true,
        tags: true,
      },
    }),
  ]);

  return (
    <div className="container max-w-6xl py-6">
      <FeedTabs />

      <div className="mb-6 flex items-center gap-3">
        <Radio className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">
          {t('live.liveNow')}
        </h1>
      </div>

      {streams.length === 0 ? (
        <p className="rounded-xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
          {t('home.liveNowEmpty')}
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {streams.map((stream) => (
            <LiveCard key={stream.id} stream={stream} />
          ))}
        </div>
      )}

      {onlineModels.length > 0 && (
        <section className="mt-12">
          <div className="mb-5 flex items-end justify-between gap-4">
            <h2 className="text-lg font-semibold">
              Creadores en linea ahora mismo
            </h2>
            <Link href="/models">
              <Button variant="outline" size="sm">
                {t('common.seeAll')}
              </Button>
            </Link>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {onlineModels.map((model) => (
              <ModelCard key={model.id} model={model} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
