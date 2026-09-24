import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Radio } from 'lucide-react';

import { LiveViewer } from '@/components/live/live-viewer';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth/guards';
import { getViewerCountry, isCountryBlocked } from '@/lib/geo';
import { getI18n } from '@/lib/i18n/server';
import { prisma } from '@/lib/prisma';
import { getWalletSummary } from '@/lib/tokens';
import { initials } from '@/lib/utils';

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
    // Hace falta cuenta (regalos, visita registrada). En vez de mandarle al
    // login sin mas, se le explica y se le invita a unirse gratis.
    const back = encodeURIComponent(`/live/${slug}`);
    return (
      <div className="container flex max-w-md flex-col items-center py-16 text-center">
        <span className="rounded-full bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold p-[3px]">
          <Avatar className="h-24 w-24 border-4 border-background">
            {model.avatarUrl && <AvatarImage src={model.avatarUrl} alt="" />}
            <AvatarFallback>{initials(model.stageName)}</AvatarFallback>
          </Avatar>
        </span>
        <span className="mt-4 flex items-center gap-1.5 rounded-md bg-rose-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
          <Radio className="h-3.5 w-3.5" /> En directo
        </span>
        <h1 className="mt-3 font-heading text-3xl uppercase tracking-wide">
          {model.stageName} esta en directo
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Unete gratis para verlo. Es anonimo: solo se ve tu alias.
        </p>
        <div className="mt-6 w-full space-y-2">
          <Link href={`/register?next=${back}`} className="block">
            <Button variant="brand" size="lg" className="h-12 w-full">
              Crear cuenta gratis
            </Button>
          </Link>
          <Link href={`/login?callbackUrl=${back}`} className="block">
            <Button variant="outline" size="lg" className="h-12 w-full">
              Ya tengo cuenta
            </Button>
          </Link>
        </div>
      </div>
    );
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
