import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CalendarDays,
  Coins,
  Crown,
  Gift,
  Heart,
  Lock,
  MessageCircle,
  PhoneCall,
  Shuffle,
  Video,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/guards';
import { CALL_TYPE_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { getWalletSummary } from '@/lib/tokens';
import {
  formatDateTime,
  formatDuration,
  formatTokens,
  initials,
  relativeTime,
} from '@/lib/utils';

export const metadata: Metadata = { title: 'Mi cuenta' };
export const dynamic = 'force-dynamic';

export default async function UserDashboardPage() {
  const user = await requireUser('/dashboard');

  const [wallet, recentCalls, upcomingBookings, unlocks, stats] =
    await Promise.all([
      getWalletSummary(user.id),
      prisma.callSession.findMany({
        where: { OR: [{ callerId: user.id }, { calleeId: user.id }] },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          callee: {
            select: {
              name: true,
              image: true,
              modelProfile: { select: { stageName: true, slug: true, avatarUrl: true } },
            },
          },
        },
      }),
      prisma.booking.findMany({
        where: {
          userId: user.id,
          status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
          startsAt: { gte: new Date() },
        },
        orderBy: { startsAt: 'asc' },
        take: 3,
        include: { model: { select: { stageName: true, slug: true, avatarUrl: true } } },
      }),
      prisma.contentUnlock.count({ where: { userId: user.id } }),
      prisma.callSession.aggregate({
        where: { callerId: user.id, status: 'ENDED' },
        _count: true,
        _sum: { billedSeconds: true, tokensSpent: true },
      }),
    ]);

  return (
    <div className="container py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Hola, {user.name ?? 'de nuevo'}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Resumen de tu actividad en FantasyLive.
          </p>
        </div>
        {user.isVip && (
          <Badge variant="vip" className="gap-1 px-3 py-1.5">
            <Crown className="h-4 w-4" />
            Miembro VIP
          </Badge>
        )}
      </div>

      {/* Metricas */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-token/40 bg-token/5">
          <CardContent className="pt-6">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Coins className="h-4 w-4 text-token" /> Saldo
            </p>
            <p className="mt-2 text-3xl font-bold text-token">
              {formatTokens(wallet.balance)}
            </p>
            <Link href="/wallet">
              <Button variant="token" size="sm" className="mt-3 w-full">
                Recargar
              </Button>
            </Link>
          </CardContent>
        </Card>

        <MetricCard
          icon={PhoneCall}
          label="Llamadas realizadas"
          value={formatTokens(stats._count)}
        />
        <MetricCard
          icon={Video}
          label="Tiempo en vivo"
          value={formatDuration(stats._sum.billedSeconds ?? 0)}
        />
        <MetricCard
          icon={Lock}
          label="Packs desbloqueados"
          value={formatTokens(unlocks)}
        />
      </div>

      {/* Accesos rapidos */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <QuickAction
          href="/random"
          icon={Shuffle}
          title="Llamada aleatoria"
          description="Gratis, sin limite"
        />
        <QuickAction
          href="/vip"
          icon={Crown}
          title="Sala VIP"
          description="Solo modelos verificadas"
        />
        <QuickAction
          href="/models"
          icon={CalendarDays}
          title="Reservar privado"
          description="Agenda 1 a 1"
        />
        <QuickAction
          href="/dashboard/requests"
          icon={Gift}
          title="Mis pedidos"
          description="Contenido a medida"
        />
        <QuickAction
          href="/dashboard/subscriptions"
          icon={Heart}
          title="Mis suscripciones"
          description="Creadoras que segui pagando"
        />
        <QuickAction
          href="/dashboard/messages"
          icon={MessageCircle}
          title="Mensajes"
          description="Tus conversaciones"
        />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {/* Proximas reservas */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Proximas reservas</CardTitle>
            <Link href="/bookings">
              <Button variant="ghost" size="sm">
                Ver todas
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {upcomingBookings.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No tienes reservas proximas.
              </p>
            ) : (
              <ul className="space-y-3">
                {upcomingBookings.map((booking) => (
                  <li key={booking.id} className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      {booking.model.avatarUrl && (
                        <AvatarImage src={booking.model.avatarUrl} alt="" />
                      )}
                      <AvatarFallback>
                        {initials(booking.model.stageName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {booking.model.stageName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(booking.startsAt)} ·{' '}
                        {booking.durationMinutes} min
                      </p>
                    </div>
                    <Badge
                      variant={booking.status === 'CONFIRMED' ? 'success' : 'warning'}
                    >
                      {booking.status === 'CONFIRMED' ? 'Confirmada' : 'Pendiente'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Historial de llamadas */}
        <Card>
          <CardHeader>
            <CardTitle>Ultimas llamadas</CardTitle>
          </CardHeader>
          <CardContent>
            {recentCalls.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Todavia no has hecho ninguna llamada.
              </p>
            ) : (
              <ul className="space-y-3">
                {recentCalls.map((call) => {
                  const other = call.callee;
                  const name =
                    other?.modelProfile?.stageName ?? other?.name ?? 'Anonimo';
                  return (
                    <li key={call.id} className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        {(other?.modelProfile?.avatarUrl ?? other?.image) && (
                          <AvatarImage
                            src={other?.modelProfile?.avatarUrl ?? other?.image ?? ''}
                            alt=""
                          />
                        )}
                        <AvatarFallback>{initials(name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{name}</p>
                        <p className="text-xs text-muted-foreground">
                          {CALL_TYPE_LABELS[call.type]} ·{' '}
                          {formatDuration(call.billedSeconds)} ·{' '}
                          {relativeTime(call.createdAt)}
                        </p>
                      </div>
                      {call.tokensSpent > 0 && (
                        <span className="text-sm font-semibold text-rose-400">
                          -{formatTokens(call.tokensSpent)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="h-4 w-4" /> {label}
        </p>
        <p className="mt-2 text-3xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof Coins;
  title: string;
  description: string;
}) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-primary/50">
        <CardContent className="flex items-center gap-4 py-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
