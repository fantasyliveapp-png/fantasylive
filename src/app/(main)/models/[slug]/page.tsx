import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  BadgeCheck,
  Clock,
  Coins,
  Crown,
  Globe,
  MessageCircle,
  Star,
  Users,
  Video,
} from 'lucide-react';

import { BookingWidget } from '@/components/bookings/booking-widget';
import { ContentGallery } from '@/components/content/content-gallery';
import { RequestContentDialog } from '@/components/content/request-content-dialog';
import { FollowButton } from '@/components/models/follow-button';
import { MessageButton } from '@/components/messages/message-button';
import { ReviewForm } from '@/components/models/review-form';
import { ShareProfileButton } from '@/components/models/share-profile-button';
import { StartPrivateCallButton } from '@/components/calls/start-private-call-button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SubscribeButton } from '@/components/models/subscribe-button';
import { getCurrentUser } from '@/lib/auth/guards';
import { getViewerCountry, isCountryBlocked } from '@/lib/geo';
import { GENDER_LABELS, ORIENTATION_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { applySubscriberDiscount, getActiveSubscription } from '@/lib/subscriptions';
import { cn, formatDate, formatTokens, initials, relativeTime } from '@/lib/utils';

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
  return {
    title: model?.stageName ?? 'Modelo',
    description: model?.headline ?? undefined,
  };
}

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

function minutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export default async function ModelProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await getCurrentUser();

  const model = await prisma.modelProfile.findUnique({
    where: { slug },
    include: {
      user: { select: { id: true, status: true, lastSeenAt: true } },
      availability: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
      contentPackages: {
        where: { isPublished: true },
        orderBy: [{ priceTokens: 'asc' }, { createdAt: 'desc' }],
      },
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!model || model.user.status === 'BANNED') notFound();

  // Bloqueo geografico definido por la propia modelo. Ella misma y los admins
  // siguen viendo el perfil; para el resto se comporta como inexistente (404
  // en vez de 403, para no confirmar que la modelo existe).
  const isOwner = viewer?.id === model.userId;
  if (!isOwner && viewer?.role !== 'ADMIN') {
    const viewerCountry = await getViewerCountry();
    if (isCountryBlocked(model.blockedCountries, viewerCountry)) notFound();
  }

  // En vivo = tiene una llamada activa ahora mismo (distinto de "conectado",
  // que solo indica que la sesion esta abierta).
  const activeCall = await prisma.callSession.findFirst({
    where: {
      status: 'ACTIVE',
      OR: [{ callerId: model.userId }, { calleeId: model.userId }],
    },
    select: { id: true },
  });
  const isLiveNow = Boolean(activeCall);

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

  const effectivePrivateRate = activeSubscription
    ? applySubscriberDiscount(
        model.privateRatePerMinute,
        activeSubscription.discountPercent,
      )
    : model.privateRatePerMinute;

  // Paquetes ya desbloqueados por quien mira
  const unlockedIds = viewer
    ? (
        await prisma.contentUnlock.findMany({
          where: {
            userId: viewer.id,
            packageId: { in: model.contentPackages.map((p) => p.id) },
          },
          select: { packageId: true },
        })
      ).map((u) => u.packageId)
    : [];

  const myReview = viewer
    ? await prisma.review.findUnique({
        where: { modelId_userId: { modelId: model.id, userId: viewer.id } },
        select: { rating: true, comment: true },
      })
    : null;

  // Nombres de quienes dejaron resena
  const reviewers = await prisma.user.findMany({
    where: { id: { in: model.reviews.map((r) => r.userId) } },
    select: { id: true, name: true, image: true },
  });
  const reviewerMap = new Map(reviewers.map((r) => [r.id, r]));

  const isOwnProfile = viewer?.id === model.userId;
  const isVerified = model.kycStatus === 'APPROVED';

  return (
    <div>
      {/* Portada */}
      <div className="relative h-56 overflow-hidden bg-muted md:h-72">
        {model.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={model.coverUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />

        <div className="absolute left-4 top-4 md:left-6 md:top-6">
          {isLiveNow ? (
            <Badge variant="live" className="gap-1.5">
              <span className="live-dot !h-2 !w-2 bg-white" />
              EN VIVO
            </Badge>
          ) : model.isOnline ? (
            <Badge variant="connected" className="gap-1.5">
              <span className="h-2 w-2 rounded-full bg-onix-black/60" />
              Conectado
            </Badge>
          ) : (
            <Badge variant="muted">
              {model.lastOnlineAt
                ? `Visto ${relativeTime(model.lastOnlineAt)}`
                : 'Offline'}
            </Badge>
          )}
        </div>
      </div>

      <div className="container -mt-14 pb-16">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          {/* COLUMNA PRINCIPAL */}
          <div>
            <Avatar
              className={cn(
                'h-28 w-28 border-4 shadow-xl',
                isLiveNow
                  ? 'border-primary'
                  : model.isOnline
                    ? 'border-state-connected'
                    : 'border-background',
              )}
            >
              {model.avatarUrl && (
                <AvatarImage src={model.avatarUrl} alt={model.stageName} />
              )}
              <AvatarFallback className="text-2xl">
                {initials(model.stageName)}
              </AvatarFallback>
            </Avatar>

            {/* Debajo del avatar, siempre sobre fondo solido (nunca sobre la
                portada) para que el nombre y las estadisticas se lean bien
                sin importar cuan clara sea la foto de portada. */}
            <div className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-3xl font-bold tracking-tight">
                    {model.stageName}
                  </h1>
                  {isVerified && <BadgeCheck className="h-6 w-6 text-primary" />}
                  {model.tier !== 'STANDARD' && (
                    <Badge variant="vip" className="gap-1">
                      <Crown className="h-3 w-3" />
                      {model.tier}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {!isOwnProfile && (
                    <div className="text-right">
                      <p className="flex items-center gap-1 text-xl font-bold text-token">
                        <Coins className="h-4 w-4" />
                        {effectivePrivateRate}/min
                      </p>
                      <p className="text-xs text-muted-foreground">
                        tarifa privado ahora
                      </p>
                    </div>
                  )}
                  <ShareProfileButton slug={model.slug} />
                </div>
              </div>

              {model.headline && (
                <p className="mt-2 text-muted-foreground">{model.headline}</p>
              )}

              {!isOwnProfile && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <FollowButton
                    modelId={model.id}
                    slug={model.slug}
                    initialFollowing={isFollowing}
                    isAuthenticated={Boolean(viewer)}
                  />
                  {model.messagingEnabled && model.messagePriceTokens > 0 && (
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

              <div className="mt-4 flex flex-wrap items-center gap-6">
                <SocialStat
                  value={model.contentPackages.length}
                  label="Publicaciones"
                />
                <SocialStat value={model.followersCount} label="Seguidores" />
                <SocialStat value={model.totalCalls} label="Llamadas" />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  {GENDER_LABELS[model.gender]} &middot;{' '}
                  {ORIENTATION_LABELS[model.orientation]}
                </span>
                {model.country && (
                  <span className="flex items-center gap-1.5">
                    <Globe className="h-4 w-4" />
                    {model.country}
                  </span>
                )}
                {model.ratingCount > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    {model.ratingAvg.toFixed(1)} ({model.ratingCount})
                  </span>
                )}
              </div>

              {model.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {model.tags.map((tag) => (
                    <Badge key={tag} variant="muted" className="capitalize">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Feed: siempre visible, no escondido atras de una pestana */}
            <div className="mt-8">
              <h2 className="section-title text-xl">
                Publicaciones ({model.contentPackages.length})
              </h2>
              <div className="mt-4">
                <ContentGallery
                  packages={model.contentPackages.map((p) => ({
                    id: p.id,
                    title: p.title,
                    description: p.description,
                    type: p.type,
                    priceTokens: p.priceTokens,
                    previewUrl: p.previewUrl,
                    assetCount: p.assetCount,
                    purchaseCount: p.purchaseCount,
                    isUnlocked: unlockedIds.includes(p.id) || isOwnProfile,
                    subscriberOnly: p.subscriberOnly,
                  }))}
                  isAuthenticated={Boolean(viewer)}
                  isSubscribed={isSubscribed || isOwnProfile}
                />
              </div>
            </div>

            <Separator className="my-8" />

            <Tabs defaultValue="about">
              <TabsList>
                <TabsTrigger value="about">Sobre mi</TabsTrigger>
                <TabsTrigger value="schedule">Horarios</TabsTrigger>
                <TabsTrigger value="reviews">
                  Resenas ({model.ratingCount})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="about">
                <Card>
                  <CardContent className="pt-6">
                    <p className="whitespace-pre-line leading-relaxed text-muted-foreground">
                      {model.bio ??
                        'Esta modelo aun no ha escrito su biografia.'}
                    </p>

                    {model.languages.length > 0 && (
                      <>
                        <Separator className="my-5" />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">Idiomas:</span>
                          {model.languages.map((lang) => (
                            <Badge key={lang} variant="outline">
                              {lang}
                            </Badge>
                          ))}
                        </div>
                      </>
                    )}

                    <Separator className="my-5" />
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <Stat
                        label="Llamadas"
                        value={formatTokens(model.totalCalls)}
                      />
                      <Stat
                        label="Minutos en vivo"
                        value={formatTokens(model.totalMinutes)}
                      />
                      <Stat
                        label="Miembro desde"
                        value={formatDate(model.createdAt)}
                      />
                      <Stat
                        label="Valoracion"
                        value={
                          model.ratingCount > 0
                            ? `${model.ratingAvg.toFixed(1)}/5`
                            : '-'
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="schedule">
                <Card>
                  <CardContent className="pt-6">
                    {model.availability.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Esta modelo aun no ha publicado sus horarios habituales.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {model.availability.map((slot) => (
                          <div
                            key={slot.id}
                            className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5"
                          >
                            <span className="font-medium">
                              {WEEKDAYS[slot.weekday]}
                            </span>
                            <span className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              {minutesToTime(slot.startMinute)} -{' '}
                              {minutesToTime(slot.endMinute)} ({slot.timezone})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="reviews" className="space-y-5">
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
                      para dejar una resena.
                    </p>
                  ))}

                <Card>
                  <CardContent className="space-y-5 pt-6">
                    {model.reviews.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Todavia no hay resenas.
                      </p>
                    ) : (
                      model.reviews.map((review) => {
                        const author = reviewerMap.get(review.userId);
                        return (
                          <div key={review.id} className="flex gap-3">
                            <Avatar className="h-9 w-9">
                              {author?.image && (
                                <AvatarImage src={author.image} alt="" />
                              )}
                              <AvatarFallback>
                                {initials(author?.name)}
                              </AvatarFallback>
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
              </TabsContent>
            </Tabs>
          </div>

          {/* SIDEBAR */}
          <aside className="space-y-5 lg:mt-24">
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Tarifas
                  </p>
                  <div className="mt-3 space-y-2">
                    {model.isVipEnabled && (
                      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
                        <span className="flex items-center gap-2 text-sm">
                          <Crown className="h-4 w-4 text-primary" />
                          Sala VIP
                        </span>
                        <span className="flex items-center gap-1 font-semibold text-token">
                          <Coins className="h-4 w-4" />
                          {model.vipRatePerMinute}/min
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
                      <span className="flex items-center gap-2 text-sm">
                        <Video className="h-4 w-4 text-primary" />
                        Privado 1 a 1
                      </span>
                      <span className="flex items-center gap-1.5 font-semibold text-token">
                        {activeSubscription && (
                          <span className="text-xs font-normal text-muted-foreground line-through">
                            {model.privateRatePerMinute}
                          </span>
                        )}
                        <Coins className="h-4 w-4" />
                        {effectivePrivateRate}/min
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Minimo {model.minPrivateMinutes} min en privados reservados.
                  </p>
                </div>

                {model.subscriptionEnabled && model.subscriptionPriceTokens > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Suscripcion mensual
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Contenido exclusivo + {model.subscriptionDiscountPercent}%
                        de descuento en llamadas privadas.
                      </p>
                      {!isOwnProfile && (
                        <SubscribeButton
                          modelId={model.id}
                          slug={model.slug}
                          priceTokens={model.subscriptionPriceTokens}
                          initialSubscribed={isSubscribed}
                          isAuthenticated={Boolean(viewer)}
                          className="mt-3 w-full"
                        />
                      )}
                    </div>
                  </>
                )}

                <Separator />

                {isOwnProfile ? (
                  <p className="text-center text-sm text-muted-foreground">
                    Este es tu perfil publico.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <StartPrivateCallButton
                      slug={model.slug}
                      stageName={model.stageName}
                      isOnline={model.isOnline}
                      ratePerMinute={effectivePrivateRate}
                      minMinutes={model.minPrivateMinutes}
                      isAuthenticated={Boolean(viewer)}
                    />
                    <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                      <MessageCircle className="h-3.5 w-3.5" />
                      El cobro se detiene en cuanto cuelgas
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {!isOwnProfile && model.acceptsBookings && isVerified && (
              <BookingWidget
                slug={model.slug}
                stageName={model.stageName}
                ratePerMinute={effectivePrivateRate}
                minMinutes={model.minPrivateMinutes}
                isAuthenticated={Boolean(viewer)}
                availability={model.availability.map((a) => ({
                  weekday: a.weekday,
                  startMinute: a.startMinute,
                  endMinute: a.endMinute,
                }))}
              />
            )}
          </aside>
        </div>
      </div>
    </div>
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
function SocialStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center sm:text-left">
      <p className="text-xl font-bold leading-none">{formatTokens(value)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
