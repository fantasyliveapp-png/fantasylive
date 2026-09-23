import type { Metadata } from 'next';

import { ContentManager } from '@/components/model/content-manager';
import { requireModel } from '@/lib/auth/guards';
import { isStorageConfigured, resolveAssetUrl } from '@/lib/storage';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Mi contenido' };
export const dynamic = 'force-dynamic';

export default async function ModelContentPage() {
  const { profile } = await requireModel();

  const packages = await prisma.contentPackage.findMany({
    where: { modelId: profile.id },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { assets: true, unlocks: true } },
      // Primer archivo subido: sirve de miniatura real en el panel, sin
      // depender de que la modelo haya pegado una URL a mano.
      assets: {
        orderBy: { sortOrder: 'asc' },
        take: 1,
        select: { storageKey: true, mimeType: true },
      },
    },
  });

  const thumbnails = await Promise.all(
    packages.map(async (p) => {
      const first = p.assets[0];
      if (!first || !first.mimeType.startsWith('image/')) return null;
      return resolveAssetUrl(first.storageKey, { isPublic: false });
    }),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Contenido</h1>
        <p className="mt-2 text-muted-foreground">
          Sube fotos y videos, ponles precio en tokens y controla su
          visibilidad.
        </p>
      </div>

      <ContentManager
        storageReady={isStorageConfigured()}
        subscriptionEnabled={profile.subscriptionEnabled}
        packages={packages.map((p, i) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          type: p.type,
          priceTokens: p.priceTokens,
          isPublished: p.isPublished,
          subscriberOnly: p.subscriberOnly,
          previewUrl: p.previewUrl,
          thumbnailUrl: thumbnails[i],
          assetCount: p._count.assets,
          unlockCount: p._count.unlocks,
          tokensEarned: p.tokensEarned,
        }))}
      />
    </div>
  );
}
