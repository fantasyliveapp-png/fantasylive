import Link from 'next/link';
import type { ModelProfile } from '@prisma/client';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  Crown,
  Gift,
  MessageCircle,
  PartyPopper,
  Plus,
  Radio,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import { OnlineToggle } from '@/components/model/online-toggle';
import { GuidedTour, TourButton, type TourStep } from '@/components/tour/guided-tour';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getCreatorEarnings, getCreatorPending } from '@/lib/creator-dashboard';
import { config } from '@/lib/config';
import { TEST_AUDIENCE } from '@/lib/post-insights';
import { prisma } from '@/lib/prisma';
import { getWalletSummary, tokensToPayoutCents, withdrawableTokens } from '@/lib/tokens';
import { cn, formatMoney, initials } from '@/lib/utils';

/**
 * HOY
 *
 * La primera pantalla del panel, a proposito corta: como estoy (conectada o
 * no), cuanto dinero tengo, que me esta esperando y un boton para crear. Las
 * graficas y el detalle viven en Dinero; lo que piden los fans, en Bandeja.
 * A las creadoras nuevas les guia con una lista de primeros pasos.
 */
export async function CreatorHome({
  userId,
  profile,
}: {
  userId: string;
  profile: ModelProfile;
}) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [wallet, pending, earnings, reachPeople, inTest] = await Promise.all([
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
  ]);

  const usd = (tokens: number) => formatMoney(tokensToPayoutCents(tokens));
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
      hint: 'Suscripcion, mensajes de pago o citas',
      href: '/dashboard/model/rates',
    },
    {
      done: profile.postsCount > 0,
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
      href: '/dashboard/model/bandeja?tipo=citas',
      icon: CalendarDays,
      title: `${pending.pendingBookings} ${pending.pendingBookings === 1 ? 'cita' : 'citas'} por confirmar`,
    });
  }
  if (pending.pendingRequests > 0) {
    todo.push({
      href: '/dashboard/model/bandeja?tipo=pedidos',
      icon: Gift,
      title: `${pending.pendingRequests} ${pending.pendingRequests === 1 ? 'pedido a medida' : 'pedidos a medida'}`,
    });
  }

  const tour: TourStep[] = [
    {
      title: `Bienvenida a tu panel, ${firstName}`,
      body: 'Te enseñamos en unos segundos donde esta cada cosa. Puedes saltarlo cuando quieras.',
    },
    {
      target: 'online',
      title: 'Conectada o desconectada',
      body: 'Enciendelo cuando estes disponible: los fans te ven en linea y pueden llamarte. Apagalo al irte.',
    },
    {
      target: 'money',
      title: 'Tu dinero',
      body: `Lo que ya puedes retirar. Tocalo para ver tus ganancias y pedir tu retiro (desde ${formatMoney(tokensToPayoutCents(config.economy.minPayoutTokens))}).`,
    },
    {
      target: 'invite',
      title: 'Invita y gana',
      body: 'Tu enlace para compartir. Los fans que traes te dejan el 70% y ganas un 5% de las creadoras que invites.',
    },
    {
      target: 'todo',
      title: 'Te esperan',
      body: 'Mensajes, citas y pedidos de tus fans que esperan tu respuesta. Contestar rapido vende mas.',
    },
    {
      target: 'create',
      title: 'Crear',
      body: 'Publica fotos, videos o encuestas, o empieza un directo. Cada publicacion nueva se ensena a gente nueva.',
    },
    {
      target: 'sections',
      title: 'Tus secciones',
      body: 'Hoy es este resumen. Bandeja: citas y pedidos. Dinero: ganancias y retiros. Ajustes: precios, perfil y privacidad.',
    },
    {
      target: 'profile',
      title: 'Tu perfil',
      body: 'Asi te ven los fans. Desde aqui cambias tu foto, portada y bio.',
    },
    {
      title: 'Listo',
      body: 'Ya sabes donde esta todo. Si lo necesitas, vuelve a verlo desde "Ver tutorial", al final de esta pagina.',
    },
  ];

  return (
    <div className="space-y-5">
      <GuidedTour id="creator-home-v1" steps={tour} />

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
          <OnlineToggle
            variant="hero"
            isOnline={profile.isOnline}
            isAvailableForVip={profile.isAvailableForVip}
            isVipEnabled={profile.isVipEnabled}
            canStream={profile.kycStatus === 'APPROVED'}
          />
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

      {/* Invita y gana (referidos) */}
      <Link
        href="/dashboard/model/invita"
        data-tour="invite"
        className="group flex items-center gap-3 rounded-2xl border border-champagne-gold/40 bg-champagne-gold/10 p-4 transition-colors hover:border-champagne-gold"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-champagne-gold/20 text-champagne-gold">
          <Crown className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {profile.founderNumber != null
              ? `Fundadora #${profile.founderNumber} · Invita y gana`
              : 'Invita y gana'}
          </span>
          <span className="block text-xs text-muted-foreground">
            Tus fans te dejan mas y ganas el 5% de las creadoras que traigas
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>

      {/* Alcance: cuanta gente la ve */}
      {profile.postsCount > 0 && (
        <Link
          href="/dashboard/model/alcance"
          className="group flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/50"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <TrendingUp className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {reachPeople.length.toLocaleString('es')}{' '}
              {reachPeople.length === 1 ? 'persona te ha visto' : 'personas te han visto'} esta
              semana
            </span>
            <span className="block text-xs text-muted-foreground">
              {inTest > 0
                ? `${inTest} ${inTest === 1 ? 'publicacion en prueba' : 'publicaciones en prueba'} · mejor hora para publicar`
                : 'Como van tus publicaciones y mejor hora para publicar'}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

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

      <div className="flex justify-center pt-1">
        <TourButton id="creator-home-v1" />
      </div>
    </div>
  );
}
