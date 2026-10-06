import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Radio } from 'lucide-react';

import { LiveViewer } from '@/components/live/live-viewer';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth/guards';
import { getViewerCountry, getVisibilityContext, isCountryBlocked } from '@/lib/geo';
import { getI18n } from '@/lib/i18n/server';
import { rankLiveStreams } from '@/lib/live-rank';
import { prisma } from '@/lib/prisma';
import { applySubscriberDiscount, getActiveSubscription } from '@/lib/subscriptions';
import { getWalletSummary } from '@/lib/tokens';
import { getActiveTokenPromo } from '@/lib/token-promos';
import { initials } from '@/lib/utils';
import { pageMeta } from '@/lib/seo';
import { config } from '@/lib/config';

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
  if (!model) return { title: 'Directo' };
  return pageMeta(
    `${model.stageName} en directo`,
    `${model.stageName} está en directo en ${config.app.name}. Entra a verlo, chatea en vivo y envía propinas.`,
  );
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
      gender: true,
      blockedCountries: true,
      coverUrl: true,
      headline: true,
      bio: true,
      country: true,
      followersCount: true,
      messagingEnabled: true,
      messagePriceTokens: true,
      privateRateCentitokens: true,
      minPrivateMinutes: true,
      streams: {
        where: { status: { in: ['PREPARING', 'LIVE'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          title: true,
          viewerCount: true,
          status: true,
          goalLabel: true,
          goalTokens: true,
          goalProgress: true,
        },
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

  const [wallet, follow, ranked, conversation, subscription, promo] = await Promise.all([
    getWalletSummary(viewer.id),
    prisma.follow.findUnique({
      where: { userId_modelId: { userId: viewer.id, modelId: model.id } },
      select: { id: true },
    }),
    // El "Para ti" de directos de este fan: el orden de deslizar.
    rankLiveStreams({
      viewerId: viewer.id,
      geoFilter: (await getVisibilityContext()).filter,
      take: 50,
    }),
    prisma.conversation.findUnique({
      where: { userId_modelId: { userId: viewer.id, modelId: model.id } },
      select: { id: true },
    }),
    getActiveSubscription(viewer.id, model.id),
    getActiveTokenPromo(),
  ]);
  const isOwn = viewer.id === model.userId;
  // Misma tarifa que en su perfil: con descuento si esta suscrito.
  const privateRate = subscription
    ? applySubscriberDiscount(model.privateRateCentitokens, subscription.discountPercent)
    : model.privateRateCentitokens;

  return (
    <div className="container max-w-6xl py-6">
      <LiveViewer
        key={stream.id}
        streamId={stream.id}
        feed={ranked.map((l) => l.model.slug)}
        initialGoal={
          stream.goalLabel && stream.goalTokens
            ? {
                label: stream.goalLabel,
                target: stream.goalTokens,
                progress: stream.goalProgress,
              }
            : null
        }
        streamTitle={stream.title}
        isFollowing={Boolean(follow) || viewer.id === model.userId}
        model={{
          id: model.id,
          slug: model.slug,
          stageName: model.stageName,
          avatarUrl: model.avatarUrl,
          userId: model.userId,
          isOnline: model.isOnline,
          gender: model.gender,
        }}
        creator={{
          coverUrl: model.coverUrl,
          headline: model.headline,
          bio: model.bio,
          followersCount: model.followersCount,
          country: model.country,
          messaging:
            model.messagingEnabled && !isOwn
              ? { priceTokens: model.messagePriceTokens, hasConversation: Boolean(conversation) }
              : null,
          call: isOwn ? null : { rateCentitokens: privateRate, minMinutes: model.minPrivateMinutes },
        }}
        promo={promo}
        balance={wallet.balance}
        viewerName={viewer.name ?? 'Invitado'}
        initialViewerCount={stream.viewerCount}
      />
    </div>
  );
}
