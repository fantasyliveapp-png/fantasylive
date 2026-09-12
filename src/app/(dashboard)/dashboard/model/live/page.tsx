import type { Metadata } from 'next';

import { BroadcastPanel } from '@/components/live/broadcast-panel';
import { requireModel } from '@/lib/auth/guards';
import { getActiveStreamForModel, isObsConfigured } from '@/lib/live';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Directos' };
export const dynamic = 'force-dynamic';

export default async function ModelLivePage() {
  const { profile } = await requireModel();

  const [existing, totals] = await Promise.all([
    getActiveStreamForModel(profile.id),
    prisma.liveStream.aggregate({
      where: { modelId: profile.id },
      _sum: { giftsCount: true, tokensEarned: true },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Directos</h1>
        <p className="mt-2 text-muted-foreground">
          Emite desde el navegador o desde OBS. Mientras estes en directo
          apareces en la portada y tus seguidores reciben un aviso.
        </p>
      </div>

      <BroadcastPanel
        kycApproved={profile.kycStatus === 'APPROVED'}
        obsConfigured={isObsConfigured()}
        slug={profile.slug}
        stageName={profile.stageName}
        existing={
          existing
            ? {
                streamId: existing.id,
                source: existing.source,
                rtmpUrl: existing.rtmpUrl,
                streamKey: existing.streamKey,
                status: existing.status,
              }
            : null
        }
        totals={{
          giftsCount: totals._sum.giftsCount ?? 0,
          tokensEarned: totals._sum.tokensEarned ?? 0,
        }}
      />
    </div>
  );
}
