import Link from 'next/link';
import {
  ArrowRight,
  Coins,
  Crown,
  Lock,
  Shuffle,
  Sparkles,
  Users,
  Video,
} from 'lucide-react';

import { ModelCard } from '@/components/models/model-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getVisibilityContext } from '@/lib/geo';
import { getQueueStats } from '@/lib/matchmaking';
import { prisma } from '@/lib/prisma';
import { formatTokens } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    icon: Shuffle,
    title: 'Llamadas aleatorias',
    description:
      'Conecta al instante con gente nueva de todo el mundo. Filtra por genero y salta a la siguiente cuando quieras.',
    href: '/random',
    cta: 'Empezar gratis',
  },
  {
    icon: Crown,
    title: 'Sala VIP',
    description:
      'Conexion aleatoria exclusivamente con creadores VIP verificados y en linea. Pagas solo por los minutos que usas.',
    href: '/vip',
    cta: 'Entrar en VIP',
  },
  {
    icon: Video,
    title: 'Privados reservados',
    description:
      'Agenda una videollamada 1 a 1 con tu creador favorito en el horario que mejor te venga.',
    href: '/models',
    cta: 'Ver creadores',
  },
  {
    icon: Lock,
    title: 'Contenido exclusivo',
    description:
      'Packs de fotos y videos que desbloqueas con tokens. Acceso permanente una vez comprado.',
    href: '/models',
    cta: 'Explorar',
  },
];

export default async function HomePage() {
  // Los perfiles que bloquean el pais del visitante no salen ni en destacados.
  const { filter: geoFilter } = await getVisibilityContext();

  const [stats, featured, packages] = await Promise.all([
    getQueueStats(),
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
        isVipEnabled: true,
        isAvailableForVip: true,
        vipRatePerMinute: true,
        privateRatePerMinute: true,
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

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="container py-20 md:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="vip" className="mb-6 px-4 py-1.5 text-sm">
              <Sparkles className="h-3.5 w-3.5" />
              {stats.onlineModels} creadores en linea ahora mismo
            </Badge>

            <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight md:text-6xl">
              Conoce gente real,{' '}
              <span className="text-gradient">sin guiones</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
              Videollamadas para conocer gente nueva, sesiones privadas con
              tus creadores favoritos y contenido exclusivo. Todo con un
              unico monedero de tokens.
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link href="/random">
                <Button variant="brand" size="lg">
                  <Shuffle className="h-5 w-5" />
                  Llamada aleatoria gratis
                </Button>
              </Link>
              <Link href="/vip">
                <Button variant="outline" size="lg">
                  <Crown className="h-5 w-5" />
                  Sala VIP
                </Button>
              </Link>
            </div>

            {/* Metricas en vivo */}
            <div className="mx-auto mt-14 grid max-w-2xl grid-cols-2 gap-4 md:grid-cols-4">
              {[
                { label: 'Creadores en linea', value: stats.onlineModels, icon: Users },
                { label: 'Creadores VIP', value: stats.vipModels, icon: Crown },
                { label: 'Llamadas activas', value: stats.activeCalls, icon: Video },
                {
                  label: 'En cola',
                  value: stats.waitingRandom + stats.waitingVip,
                  icon: Shuffle,
                },
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

      {/* MODOS */}
      <section className="container py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Cuatro formas de conectar
          </h2>
          <p className="mt-3 text-muted-foreground">
            Elige la experiencia que buscas hoy.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <Card
              key={feature.title}
              className="group relative overflow-hidden transition-colors hover:border-primary/50"
            >
              <CardContent className="pt-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="mt-2 min-h-[72px] text-sm text-muted-foreground">
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
      <section className="border-y border-border/60 bg-card/20 py-20">
        <div className="container">
          <div className="mb-10 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">
                Creadores destacados
              </h2>
              <p className="mt-2 text-muted-foreground">
                Todos los perfiles estan verificados con KYC.
              </p>
            </div>
            <Link href="/models">
              <Button variant="outline">
                Ver todas
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
      <section className="container py-20">
        <div className="mb-12 text-center">
          <Badge variant="token" className="mb-4">
            <Coins className="h-3.5 w-3.5" />
            Monedero unico
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight">
            Un solo saldo para todo
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Los tokens sirven para llamadas VIP, privados reservados, contenido
            exclusivo y propinas. Sin suscripciones ocultas.
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-3">
          {packages.map((pkg) => (
            <Card
              key={pkg.id}
              className={
                pkg.isPopular ? 'relative border-primary' : ''
              }
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
        <div className="container py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Gana dinero como creador
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Fija tus propias tarifas por minuto, vende contenido exclusivo y
            cobra tus ganancias cuando quieras. Verificacion en 24-48 h.
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
