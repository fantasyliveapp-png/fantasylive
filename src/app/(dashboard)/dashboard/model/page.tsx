import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  Coins,
  Eye,
  Star,
  TrendingUp,
  Users,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireModel } from '@/lib/auth/guards';
import { CALL_TYPE_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { getWalletSummary, tokensToPayoutCents } from '@/lib/tokens';
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  formatTokens,
  relativeTime,
} from '@/lib/utils';

export const metadata: Metadata = { title: 'Panel de modelo' };
export const dynamic = 'force-dynamic';

export default async function ModelOverviewPage() {
  const { user, profile } = await requireModel();

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    wallet,
    earnings7d,
    earnings30d,
    recentCalls,
    upcomingBookings,
    contentStats,
  ] = await Promise.all([
    getWalletSummary(user.id),
    prisma.transaction.aggregate({
      where: {
        userId: user.id,
        type: { in: ['CALL_EARNING', 'CONTENT_EARNING', 'TIP_EARNING'] },
        createdAt: { gte: since7d },
      },
      _sum: { tokens: true },
    }),
    prisma.transaction.aggregate({
      where: {
        userId: user.id,
        type: { in: ['CALL_EARNING', 'CONTENT_EARNING', 'TIP_EARNING'] },
        createdAt: { gte: since30d },
      },
      _sum: { tokens: true },
    }),
    prisma.callSession.findMany({
      where: { calleeId: user.id, status: 'ENDED' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { caller: { select: { name: true, country: true } } },
    }),
    prisma.booking.findMany({
      where: {
        modelId: profile.id,
        status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
        startsAt: { gte: new Date() },
      },
      orderBy: { startsAt: 'asc' },
      take: 5,
      include: { user: { select: { name: true } } },
    }),
    prisma.contentPackage.aggregate({
      where: { modelId: profile.id },
      _count: true,
      _sum: { tokensEarned: true, purchaseCount: true },
    }),
  ]);

  const needsKyc = profile.kycStatus !== 'APPROVED';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Resumen</h1>
        <p className="mt-2 text-muted-foreground">
          Tus ganancias y actividad de un vistazo.
        </p>
      </div>

      {needsKyc && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center gap-4 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
            <div className="flex-1">
              <p className="font-medium">Verificacion pendiente</p>
              <p className="text-sm text-muted-foreground">
                {profile.kycStatus === 'PENDING'
                  ? 'Tu documentacion esta en revision. Te avisaremos en 24-48 h.'
                  : profile.kycStatus === 'REJECTED'
                    ? 'Tu verificacion fue rechazada. Revisa el motivo y vuelve a enviarla.'
                    : 'Completa el KYC para poder emitir, recibir reservas y cobrar.'}
              </p>
            </div>
            <Link href="/dashboard/model/kyc">
              <Button variant="brand" size="sm">
                Ir a verificacion
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Metricas */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-token/40 bg-token/5">
          <CardContent className="pt-6">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Coins className="h-4 w-4 text-token" /> Disponible
            </p>
            <p className="mt-2 text-3xl font-bold text-token">
              {formatTokens(wallet.balance)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              ≈ {formatMoney(tokensToPayoutCents(wallet.balance))}
            </p>
            <Link href="/dashboard/model/payouts">
              <Button variant="token" size="sm" className="mt-3 w-full">
                Solicitar retiro
              </Button>
            </Link>
          </CardContent>
        </Card>

        <MetricCard
          icon={TrendingUp}
          label="Ultimos 7 dias"
          value={formatTokens(earnings7d._sum.tokens ?? 0)}
          hint={`${formatTokens(earnings30d._sum.tokens ?? 0)} en 30 dias`}
        />
        <MetricCard
          icon={Clock}
          label="Minutos en vivo"
          value={formatTokens(profile.totalMinutes)}
          hint={`${formatTokens(profile.totalCalls)} llamadas`}
        />
        <MetricCard
          icon={Star}
          label="Valoracion"
          value={
            profile.ratingCount > 0 ? `${profile.ratingAvg.toFixed(1)}/5` : '-'
          }
          hint={`${profile.ratingCount} resenas`}
        />
      </div>

      {/* Tarifas actuales */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Tus tarifas</CardTitle>
          <Link href="/dashboard/model/rates">
            <Button variant="outline" size="sm">
              Editar
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <RateBox
            label="Llamada VIP"
            value={`${profile.vipRatePerMinute}/min`}
            active={profile.isVipEnabled}
          />
          <RateBox
            label="Privado reservado"
            value={`${profile.privateRatePerMinute}/min`}
            active={profile.acceptsBookings}
          />
          <RateBox
            label="Minimo privado"
            value={`${profile.minPrivateMinutes} min`}
            active
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Reservas */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Proximas reservas</CardTitle>
            <Link href="/dashboard/model/bookings">
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
                {upcomingBookings.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {b.user.name ?? 'Usuario'}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarDays className="h-3 w-3" />
                        {formatDateTime(b.startsAt)} · {b.durationMinutes} min
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-token">
                        {formatTokens(b.totalTokens)}
                      </p>
                      <Badge
                        variant={b.status === 'CONFIRMED' ? 'success' : 'warning'}
                        className="mt-0.5"
                      >
                        {b.status === 'CONFIRMED' ? 'Confirmada' : 'Pendiente'}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Llamadas recientes */}
        <Card>
          <CardHeader>
            <CardTitle>Llamadas recientes</CardTitle>
          </CardHeader>
          <CardContent>
            {recentCalls.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Todavia no has recibido llamadas.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {recentCalls.map((call) => (
                  <li
                    key={call.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {call.caller.name ?? 'Usuario'}
                        {call.caller.country ? ` · ${call.caller.country}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {CALL_TYPE_LABELS[call.type]} ·{' '}
                        {formatDuration(call.billedSeconds)} ·{' '}
                        {relativeTime(call.createdAt)}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold text-emerald-400">
                      +{formatTokens(call.tokensEarned)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Contenido */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Contenido de pago</CardTitle>
          <Link href="/dashboard/model/content">
            <Button variant="outline" size="sm">
              Gestionar
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <MetricInline
            icon={Eye}
            label="Paquetes publicados"
            value={formatTokens(contentStats._count)}
          />
          <MetricInline
            icon={Users}
            label="Compras totales"
            value={formatTokens(contentStats._sum.purchaseCount ?? 0)}
          />
          <MetricInline
            icon={Coins}
            label="Tokens generados"
            value={formatTokens(contentStats._sum.tokensEarned ?? 0)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="h-4 w-4" /> {label}
        </p>
        <p className="mt-2 text-3xl font-bold">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function RateBox({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-token">{value}</p>
      <Badge variant={active ? 'success' : 'muted'} className="mt-2">
        {active ? 'Activo' : 'Desactivado'}
      </Badge>
    </div>
  );
}

function MetricInline({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-lg font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
