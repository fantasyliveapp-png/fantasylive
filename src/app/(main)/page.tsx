import Link from 'next/link';
import {
  ArrowRight,
  Coins,
  Compass,
  Crown,
  Lock,
  Radio,
  Shuffle,
  Sparkles,
  Users,
  Video,
} from 'lucide-react';

import { LiveCard } from '@/components/live/live-card';
import { ModelCard } from '@/components/models/model-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getVisibilityContext } from '@/lib/geo';
import { getI18n } from '@/lib/i18n/server';
import { getLiveStreams } from '@/lib/live';
import { getQueueStats } from '@/lib/matchmaking';
import { prisma } from '@/lib/prisma';
import { formatTokens } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Los perfiles que bloquean el pais del visitante no salen ni en destacados
  // ni en los directos de portada.
  const [{ t }, { filter: geoFilter }] = await Promise.all([
    getI18n(),
    getVisibilityContext(),
  ]);

  const [stats, liveStreams, featured, packages] = await Promise.all([
    getQueueStats(),
    getLiveStreams({ geoFilter, take: 6 }),
    prisma.modelProfile.findMany({
      where: { kycStatus: 'APPROVED', ...geoFilter },
      orderBy: [{ isOnline: 'desc' }, { ratingAvg: 'desc' }],
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
    prisma.tokenPackage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      take: 3,
    }),
  ]);

  const features = [
    {
      icon: Compass,
      title: t('feed.discover'),
      description:
        'Un feed con lo ultimo de todas las creadoras, y otro solo con las que sigues. Publicaciones publicas, de pago y exclusivas para suscriptores.',
      href: '/feed',
      cta: t('home.exploreFeed'),
    },
    {
      icon: Radio,
      title: t('live.title'),
      description:
        'Directos de creadoras verificadas. Entra gratis, comenta en el chat y envia regalos en tokens.',
      href: '/live',
      cta: t('live.liveNow'),
    },
    {
      icon: Shuffle,
      title: 'Llamadas aleatorias',
      description:
        'Conecta al instante con gente nueva de todo el mundo. Filtra por genero y salta a la siguiente cuando quieras.',
      href: '/random',
      cta: 'Empezar gratis',
    },
    {
      icon: Video,
      title: 'Privados 1 a 1',
      description:
        'Videollamada privada con tu creadora favorita, al instante o reservada. Pagas solo los minutos que usas.',
      href: '/models',
      cta: t('nav.creators'),
    },
  ];

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="container py-16 md:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="vip" className="mb-6 px-4 py-1.5 text-sm">
              <Sparkles className="h-3.5 w-3.5" />
              {t('home.creatorsOnline', { count: stats.onlineModels })}
            </Badge>

            <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight md:text-6xl">
              {t('home.heroTitle')}
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
              {t('home.heroSubtitle')}
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link href="/feed">
                <Button variant="brand" size="lg">
                  <Compass className="h-5 w-5" />
                  {t('home.exploreFeed')}
                </Button>
              </Link>
              <Link href="/random">
                <Button variant="outline" size="lg">
                  <Shuffle className="h-5 w-5" />
                  {t('home.startFree')}
                </Button>
              </Link>
            </div>

            {/* Metricas en vivo */}
            <div className="mx-auto mt-14 grid max-w-2xl grid-cols-2 gap-4 md:grid-cols-4">
              {[
                {
                  label: 'En directo',
                  value: liveStreams.length,
                  icon: Radio,
                },
                { label: 'Creadores en linea', value: stats.onlineModels, icon: Users },
                { label: 'Creadores VIP', value: stats.vipModels, icon: Crown },
                { label: 'Llamadas activas', value: stats.activeCalls, icon: Video },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-border/60 bg-card/50 p-4 backdrop-blur"
                >
                  <stat.icon className="mx-auto h-4 w-4 text-muted-foreground" />
                  <p className="mt-2 text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* EN DIRECTO AHORA */}
      <section className="border-b border-border/60 bg-card/20 py-14">
        <div className="container">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
                <span className="live-dot" />
                {t('home.liveNow')}
              </h2>
              <p className="mt-2 text-muted-foreground">
                Solo creadoras con KYC aprobado pueden emitir.
              </p>
            </div>
            <Link href="/live">
              <Button variant="outline">
                {t('common.seeAll')}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          {liveStreams.length === 0 ? (
            <p className="rounded-xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
              {t('home.liveNowEmpty')}
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {liveStreams.map((stream) => (
                <LiveCard key={stream.id} stream={stream} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* MODOS */}
      <section className="container py-16">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            Cuatro formas de conectar
          </h2>
          <p className="mt-3 text-muted-foreground">
            Elige la experiencia que buscas hoy.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <Card
              key={feature.title}
              className="group relative overflow-hidden transition-colors hover:border-primary/50"
            >
              <CardContent className="pt-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="mt-2 min-h-[96px] text-sm text-muted-foreground">
                  {feature.description}
                </p>
                <Link href={feature.href}>
                  <Button variant="ghost" size="sm" className="mt-3 -ml-3 px-3">
                    {feature.cta}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* CREADORES DESTACADOS */}
      <section className="border-y border-border/60 bg-card/20 py-16">
        <div className="container">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                {t('home.featured')}
              </h2>
              <p className="mt-2 text-muted-foreground">
                {t('home.featuredSubtitle')}
              </p>
            </div>
            <Link href="/models">
              <Button variant="outline">
                {t('common.seeAll')}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((model) => (
              <ModelCard key={model.id} model={model} />
            ))}
          </div>
        </div>
      </section>

      {/* TOKENS */}
      <section className="container py-16">
        <div className="mb-10 text-center">
          <Badge variant="token" className="mb-4">
            <Coins className="h-3.5 w-3.5" />
            Monedero unico
          </Badge>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            Un solo saldo para todo
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Los tokens sirven para llamadas, regalos en directo, publicaciones
            de pago, contenido exclusivo y suscripciones.
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-3">
          {packages.map((pkg) => (
            <Card
              key={pkg.id}
              className={pkg.isPopular ? 'relative border-primary' : ''}
            >
              {pkg.isPopular && (
                <Badge
                  variant="vip"
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2"
                >
                  Mas popular
                </Badge>
              )}
              <CardContent className="pt-6 text-center">
                <p className="text-sm font-medium text-muted-foreground">
                  {pkg.name}
                </p>
                <p className="mt-3 text-3xl font-bold text-token">
                  {formatTokens(pkg.tokens + pkg.bonusTokens)}
                </p>
                <p className="text-xs text-muted-foreground">tokens</p>
                {pkg.bonusTokens > 0 && (
                  <Badge variant="success" className="mt-3">
                    +{pkg.bonusTokens} de regalo
                  </Badge>
                )}
                <p className="mt-4 text-2xl font-semibold">
                  ${(pkg.priceCents / 100).toFixed(2)}
                </p>
                <Link href="/wallet">
                  <Button
                    variant={pkg.isPopular ? 'brand' : 'outline'}
                    className="mt-4 w-full"
                  >
                    Comprar
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA CREADORES */}
      <section className="border-t border-border/60 bg-card/20">
        <div className="container py-16 text-center">
          <Badge variant="muted" className="mb-4">
            <Lock className="h-3.5 w-3.5" />
            Verificacion en 24-48 h
          </Badge>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            Gana dinero como creadora
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Emite en directo desde OBS o desde el navegador, publica contenido
            de pago, fija tu tarifa por minuto y cobra por PayPal, transferencia
            o USDT.
          </p>
          <Link href="/register?role=model">
            <Button variant="brand" size="lg" className="mt-8">
              Empezar a emitir
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>
    </>
  );
}
