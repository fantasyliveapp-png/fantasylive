import type { Metadata } from 'next';
import { discountTokens } from '@/lib/creator-offer-rules';
import { applyRateOffer, getProfileOffers } from '@/lib/creator-offers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  BadgeCheck,
  Bot,
  Clock,
  Coins,
  Crown,
  Globe,
  Grid3x3,
  Gift,
  Image as ImageIcon,
  Info,
  LayoutDashboard,
  Lock,
  Pencil,
  Plus,
  Radio,
  Settings,
  ShoppingBag,
  Star,
  Users,
  Video,
} from 'lucide-react';

import { BookingWidget } from '@/components/bookings/booking-widget';
import { RequestContentDialog } from '@/components/content/request-content-dialog';
import { FollowButton } from '@/components/models/follow-button';
import { MessageButton } from '@/components/messages/message-button';
import { SafetyMenu } from '@/components/social/safety-menu';
import { SendMessageButton } from '@/components/social/send-message-button';
import { ReviewForm } from '@/components/models/review-form';
import { ShareProfileButton } from '@/components/models/share-profile-button';
import { StartPrivateCallButton } from '@/components/calls/start-private-call-button';
import { ProfileEditorButton } from '@/components/model/profile-editor';
import { OwnAccountMenu } from '@/components/layout/own-account-menu';
import { ExpandableText } from '@/components/models/expandable-text';
import { ProfilePostGrid } from '@/components/models/profile-post-grid';
import { PurchasesFeed } from '@/components/content/purchases-feed';
import { SubscriptionsTab } from '@/components/subscriptions/subscriptions-tab';
import { getMySubscriptions } from '@/lib/my-subscriptions';
import { getPurchases } from '@/lib/purchases';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SubscribeButton } from '@/components/models/subscribe-button';
import { getCurrentUser } from '@/lib/auth/guards';
import { getViewerCountry, isBlockedForViewer } from '@/lib/geo';
import { maybeSendAutoGreeting } from '@/lib/greeting';
import { getModelPosts } from '@/lib/posts';
import { recordProfileVisit } from '@/lib/visits';
import { formatRateNumber } from '@/lib/rates';
import { GENDER_LABELS, ORIENTATION_LABELS } from '@/lib/constants';
import { canCallNow } from '@/lib/call-presence';
import { peerPair } from '@/lib/chat';
import { founderLabel } from '@/lib/gender-words';
import { prisma } from '@/lib/prisma';
import { applySubscriberDiscount, getActiveSubscription } from '@/lib/subscriptions';
import { cn, formatDate, formatTokens, initials, relativeTime } from '@/lib/utils';
import { creatorDescription, creatorShareImage, pageMeta } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const model = await prisma.modelProfile.findUnique({
    where: { slug },
    select: { stageName: true, headline: true },
  });
  if (!model) return { title: 'Creador' };
  return pageMeta(
    model.stageName,
    creatorDescription(model.stageName, model.headline),
    creatorShareImage(slug, model.stageName),
  );
}

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

function minutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export default async function ModelProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ editar?: string; post?: string; tab?: string; de?: string }>;
}) {
  const { slug } = await params;
  const { editar, post: openPostId, tab: tabParam, de } = await searchParams;
  const viewer = await getCurrentUser();

  const model = await prisma.modelProfile.findUnique({
    where: { slug },
    include: {
      user: { select: { id: true, status: true, lastSeenAt: true, username: true } },
      availability: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!model) {
    // Un solo @ para todo: /models/<su @usuario> tambien lleva a su perfil.
    const byHandle = await prisma.user.findUnique({
      where: { username: decodeURIComponent(slug).toLowerCase() },
      select: { modelProfile: { select: { slug: true } } },
    });
    const target = byHandle?.modelProfile?.slug;
    if (target && target !== slug) redirect(`/models/${target}`);
    notFound();
  }
  if (model.user.status === 'BANNED') notFound();

  // Bloqueo geografico definido por la propia modelo. Ella misma y los admins
  // siguen viendo el perfil; para el resto se comporta como inexistente (404
  // en vez de 403, para no confirmar que la modelo existe).
  const isOwner = viewer?.id === model.userId;

  // Sin identidad verificada no hay perfil de creadora publico: solo lo ven
  // ella (para prepararlo) y el equipo. El resto ve su perfil de persona.
  if (model.kycStatus !== 'APPROVED' && !isOwner && viewer?.role !== 'ADMIN') {
    const person = await prisma.user.findUnique({
      where: { id: model.userId },
      select: { username: true },
    });
    if (person?.username) redirect(`/u/${person.username}`);
    notFound();
  }

  const viewerCountry = await getViewerCountry();
  if (!isOwner && viewer?.role !== 'ADMIN') {
    if (await isBlockedForViewer(model.blockedCountries)) notFound();
  }

  // Analiticas de la creadora y saludo automatico. Se hace DESPUES del
  // bloqueo geografico: una visita que no deberia ver el perfil tampoco debe
  // contar como visita ni recibir un mensaje.
  if (!isOwner) {
    await recordProfileVisit({
      modelId: model.id,
      modelUserId: model.userId,
      viewerId: viewer?.id ?? null,
      viewerCountry,
      source: 'PROFILE',
    });
    await maybeSendAutoGreeting({
      modelId: model.id,
      viewerId: viewer?.id ?? null,
      source: 'PROFILE',
    });
  }

  // Directo en curso: el perfil enlaza a la sala en vez de dejar al visitante
  // adivinar que la creadora esta emitiendo ahora mismo.
  const liveStream = await prisma.liveStream.findFirst({
    where: { modelId: model.id, status: 'LIVE' },
    select: { id: true, title: true, viewerCount: true },
  });

  // En llamada = tiene una videollamada activa ahora mismo. Es distinto de
  // "en directo" (emitiendo, isStreaming) y de "conectado" (sesion abierta).
  const activeCall = await prisma.callSession.findFirst({
    where: {
      status: 'ACTIVE',
      OR: [{ callerId: model.userId }, { calleeId: model.userId }],
    },
    select: { id: true },
  });
  const isLiveNow = Boolean(activeCall);
  // Se le puede llamar ya (fuera de directo con "Recibo llamadas", o en un
  // directo en el que acepta privados).
  const callable = await canCallNow(model);

  const isFollowing = viewer
    ? Boolean(
        await prisma.follow.findUnique({
          where: { userId_modelId: { userId: viewer.id, modelId: model.id } },
          select: { id: true },
        }),
      )
    : false;

  const activeSubscription = viewer
    ? await getActiveSubscription(viewer.id, model.id)
    : null;
  const isSubscribed = Boolean(activeSubscription);

  const hasConversation = viewer
    ? Boolean(
        await prisma.conversation.findUnique({
          where: { userId_modelId: { userId: viewer.id, modelId: model.id } },
          select: { id: true },
        }),
      )
    : false;

  // Ofertas del creador para quien mira (happy hour, primera llamada, cupon,
  // rebajas, primer mes). El propio creador las gestiona en Mi panel > Ofertas.
  const offers = isOwner
    ? { call: null, content: null, firstMonth: null }
    : await getProfileOffers({ id: model.id, userId: model.userId }, viewer?.id ?? null);

  const subscriberRate = activeSubscription
    ? applySubscriberDiscount(
        model.privateRateCentitokens,
        activeSubscription.discountPercent,
      )
    : model.privateRateCentitokens;
  // Igual que al cobrar: gana el descuento mayor.
  const offerRate = offers.call ? applyRateOffer(model.privateRateCentitokens, offers.call.percentOff) : Infinity;
  const callOffer = offers.call && offerRate < subscriberRate ? offers.call : null;
  const effectivePrivateRate = callOffer ? offerRate : subscriberRate;
  const firstMonthPrice = offers.firstMonth
    ? discountTokens(model.subscriptionPriceTokens, offers.firstMonth.percentOff)
    : null;
  const until = (iso: string | null) =>
    iso ? ` · hasta ${new Date(iso).toLocaleString('es', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : '';

  const feedPosts = await getModelPosts({
    modelId: model.id,
    viewerId: viewer?.id ?? null,
    take: 30,
    includeScheduled: isOwner,
  });

  const myReview = viewer
    ? await prisma.review.findUnique({
        where: { modelId_userId: { modelId: model.id, userId: viewer.id } },
        select: { rating: true, comment: true },
      })
    : null;

  // Nombres de quienes dejaron reseña
  const reviewers = await prisma.user.findMany({
    where: { id: { in: model.reviews.map((r) => r.userId) } },
    select: { id: true, name: true, image: true },
  });
  const reviewerMap = new Map(reviewers.map((r) => [r.id, r]));

  const isOwnProfile = viewer?.id === model.userId;

  // Creadora que visita a otra creadora: su chat entre creadoras, si existe.
  const creatorChat =
    viewer?.modelProfileId && !isOwnProfile
      ? await prisma.peerChat.findUnique({
          where: { userAId_userBId: peerPair(viewer.id, model.userId) },
          select: { id: true },
        })
      : null;
  const creatorChatHref = creatorChat ? `/mensajes/${creatorChat.id}` : null;

  const iBlockedModel =
    viewer && !isOwnProfile
      ? Boolean(
          await prisma.blockedPair.findFirst({
            where: { blockerId: viewer.id, blockedId: model.userId, isSkip: false },
            select: { id: true },
          }),
        )
      : false;

  // /models/<slug>?editar=1 abre directamente el editor (enlaces del menu).
  const editRequested = isOwnProfile && editar === '1';

  // Su lado de fan (compras, suscripciones, a quien sigue): solo lo ve el.
  const fanTab = isOwnProfile && (tabParam === 'compras' || tabParam === 'suscripciones') ? tabParam : null;
  const [ownPurchases, ownSubscriptions, ownFollowing] = isOwnProfile
    ? await Promise.all([
        getPurchases(model.userId),
        getMySubscriptions(model.userId),
        prisma.follow.count({ where: { userId: model.userId, model: { kycStatus: 'APPROVED' } } }),
      ])
    : [null, null, 0];
  // Fotos y videos publicados (como OnlyFans): se cuentan los archivos de sus
  // publicaciones visibles, incluidas las de pago. No entran las exclusivas de
  // directo ni las retiradas por moderacion.
  const visibleAsset = {
    post: { modelId: model.id, isPublished: true, removedAt: null, liveExclusiveAt: null },
  };
  const visiblePost = visibleAsset.post;
  const [postCount, photoCount, videoCount] = await Promise.all([
    // Contado en vivo: el contador guardado (postsCount) se desfasaba.
    prisma.post.count({ where: visiblePost }),
    prisma.postAsset.count({ where: { ...visibleAsset, mimeType: { startsWith: 'image/' } } }),
    prisma.postAsset.count({ where: { ...visibleAsset, mimeType: { startsWith: 'video/' } } }),
  ]);
  const isVerified = model.kycStatus === 'APPROVED';
  const isStreaming = Boolean(liveStream);

  const editableProfile = {
    slug: model.slug,
    stageName: model.stageName,
    headline: model.headline ?? '',
    bio: model.bio ?? '',
    languages: model.languages,
    tags: model.tags,
    avatarUrl: model.avatarUrl ?? '',
    coverUrl: model.coverUrl ?? '',
  };

  // Tarjeta de tarifas + videollamada. En movil va justo debajo de las
  // acciones (es lo que mas factura); en escritorio, en la columna lateral.
  const callCard = (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Video className="h-4 w-4 text-primary" />
              Privado 1 a 1
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Mínimo {model.minPrivateMinutes} min
              {model.isVipEnabled && <> · Sala VIP {formatRateNumber(model.vipRateCentitokens)}/min</>}
            </p>
          </div>
          <p className="flex shrink-0 items-center gap-1.5 font-semibold text-token">
            {effectivePrivateRate < model.privateRateCentitokens && (
              <span className="text-xs font-normal text-muted-foreground line-through">
                {formatRateNumber(model.privateRateCentitokens)}
              </span>
            )}
            <Coins className="h-4 w-4" />
            {formatRateNumber(effectivePrivateRate)}/min
          </p>
        </div>

        {callOffer && (
          <p className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-fantazy-red/20 to-champagne-gold/10 px-2.5 py-1.5 text-xs font-semibold text-champagne-gold">
            <Gift className="h-3.5 w-3.5" />
            {callOffer.label} −{callOffer.percentOff}%{until(callOffer.endsAt)}
          </p>
        )}

        {isOwnProfile ? (
          <Link href="/dashboard/model/rates" className="block">
            <Button variant="outline" size="sm" className="w-full">
              <Settings className="h-4 w-4" />
              Cambiar tarifas
            </Button>
          </Link>
        ) : (
          <StartPrivateCallButton
            slug={model.slug}
            stageName={model.stageName}
            isOnline={callable}
            canBook={model.acceptsBookings && isVerified}
            rateCentitokens={effectivePrivateRate}
            minMinutes={model.minPrivateMinutes}
            isAuthenticated={Boolean(viewer)}
            size="default"
            label="Llamar ahora"
            compact
          />
        )}
      </CardContent>
    </Card>
  );

  const bookingWidget =
    !isOwnProfile && model.acceptsBookings && isVerified ? (
      <BookingWidget
        slug={model.slug}
        stageName={model.stageName}
        rateCentitokens={effectivePrivateRate}
        minMinutes={model.minPrivateMinutes}
        isAuthenticated={Boolean(viewer)}
        availability={model.availability.map((a) => ({
          weekday: a.weekday,
          startMinute: a.startMinute,
          endMinute: a.endMinute,
        }))}
      />
    ) : null;

  const avatar = (
    <span
      className={cn(
        'relative block rounded-full p-[3px]',
        isStreaming || isLiveNow
          ? 'bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold'
          : callable
            ? 'bg-state-connected'
            : 'bg-border',
      )}
    >
      <Avatar className="h-28 w-28 border-4 border-background shadow-xl sm:h-32 sm:w-32">
        {model.avatarUrl && <AvatarImage src={model.avatarUrl} alt={model.stageName} />}
        <AvatarFallback className="text-3xl">{initials(model.stageName)}</AvatarFallback>
      </Avatar>
      {(isStreaming || isLiveNow) && (
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border-2 border-background bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
          {isStreaming ? 'En directo' : 'En llamada'}
        </span>
      )}
    </span>
  );

  return (
    <div>
      {/* Portada */}
      <div className="relative h-40 overflow-hidden bg-gradient-to-br from-primary/40 via-fantazy-red/15 to-champagne-gold/25 sm:h-56 md:h-72">
        {model.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={model.coverUrl} alt="" className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />

        <div className="absolute left-4 top-4 md:left-6 md:top-6">
          {isStreaming ? (
            <Badge variant="live" className="gap-1.5">
              <span className="live-dot !h-2 !w-2 bg-white" />
              EN DIRECTO
            </Badge>
          ) : isLiveNow ? (
            <Badge variant="live" className="gap-1.5">
              En llamada
            </Badge>
          ) : callable ? (
            <Badge variant="connected" className="gap-1.5">
              <span className="h-2 w-2 rounded-full bg-onix-black/60" />
              Disponible para llamar
            </Badge>
          ) : (
            <Badge variant="muted">
              {model.lastOnlineAt ? `Visto ${relativeTime(model.lastOnlineAt)}` : 'No disponible'}
            </Badge>
          )}
        </div>

        <div className="absolute right-3 top-3 flex gap-1 md:right-5 md:top-5">
          <div className="rounded-full bg-black/40 text-white backdrop-blur">
            <ShareProfileButton slug={model.slug} />
          </div>
          {isOwnProfile && (
            // Menu de tu cuenta: en el movil no esta arriba (tu foto va abajo).
            <div className="rounded-full bg-black/40 text-white backdrop-blur md:hidden">
              <OwnAccountMenu />
            </div>
          )}
          {!isOwnProfile && (
            <div className="rounded-full bg-black/40 text-white backdrop-blur">
              <SafetyMenu
                targetUserId={model.userId}
                targetName={model.stageName}
                initialBlocked={iBlockedModel}
                isAuthenticated={Boolean(viewer)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="container max-w-6xl -mt-16 pb-16">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* COLUMNA PRINCIPAL */}
          <div className="min-w-0">
            {/* Identidad: centrada en movil (TikTok), a la izquierda en escritorio */}
            <div className="flex flex-col items-center text-center sm:flex-row sm:items-end sm:gap-5 sm:text-left">
              {isStreaming ? (
                <Link href={`/live/${model.slug}`} aria-label="Ver directo">
                  {avatar}
                </Link>
              ) : (
                avatar
              )}

              <div className="mt-4 min-w-0 sm:mb-2 sm:mt-0">
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                    {model.stageName}
                  </h1>
                  {isVerified && <BadgeCheck className="h-6 w-6 text-primary" />}
                  {model.founderNumber != null && (
                    <Badge
                      variant="muted"
                      className="gap-1 border border-champagne-gold/40 bg-champagne-gold/15 text-champagne-gold"
                      title="De los 100 primeros creadores de Fantasy Live"
                    >
                      <Crown className="h-3 w-3" />
                      {founderLabel(model.gender)}
                    </Badge>
                  )}
                  {model.tier !== 'STANDARD' && (
                    <Badge variant="vip" className="gap-1">
                      <Crown className="h-3 w-3" />
                      {model.tier}
                    </Badge>
                  )}
                  {model.isAi && (
                    <Badge variant="muted" className="gap-1">
                      <Bot className="h-3 w-3" />
                      IA
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">@{model.slug}</p>
              </div>
            </div>

            {/* Estadisticas */}
            <div className="mt-5 flex items-center justify-center divide-x divide-border/60 sm:justify-start">
              <SocialStat value={formatTokens(postCount)} label="Publicaciones" />
              {/* Tus seguidores: solo tú abres la lista (Mis fans). */}
              <SocialStat
                value={formatTokens(model.followersCount)}
                label="Seguidores"
                href={isOwnProfile ? '/dashboard/model/fans' : undefined}
              />
              {/* A quien sigue (como fan): solo lo ve el. */}
              {isOwnProfile && model.user.username && (
                <SocialStat
                  value={formatTokens(ownFollowing)}
                  label="Siguiendo"
                  href={`/u/${model.user.username}/siguiendo`}
                />
              )}
              <SocialStat
                value={model.ratingCount > 0 ? model.ratingAvg.toFixed(1) : '-'}
                label={model.ratingCount > 0 ? `${model.ratingCount} reseñas` : 'Sin reseñas'}
                icon={<Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
              />
            </div>

            {/* Fotos y videos publicados */}
            {(photoCount > 0 || videoCount > 0) && (
              <div className="mt-3 flex items-center justify-center gap-4 text-sm text-muted-foreground sm:justify-start">
                <span className="flex items-center gap-1.5" title="Fotos publicadas">
                  <ImageIcon className="h-4 w-4" />
                  <span className="font-semibold text-foreground">{formatTokens(photoCount)}</span>
                  {photoCount === 1 ? 'foto' : 'fotos'}
                </span>
                <span className="flex items-center gap-1.5" title="Vídeos publicados">
                  <Video className="h-4 w-4" />
                  <span className="font-semibold text-foreground">{formatTokens(videoCount)}</span>
                  {videoCount === 1 ? 'vídeo' : 'vídeos'}
                </span>
              </div>
            )}

            {/* Titular + bio */}
            <div className="mx-auto mt-4 max-w-xl text-center text-sm sm:mx-0 sm:text-left">
              {model.headline && <p className="font-medium">{model.headline}</p>}
              {model.bio && <ExpandableText text={model.bio} className="mt-1 text-muted-foreground" />}
              {isOwnProfile && !model.bio && !model.headline && (
                <p className="text-muted-foreground">
                  Añade una bio para que tus fans sepan quien eres.
                </p>
              )}
            </div>

            {model.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                {model.tags.map((tag) => (
                  <Link key={tag} href={`/models?tag=${encodeURIComponent(tag)}`}>
                    <Badge variant="muted" className="capitalize hover:bg-muted/80">
                      #{tag}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}

            {/* Acciones */}
            {isOwnProfile ? (
              <div className="mt-5 grid grid-cols-2 gap-2 sm:max-w-md">
                <ProfileEditorButton
                  profile={editableProfile}
                  defaultOpen={editRequested}
                  variant="secondary"
                  size="default"
                  className="w-full"
                >
                  <Pencil className="h-4 w-4" />
                  Editar perfil
                </ProfileEditorButton>
                <Link href="/dashboard/model">
                  <Button variant="secondary" className="w-full">
                    <LayoutDashboard className="h-4 w-4" />
                    Mi panel
                  </Button>
                </Link>
                <Link href="/dashboard/model/posts?nuevo=1" className="col-span-2">
                  <Button variant="brand" className="w-full">
                    <Plus className="h-4 w-4" />
                    Nueva publicacion
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start [&_button]:h-10 [&_button]:px-5">
                <FollowButton
                  modelId={model.id}
                  slug={model.slug}
                  initialFollowing={isFollowing}
                  isAuthenticated={Boolean(viewer)}
                />
                {/* Otra creadora le escribe gratis (chat entre creadoras). */}
                {viewer?.modelProfileId ? (
                  <SendMessageButton
                    targetUserId={model.userId}
                    targetName={model.stageName}
                    existingHref={creatorChatHref}
                    isAuthenticated
                    className="h-10 gap-1.5 px-5"
                  />
                ) : model.messagingEnabled && (
                  <MessageButton
                    modelId={model.id}
                    slug={model.slug}
                    priceTokens={model.messagePriceTokens}
                    hasConversation={hasConversation}
                    isAuthenticated={Boolean(viewer)}
                  />
                )}
                <RequestContentDialog
                  modelId={model.id}
                  slug={model.slug}
                  isAuthenticated={Boolean(viewer)}
                />
              </div>
            )}

            {/*
              Directo en curso: el aviso va arriba del todo porque es la
              accion con mas valor en ese momento y desaparece al minuto.
            */}
            {liveStream && (
              <Link href={`/live/${model.slug}`} className="mt-5 block">
                <div className="flex items-center gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3">
                  <span className="live-dot" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {model.stageName} esta en directo ahora
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {liveStream.title || 'Entra al directo'} · {liveStream.viewerCount} viendo
                    </p>
                  </div>
                  <Button variant="brand" size="sm">
                    <Radio className="h-4 w-4" />
                    Ver directo
                  </Button>
                </div>
              </Link>
            )}

            {/*
              La mensajeria se cobra en tokens. Si contesta una IA hay que
              decirlo antes del pago, no despues: la etiqueta del titulo se
              puede pasar por alto, esta frase no.
            */}
            {model.isAi && (
              <p className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                <Bot className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Los mensajes de este perfil los responde un asistente de
                  inteligencia artificial, no una persona. No habra
                  videollamadas ni contenido propio.
                </span>
              </p>
            )}

            {/* Rebajas o cupon del creador en su contenido */}
            {offers.content && (
              <p className="mt-5 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-fantazy-red/25 via-champagne-gold/10 to-transparent px-4 py-3 text-sm ring-1 ring-champagne-gold/30">
                <Gift className="h-4 w-4 shrink-0 text-champagne-gold" />
                <span>
                  <strong>
                    {offers.content.label} −{offers.content.percentOff}%
                  </strong>{' '}
                  en {offers.content.kind === 'COUPON' ? 'lo próximo que desbloquees' : 'todo su contenido de pago'}
                  <span className="text-muted-foreground">{until(offers.content.endsAt)}</span>
                </span>
              </p>
            )}

            {/* Suscripcion, al estilo OnlyFans: precio y boton en una sola fila */}
            {model.subscriptionEnabled && model.subscriptionPriceTokens > 0 && (
              <div className="mt-5 rounded-2xl bg-gradient-to-r from-primary via-fantazy-red to-champagne-gold p-[1.5px]">
                <div className="flex items-center gap-3 rounded-[calc(1rem-1.5px)] bg-card p-3 pl-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      Suscripción
                      <span className="flex items-center gap-1 text-token">
                        <Coins className="h-3.5 w-3.5" />
                        {firstMonthPrice != null && (
                          <span className="text-xs font-normal text-muted-foreground line-through">
                            {formatTokens(model.subscriptionPriceTokens)}
                          </span>
                        )}
                        {formatTokens(firstMonthPrice ?? model.subscriptionPriceTokens)}/mes
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {offers.firstMonth ? (
                        <span className="font-semibold text-champagne-gold">
                          Primer mes −{offers.firstMonth.percentOff}%
                        </span>
                      ) : (
                        'Exclusivos'
                      )}
                      {model.subscriptionDiscountPercent > 0 &&
                        ` · -${model.subscriptionDiscountPercent}% en privados`}
                    </p>
                  </div>
                  {isOwnProfile ? (
                    <Link href="/dashboard/model/rates" className="shrink-0">
                      <Button variant="outline" size="sm">
                        <Settings className="h-4 w-4" />
                        Editar
                      </Button>
                    </Link>
                  ) : (
                    <SubscribeButton
                      modelId={model.id}
                      slug={model.slug}
                      priceTokens={firstMonthPrice ?? model.subscriptionPriceTokens}
                      initialSubscribed={isSubscribed}
                      isAuthenticated={Boolean(viewer)}
                      label="Suscribirme"
                      className="h-9 shrink-0 px-3 text-sm"
                    />
                  )}
                </div>
              </div>
            )}

            {/* En movil, tarifas y llamada antes del contenido */}
            <div className="mt-3 lg:hidden">{callCard}</div>

            {/* Contenido en pestanas, como Instagram/TikTok */}
            <Tabs defaultValue={fanTab ?? 'posts'} className="mt-8">
              <TabsList
                className={cn(
                  'sticky top-16 md:top-0 z-20 grid h-auto w-full rounded-none border-b border-border/60 bg-background/90 p-0 backdrop-blur',
                  isOwnProfile ? 'grid-cols-4' : 'grid-cols-2',
                )}
              >
                <ProfileTab value="posts" icon={<Grid3x3 className="h-4 w-4" />} label="Publicaciones" />
                {/* Su lado de fan: solo en su propio perfil. */}
                {isOwnProfile && (
                  <>
                    <ProfileTab value="compras" icon={<ShoppingBag className="h-4 w-4" />} label="Mis compras" />
                    <ProfileTab value="suscripciones" icon={<Crown className="h-4 w-4" />} label="Mis suscripciones" />
                  </>
                )}
                <ProfileTab value="about" icon={<Info className="h-4 w-4" />} label="Info" />
              </TabsList>

              {isOwnProfile && ownPurchases && ownSubscriptions && (
                <>
                  <TabsContent value="compras" className="mt-4 space-y-4">
                    <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" />
                      Solo tú ves lo que has comprado.
                    </p>
                    <PurchasesFeed items={ownPurchases} />
                  </TabsContent>
                  <TabsContent value="suscripciones" className="mt-4 space-y-4">
                    <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" />
                      Solo tú ves a quién estás suscrito.
                    </p>
                    <SubscriptionsTab
                      viewerId={model.userId}
                      baseHref={`/models/${model.slug}?tab=suscripciones`}
                      subscriptions={ownSubscriptions}
                      creatorSlug={de ?? null}
                    />
                  </TabsContent>
                </>
              )}

              <TabsContent value="posts" className="mt-4">
                <ProfilePostGrid
                  posts={feedPosts}
                  isAuthenticated={Boolean(viewer)}
                  isOwner={isOwnProfile}
                  stageName={model.stageName}
                  initialOpenId={openPostId}
                />
              </TabsContent>

              <TabsContent value="about" className="mt-4 space-y-5">
                <Card>
                  <CardContent className="pt-6">
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Sobre mi
                    </h2>
                    <p className="mt-2 whitespace-pre-line leading-relaxed text-muted-foreground">
                      {model.bio ?? 'Esta modelo aun no ha escrito su biografia.'}
                    </p>

                    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Users className="h-4 w-4" />
                        {GENDER_LABELS[model.gender]} &middot; {ORIENTATION_LABELS[model.orientation]}
                      </span>
                      {model.country && (
                        <span className="flex items-center gap-1.5">
                          <Globe className="h-4 w-4" />
                          {model.country}
                        </span>
                      )}
                    </div>

                    {model.languages.length > 0 && (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">Idiomas:</span>
                        {model.languages.map((lang) => (
                          <Badge key={lang} variant="outline">
                            {lang}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <Separator className="my-5" />
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <Stat label="Llamadas" value={formatTokens(model.totalCalls)} />
                      <Stat label="Minutos en vivo" value={formatTokens(model.totalMinutes)} />
                      <Stat label="Miembro desde" value={formatDate(model.createdAt)} />
                      <Stat
                        label="Valoracion"
                        value={model.ratingCount > 0 ? `${model.ratingAvg.toFixed(1)}/5` : '-'}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Horarios
                    </h2>
                    {model.availability.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Esta modelo aun no ha publicado sus horarios habituales.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {model.availability.map((slot) => (
                          <div
                            key={slot.id}
                            className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5"
                          >
                            <span className="font-medium">{WEEKDAYS[slot.weekday]}</span>
                            <span className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              {minutesToTime(slot.startMinute)} - {minutesToTime(slot.endMinute)} (
                              {slot.timezone})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {bookingWidget && <div id="reservar" className="scroll-mt-24 lg:hidden">{bookingWidget}</div>}

                <div className="space-y-5">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Reseñas ({model.ratingCount})
                  </h2>
                  {!isOwnProfile &&
                    (viewer ? (
                      <ReviewForm
                        modelId={model.id}
                        slug={model.slug}
                        initialRating={myReview?.rating}
                        initialComment={myReview?.comment}
                      />
                    ) : (
                      <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                        <a
                          href={`/login?callbackUrl=/models/${model.slug}`}
                          className="text-primary hover:underline"
                        >
                          Inicia sesion
                        </a>{' '}
                        para dejar una reseña.
                      </p>
                    ))}

                  <Card>
                    <CardContent className="space-y-5 pt-6">
                      {model.reviews.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Todavia no hay reseñas.</p>
                      ) : (
                        model.reviews.map((review) => {
                          const author = reviewerMap.get(review.userId);
                          return (
                            <div key={review.id} className="flex gap-3">
                              <Avatar className="h-9 w-9">
                                {author?.image && <AvatarImage src={author.image} alt="" />}
                                <AvatarFallback>{initials(author?.name)}</AvatarFallback>
                              </Avatar>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">
                                    {author?.name ?? 'Usuario'}
                                  </span>
                                  <div className="flex">
                                    {Array.from({ length: 5 }, (_, i) => (
                                      <Star
                                        key={i}
                                        className={`h-3 w-3 ${
                                          i < review.rating
                                            ? 'fill-amber-400 text-amber-400'
                                            : 'text-muted'
                                        }`}
                                      />
                                    ))}
                                  </div>
                                  <span className="text-xs text-muted-foreground">
                                    {relativeTime(review.createdAt)}
                                  </span>
                                </div>
                                {review.comment && (
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {review.comment}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* COLUMNA LATERAL (escritorio) */}
          <aside className="hidden space-y-5 lg:sticky lg:top-8 lg:mt-20 lg:block lg:self-start">
            {callCard}
            {bookingWidget}
          </aside>
        </div>
      </div>
    </div>
  );
}

function ProfileTab({
  value,
  icon,
  label,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      aria-label={label}
      className="flex items-center justify-center gap-1.5 rounded-none border-b-2 border-transparent py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </TabsTrigger>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Estadistica estilo perfil social (numero grande + etiqueta), para el header. */
function SocialStat({
  value,
  label,
  icon,
  href,
}: {
  value: string;
  label: string;
  icon?: React.ReactNode;
  href?: string;
}) {
  if (href) {
    return (
      <Link href={href} className="px-5 text-center hover:opacity-80 sm:first:pl-0">
        <p className="flex items-center justify-center gap-1 text-lg font-bold leading-none">
          {icon}
          {value}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline">{label}</p>
      </Link>
    );
  }
  return (
    <div className="px-5 text-center sm:first:pl-0">
      <p className="flex items-center justify-center gap-1 text-lg font-bold leading-none">
        {icon}
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
