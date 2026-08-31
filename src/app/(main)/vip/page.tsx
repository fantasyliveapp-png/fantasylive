import type { Metadata } from 'next';
import Link from 'next/link';
import { Crown } from 'lucide-react';

import { MatchmakingLobby } from '@/components/calls/matchmaking-lobby';
import { ModelCard } from '@/components/models/model-card';
import { Badge } from '@/components/ui/badge';
import { requireUser } from '@/lib/auth/guards';
import { getVisibilityContext } from '@/lib/geo';
import { getQueueStats } from '@/lib/matchmaking';
import { prisma } from '@/lib/prisma';
import { getWalletSummary } from '@/lib/tokens';

export const metadata: Metadata = { title: 'Sala VIP' };
export const dynamic = 'force-dynamic';

export default async function VipPage() {
  const user = await requireUser('/vip');

  // Bloqueo geografico: la sala VIP tampoco lista perfiles que bloquean
  // el pais desde el que se navega.
  const { filter: geoFilter } = await getVisibilityContext();

  const [stats, wallet, cheapest, availableModels] = await Promise.all([
    getQueueStats(),
    getWalletSummary(user.id),
    prisma.modelProfile.findFirst({
      where: {
        isVipEnabled: true,
        isAvailableForVip: true,
        isOnline: true,
        ...geoFilter,
      },
      orderBy: { vipRatePerMinute: 'asc' },
      select: { vipRatePerMinute: true },
    }),
    prisma.modelProfile.findMany({
      where: {
        isVipEnabled: true,
        isAvailableForVip: true,
        isOnline: true,
        kycStatus: 'APPROVED',
        ...geoFilter,
      },
      orderBy: { ratingAvg: 'desc' },
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
        isVipEnabled: true,
        isAvailableForVip: true,
        vipRatePerMinute: true,
        privateRatePerMinute: true,
        ratingAvg: true,
        ratingCount: true,
        tags: true,
      },
    }),
  ]);

  return (
    <div className="container py-12">
      <MatchmakingLobby
        mode="VIP"
        balance={wallet.balance}
        minRate={cheapest?.vipRatePerMinute ?? 20}
        stats={{
          waiting: stats.waitingVip,
          onlineModels: stats.onlineModels,
          vipModels: stats.vipModels,
        }}
      />

      {availableModels.length > 0 && (
        <section className="mt-16">
          <div className="mb-6 flex items-center gap-3">
            <Badge variant="vip" className="gap-1">
              <Crown className="h-3 w-3" />
              Disponibles ahora
            </Badge>
            <p className="text-sm text-muted-foreground">
              Estas modelos VIP estan en linea. Puedes esperar al azar o entrar
              directamente en su perfil.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {availableModels.map((model) => (
              <ModelCard key={model.id} model={model} />
            ))}
          </div>
        </section>
      )}

      {availableModels.length === 0 && (
        <div className="mt-12 rounded-xl border border-dashed border-border p-10 text-center">
          <Crown className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No hay modelos VIP en linea</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Puedes quedarte en la cola o{' '}
            <Link href="/models" className="text-primary hover:underline">
              reservar un privado
            </Link>{' '}
            para mas tarde.
          </p>
        </div>
      )}
    </div>
  );
}
