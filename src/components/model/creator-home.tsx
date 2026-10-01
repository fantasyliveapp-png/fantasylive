import Link from 'next/link';
import type { ModelProfile } from '@prisma/client';
import {
  AlertTriangle,
  BadgePercent,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  Crown,
  Gem,
  Gift,
  HeartHandshake,
  Images,
  MessageCircle,
  MessageSquareHeart,
  Package,
  PartyPopper,
  Plus,
  Radio,
  SlidersHorizontal,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import { AvailabilitySwitch } from '@/components/calls/call-availability';
import { GuidedTour, TourButton, type TourStep } from '@/components/tour/guided-tour';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getCreatorEarnings, getCreatorPending } from '@/lib/creator-dashboard';
import { config } from '@/lib/config';
import { founderLabel, gw } from '@/lib/gender-words';
import { parseTipMenu } from '@/lib/live-state';
import { TEST_AUDIENCE } from '@/lib/post-insights';
import { prisma } from '@/lib/prisma';
import {
  getWalletSummary,
  tokensToNetPayoutCents,
  withdrawableTokens,
} from '@/lib/tokens';
import { cn, formatMoney, initials } from '@/lib/utils';

/**
 * INICIO
 *
 * El centro del panel, de arriba abajo: como estoy y cuanto dinero tengo,
 * crear, lo que me espera y "Tu panel": TODAS las herramientas agrupadas
 * (Vender, Fans, Crecer), cada una con un dato en vivo para que nada se
 * pierda. Las graficas viven en Dinero; los pedidos y citas, en Mensajes.
 * A los creadores nuevos les guia con una lista de primeros pasos.
 */
export async function CreatorHome({
  userId,
  profile,
}: {
  userId: string;
  profile: ModelProfile;
}) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [wallet, pending, earnings, reachPeople, inTest, counts] = await Promise.all([
    getWalletSummary(userId),
    getCreatorPending(profile.id, userId),
    getCreatorEarnings(userId),
    prisma.postImpression.findMany({
      where: { post: { modelId: profile.id }, createdAt: { gte: weekAgo } },
      distinct: ['userId'],
      select: { userId: true },
    }),
    prisma.post.count({
      where: {
        modelId: profile.id,
        isPublished: true,
        viewCount: { lt: TEST_AUDIENCE },
        createdAt: { lte: new Date(), gte: new Date(Date.now() - 21 * 86_400_000) },
      },
    }),
    Promise.all([
      prisma.post.count({ where: { modelId: profile.id, liveExclusiveAt: null, removedAt: null } }),
      prisma.vaultItem.count({ where: { modelId: profile.id } }),
      prisma.post.count({ where: { modelId: profile.id, liveExclusiveAt: { not: null }, removedAt: null } }),
      prisma.subscription.count({
        where: { modelId: profile.id, status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { username: true } }),
      prisma.follow.count({ where: { modelId: profile.id, user: { status: 'ACTIVE' } } }),
    ]).then(([posts, vault, livePacks, subscribers, account, followers]) => ({
      posts,
      followers,
      vault,
      livePacks,
      subscribers,
      username: account?.username ?? null,
    })),
  ]);
  const packsInMenu = parseTipMenu(profile.liveTipMenu).filter((i) => i.postId).length;

  // Lo que gana de verdad, en dolares.
  const usd = (tokens: number) => formatMoney(tokensToNetPayoutCents(tokens));
  const firstName = profile.stageName.split(' ')[0];

  // Primeros pasos: desaparecen en cuanto estan todos hechos.
  const steps = [
    {
      done: profile.kycStatus === 'APPROVED',
      title: 'Verifica tu identidad',
      hint: profile.kycStatus === 'PENDING' ? 'En revision, te avisamos en 24-48 h' : 'Sin esto no puedes cobrar',
      href: '/dashboard/model/kyc',
    },
    {
      done: Boolean(profile.avatarUrl && profile.bio),
      title: 'Pon tu foto y tu bio',
      hint: 'Es lo primero que ven tus fans',
      href: `/models/${profile.slug}?editar=1`,
    },
    {
      done: profile.subscriptionEnabled || profile.messagingEnabled,
      title: 'Elige como cobrar',
      hint: 'Suscripcion, mensajes de pago o reservas',
      href: '/dashboard/model/rates',
    },
    {
      done: counts.posts > 0,
      title: 'Haz tu primera publicacion',
      hint: 'Fotos, videos, texto o una encuesta',
      href: '/dashboard/model/posts?nuevo=1',
    },
  ];
  const stepsDone = steps.filter((s) => s.done).length;

  // Lo que espera respuesta, cada cosa a su filtro de la Bandeja.
  const todo: { href: string; icon: LucideIcon; title: string; warning?: boolean }[] = [];
  if (profile.kycStatus === 'REJECTED') {
    todo.push({
      href: '/dashboard/model/kyc',
      icon: AlertTriangle,
      title: 'Tu verificacion fue rechazada: revisala',
      warning: true,
    });
  }
  if (pending.unansweredMessages > 0) {
    todo.push({
      href: '/mensajes',
      icon: MessageCircle,
      title: `${pending.unansweredMessages} ${pending.unansweredMessages === 1 ? 'fan espera' : 'fans esperan'} tu respuesta`,
    });
  }
  if (pending.pendingBookings > 0) {
    todo.push({
      href: '/mensajes?filtro=reservas',
      icon: CalendarDays,
      title: `${pending.pendingBookings} ${pending.pendingBookings === 1 ? 'reserva' : 'reservas'} por confirmar`,
    });
  }
  if (pending.pendingRequests > 0) {
    todo.push({
      href: '/mensajes?filtro=pedidos',
      icon: Gift,
      title: `${pending.pendingRequests} ${pending.pendingRequests === 1 ? 'pedido a medida' : 'pedidos a medida'}`,
    });
  }

  const welcome = gw(profile.gender, { f: 'Bienvenida', m: 'Bienvenido', pl: 'Bienvenidos' });
  const tour: TourStep[] = [
    {
      title: `${welcome} a tu panel, ${firstName}`,
      body: 'En un minuto te enseñamos todo lo que puedes hacer: llamadas, directos, contenido de pago y tu dinero. Puedes saltarlo cuando quieras.',
    },
    {
      target: 'online',
      title: 'Recibo llamadas',
      body: 'Un solo botón: enciéndelo cuando estés disponible y los fans podrán llamarte. Te sonará en la web con su nombre y decides si contestas. Si no contestas, te queda como llamada perdida en el chat. Lo tienes siempre arriba; si cierras la web, se apaga solo.',
    },
    {
      target: 'money',
      title: 'Lo que ganas',
      body: `Este es tu dinero, ya listo para retirar. Todos los precios te dicen cuánto ganas tú en dólares, sin descuentos al retirar. Tócalo para ver tus ganancias y pedir el retiro (desde ${usd(config.economy.minPayoutTokens)}).`,
    },
    {
      target: 'create',
      title: 'Publicar o ir en directo',
      body: 'Publica fotos, vídeos, textos o encuestas, gratis o de pago: pones el precio en tokens o directamente lo que quieres ganar en $. "Ir en directo" funciona desde el móvil: ves tu cámara antes de empezar, pones un título y eliges si aceptas privados 1 a 1. La meta de tokens la activas dentro del directo.',
    },
    {
      target: 'todo',
      title: 'Te esperan',
      body: 'Mensajes, videollamadas reservadas y pedidos a medida que esperan tu respuesta. Contestar rápido vende más.',
    },
    {
      target: 'vault',
      title: 'Bóveda del chat',
      body: 'Sube aquí lo que vendes por mensaje. Elige al subir: un paquete con un solo precio, fotos sueltas con precio cada una, o gratis para enganchar. En el chat lo envías en dos toques y el fan paga para verlo.',
    },
    {
      target: 'livepacks',
      title: 'Packs de directo',
      body: 'Contenido que solo se vende durante tus directos, desde el menú Especiales. Tiene que ser nuevo y único: si ya lo usaste en el chat o en publicaciones no te deja subirlo, y repetir contenido puede penalizarse.',
    },
    {
      target: 'rates',
      title: 'Tus precios',
      body: 'Tu precio por minuto del privado 1 a 1 (desde 17,5 tokens) y el mínimo de minutos de cada llamada: si el fan cuelga antes, igual se te paga ese mínimo; si cuelgas tú, solo se cobra lo hablado. También la suscripción, los mensajes de pago y las reservas.',
    },
    {
      target: 'offers',
      title: 'Ofertas',
      body: 'Lanza descuentos en un toque: happy hour en tus privados, rebajas de tu contenido, primer mes de suscripción, primera llamada o un cupón para un fan desde el chat. Salen de tu precio y ves lo que ganas antes de activarlas.',
    },
    {
      target: 'fans',
      title: 'Fans y crecer',
      body: 'Más abajo: tus fans y suscriptores, el mensaje de bienvenida automático, tu alcance, las estadísticas e "Invita y gana", que te suma a tu retiro lo que generen quienes invites.',
    },
    {
      target: 'sections',
      title: 'Tus secciones',
      body: 'Inicio es este resumen. Contenido: Bóveda del chat y packs de directo. Dinero: ganancias y retiros. Ajustes: perfil y privacidad. Las reservas y pedidos están en Mensajes.',
    },
    {
      target: 'profile',
      title: 'Tu perfil',
      body: 'Así te ven los fans: tus fotos y vídeos, la suscripción y el botón para llamarte. Solo tú ves ahí tus compras, suscripciones y a quién sigues.',
    },
    {
      title: '¡Listo!',
      body: 'Ya conoces todo. Puedes volver a verlo cuando quieras desde "Ver tutorial", al final de esta página.',
    },
  ];

  return (
    <div className="space-y-5">
      <GuidedTour id="creator-home-v4" steps={tour} />

      {/* Saludo, estado y dinero */}
      <section className="relative overflow-hidden rounded-3xl border border-border/60 bg-card p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-state-connected/10 blur-3xl"
        />

        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span data-tour="profile" className="rounded-full bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold p-[2px] lg:hidden">
              <Avatar className="h-12 w-12 border-2 border-card">
                {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
                <AvatarFallback>{initials(profile.stageName)}</AvatarFallback>
              </Avatar>
            </span>
            <h1 className="font-heading text-2xl uppercase tracking-wide sm:text-3xl">
              Hola, {firstName}
            </h1>
          </div>

          <div data-tour="online">
          <AvailabilitySwitch variant="hero" />
          </div>
        </div>

        <Link
          href="/dashboard/model/dinero"
          data-tour="money"
          className="group relative mt-6 flex items-end justify-between gap-4"
        >
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Tu dinero
            </span>
            <span className="mt-1 block font-heading text-5xl leading-none text-state-connected">
              {usd(withdrawableTokens(wallet))}
            </span>
            <span className="mt-1.5 block text-xs text-muted-foreground">
              {usd(earnings.weekTokens)} esta semana
            </span>
          </span>
          <span className="flex items-center gap-1 text-xs font-semibold text-primary">
            Ver y retirar
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      </section>

      {/* Crear */}
      <section data-tour="create" className="grid grid-cols-2 gap-2">
        <Link href="/dashboard/model/posts?nuevo=1">
          {/* En movil cada boton ocupa media pantalla: menos margen y el texto
              puede partirse, para que no se salga del boton. */}
          <Button variant="brand" size="lg" className="h-14 w-full whitespace-normal px-3 text-sm leading-tight sm:px-8 sm:text-base">
            <Plus className="h-5 w-5" />
            Nueva publicacion
          </Button>
        </Link>
        <Link href="/dashboard/model/live">
          <Button variant="outline" size="lg" className="h-14 w-full whitespace-normal px-3 text-sm leading-tight sm:px-8 sm:text-base">
            <Radio className="h-5 w-5 text-rose-500" />
            Ir en directo
          </Button>
        </Link>
      </section>

      {/* Primeros pasos (solo hasta completarlos) */}
      {stepsDone < steps.length && (
        <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Primeros pasos</h2>
            <span className="text-xs text-muted-foreground">
              {stepsDone} de {steps.length}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(stepsDone / steps.length) * 100}%` }}
            />
          </div>
          <ol className="mt-3 space-y-1">
            {steps.map((step) => (
              <li key={step.title}>
                <Link
                  href={step.href}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-2 py-2 transition-colors',
                    !step.done && 'hover:bg-primary/10',
                  )}
                  aria-disabled={step.done}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                      step.done
                        ? 'border-state-connected bg-state-connected text-black'
                        : 'border-border',
                    )}
                  >
                    {step.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-sm',
                        step.done ? 'text-muted-foreground line-through' : 'font-medium',
                      )}
                    >
                      {step.title}
                    </span>
                    {!step.done && (
                      <span className="block text-xs text-muted-foreground">{step.hint}</span>
                    )}
                  </span>
                  {!step.done && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Lo que espera */}
      <section data-tour="todo">
        <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Te esperan
        </h2>
        {todo.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-state-connected/30 bg-state-connected/5 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-state-connected/15 text-state-connected">
              <PartyPopper className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Todo al dia</span>
              <span className="block text-xs text-muted-foreground">
                Nadie te espera. Buen momento para publicar algo.
              </span>
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {todo.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group flex items-center gap-3 rounded-2xl border p-4 transition-colors',
                  item.warning
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-border/60 bg-card hover:border-primary/50',
                )}
              >
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                    item.warning ? 'bg-amber-500/15 text-amber-500' : 'bg-primary/15 text-primary',
                  )}
                >
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-semibold">{item.title}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Tu panel: todas las herramientas, agrupadas */}
      <section data-tour="panel" className="space-y-4">
        <PanelGroup title="Vender">
          <Tile href={`/models/${profile.slug}`} icon={Images} label="Publicaciones" sub={`${counts.posts} en tu perfil`} />
          <Tile tour="vault" href="/dashboard/model/contenido?tab=chat" icon={Gem} label="Boveda del chat" sub={`${counts.vault} archivos`} />
          <Tile
            tour="livepacks"
            href="/dashboard/model/contenido?tab=directos"
            icon={Package}
            label="Packs de directo"
            sub={counts.livePacks ? `${counts.livePacks} · ${packsInMenu} en Especiales` : 'Crea el primero'}
          />
          <Tile tour="rates" href="/dashboard/model/rates" icon={SlidersHorizontal} label="Precios" sub="Suscripcion, chat, reservas" />
          <Tile tour="offers" href="/dashboard/model/ofertas" icon={BadgePercent} label="Ofertas" sub="Happy hour, rebajas, cupones" />
        </PanelGroup>
        <PanelGroup title="Fans" tour="fans">
          <Tile
            href="/dashboard/model/fans"
            icon={HeartHandshake}
            label="Mis fans"
            sub={`${counts.followers} · ${counts.subscribers} ${counts.subscribers === 1 ? 'suscrito' : 'suscritos'}`}
          />
          <Tile
            href="/mensajes"
            icon={MessageCircle}
            label="Mensajes"
            sub={pending.unansweredMessages ? `${pending.unansweredMessages} sin responder` : 'Al dia'}
            alert={pending.unansweredMessages > 0}
          />
          <Tile
            href="/mensajes?filtro=pedidos"
            icon={Gift}
            label="Pedidos y reservas"
            sub={
              pending.pendingRequests + pending.pendingBookings
                ? `${pending.pendingRequests + pending.pendingBookings} pendientes`
                : 'Nada pendiente'
            }
            alert={pending.pendingRequests + pending.pendingBookings > 0}
          />
          <Tile
            href="/dashboard/model/greeting"
            icon={MessageSquareHeart}
            label="Bienvenida"
            sub={profile.autoGreetingEnabled ? 'Activa' : 'Apagada'}
          />
        </PanelGroup>
        <PanelGroup title="Crecer">
          <Tile
            href="/dashboard/model/alcance"
            icon={TrendingUp}
            label="Alcance"
            sub={`${reachPeople.length.toLocaleString('es')} esta semana${inTest > 0 ? ` · ${inTest} en prueba` : ''}`}
          />
          <Tile href="/dashboard/model/analytics" icon={BarChart3} label="Estadisticas" sub="Visitas y compradores" />
          <Tile
            href="/dashboard/model/invita"
            icon={Crown}
            label="Invita y gana"
            sub={profile.founderNumber != null ? `${founderLabel(profile.gender)} #${profile.founderNumber}` : '5% de quien invites'}
            gold
          />
        </PanelGroup>
      </section>

      {/* Tu lado de fan: en tu perfil (pestanas Mis compras y Mis suscripciones). */}
      <p className="text-center text-xs text-muted-foreground">
        Tus compras, suscripciones y a quién sigues están en{' '}
        <Link href={`/models/${profile.slug}`} className="font-medium text-foreground hover:text-primary">
          tu perfil
        </Link>
        .
      </p>

      <div className="flex justify-center pt-1">
        <TourButton id="creator-home-v4" />
      </div>
    </div>
  );
}

function PanelGroup({ title, tour, children }: { title: string; tour?: string; children: React.ReactNode }) {
  return (
    <div data-tour={tour}>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>
    </div>
  );
}

function Tile({
  href,
  icon: Icon,
  label,
  sub,
  alert = false,
  gold = false,
  tour,
}: {
  tour?: string;
  href: string;
  icon: LucideIcon;
  label: string;
  sub: string;
  alert?: boolean;
  gold?: boolean;
}) {
  return (
    <Link
      href={href}
      data-tour={tour}
      className={cn(
        'group flex flex-col gap-2 rounded-2xl border bg-card p-3 transition-colors',
        gold ? 'border-champagne-gold/40 hover:border-champagne-gold' : 'border-border/60 hover:border-primary/50',
      )}
    >
      <span className="flex items-center justify-between">
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-xl',
            gold ? 'bg-champagne-gold/15 text-champagne-gold' : 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        {alert && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Pendiente" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className={cn('block truncate text-[11px]', alert ? 'text-primary' : 'text-muted-foreground')}>{sub}</span>
      </span>
    </Link>
  );
}
