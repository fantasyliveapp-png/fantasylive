import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Radio } from 'lucide-react';

import { LiveViewer } from '@/components/live/live-viewer';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth/guards';
import { getViewerCountry, isCountryBlocked } from '@/lib/geo';
import { getI18n } from '@/lib/i18n/server';
import { prisma } from '@/lib/prisma';
import { getWalletSummary } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const model = await prisma.modelProfile.findUnique({
    where: { slug },
    select: { stageName: true },
  });
  return { title: model ? `${model.stageName} en directo` : 'Directo' };
}

export default async function LiveStreamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { t } = await getI18n();

  const model = await prisma.modelProfile.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      stageName: true,
      avatarUrl: true,
      userId: true,
      isOnline: true,
      blockedCountries: true,
      streams: {
        where: { status: { in: ['PREPARING', 'LIVE'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, title: true, viewerCount: true, status: true },
      },
    },
  });

  if (!model) notFound();

  // El bloqueo geografico se comprueba tambien aqui: entrar por la URL
  // directa del directo no puede ser una via para saltarselo.
  if (isCountryBlocked(model.blockedCountries, await getViewerCountry())) {
    redirect('/403');
  }

  const stream = model.streams[0];
  if (!stream) {
    return (
      <div className="container max-w-2xl py-20 text-center">
        <Radio className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="mt-4 text-2xl font-bold">{model.stageName}</h1>
        <p className="mt-2 text-muted-foreground">{t('live.notLive')}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={`/models/${model.slug}`}>
            <Button variant="brand">Ver su perfil</Button>
          </Link>
          <Link href="/live">
            <Button variant="outline">{t('live.title')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  const viewer = await getCurrentUser();
  if (!viewer) {
    // Hace falta cuenta para poder cobrar regalos y registrar la visita.
    redirect(`/login?callbackUrl=/live/${slug}`);
  }

  const wallet = await getWalletSummary(viewer.id);

  return (
    <div className="container max-w-6xl py-6">
      <LiveViewer
        streamId={stream.id}
        model={{
          slug: model.slug,
          stageName: model.stageName,
          avatarUrl: model.avatarUrl,
          userId: model.userId,
          isOnline: model.isOnline,
        }}
        balance={wallet.balance}
        viewerName={viewer.name ?? 'Invitado'}
        initialViewerCount={stream.viewerCount}
      />
    </div>
  );
}
