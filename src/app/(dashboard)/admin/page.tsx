import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BadgeCheck,
  Coins,
  Flag,
  PhoneCall,
  Percent,
  TrendingUp,
  Users,
  Video,
  Wallet,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAdmin } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { formatMoney, formatTokens, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Panel de administracion' };
export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  await requireAdmin();

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    users,
    models,
    onlineModels,
    activeCalls,
    pendingKyc,
    openReports,
    pendingPayouts,
    purchases,
    spends,
    fees,
    revenue30d,
    recentAudit,
    topModels,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.modelProfile.count(),
    prisma.modelProfile.count({ where: { isOnline: true } }),
    prisma.callSession.count({ where: { status: 'ACTIVE' } }),
    prisma.kycVerification.count({ where: { status: 'PENDING' } }),
    prisma.report.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
    prisma.payoutRequest.count({
      where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
    }),
    prisma.transaction.aggregate({
      where: { type: 'TOKEN_PURCHASE', status: 'COMPLETED' },
      _sum: { tokens: true, amountCents: true },
    }),
    prisma.transaction.aggregate({
      where: {
        type: { in: ['CALL_CHARGE', 'CONTENT_UNLOCK', 'TIP'] },
        status: 'COMPLETED',
      },
      _sum: { tokens: true },
    }),
    prisma.transaction.aggregate({ _sum: { platformFeeTokens: true } }),
    prisma.transaction.aggregate({
      where: {
        type: 'TOKEN_PURCHASE',
        status: 'COMPLETED',
        createdAt: { gte: since30d },
      },
      _sum: { amountCents: true },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.modelProfile.findMany({
      orderBy: { totalTokensEarned: 'desc' },
      take: 8,
      select: {
        id: true,
        stageName: true,
        slug: true,
        totalTokensEarned: true,
        totalCalls: true,
        isOnline: true,
        kycStatus: true,
      },
    }),
  ]);

  const tokensSpent = Math.abs(spends._sum.tokens ?? 0);
  const feeTokens = fees._sum.platformFeeTokens ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Metricas globales</h1>
        <p className="mt-2 text-muted-foreground">
          Estado general de la plataforma en tiempo real.
        </p>
      </div>

      {/* Alertas accionables */}
      {(pendingKyc > 0 || openReports > 0 || pendingPayouts > 0) && (
        <div className="grid gap-4 sm:grid-cols-3">
          {pendingKyc > 0 && (
            <AlertCard
              href="/admin/kyc"
              icon={BadgeCheck}
              count={pendingKyc}
              label="KYC por revisar"
            />
          )}
          {openReports > 0 && (
            <AlertCard
              href="/admin/reports"
              icon={Flag}
              count={openReports}
              label="Reportes abiertos"
            />
          )}
          {pendingPayouts > 0 && (
            <AlertCard
              href="/admin/payouts"
              icon={Wallet}
              count={pendingPayouts}
              label="Retiros pendientes"
            />
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Users} label="Usuarios totales" value={formatTokens(users)} />
        <Kpi
          icon={Video}
          label="Modelos"
          value={formatTokens(models)}
          hint={`${onlineModels} en linea`}
        />
        <Kpi
          icon={PhoneCall}
          label="Llamadas activas"
          value={formatTokens(activeCalls)}
        />
        <Kpi
          icon={TrendingUp}
          label="Ingresos 30 dias"
          value={formatMoney(revenue30d._sum.amountCents ?? 0)}
        />
      </div>

      {/* Economia de tokens */}
      <Card>
        <CardHeader>
          <CardTitle>Economia de tokens</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <EconomyStat
            icon={Coins}
            label="Tokens vendidos"
            value={formatTokens(purchases._sum.tokens ?? 0)}
            hint={formatMoney(purchases._sum.amountCents ?? 0)}
          />
          <EconomyStat
            icon={TrendingUp}
            label="Tokens consumidos"
            value={formatTokens(tokensSpent)}
            hint={`${
              purchases._sum.tokens
                ? Math.round((tokensSpent / purchases._sum.tokens) * 100)
                : 0
            }% de lo vendido`}
          />
          <EconomyStat
            icon={Percent}
            label="Comision acumulada"
            value={formatTokens(feeTokens)}
            hint={`${config.economy.platformCommissionPercent}% por transaccion`}
          />
          <EconomyStat
            icon={Wallet}
            label="Pasivo con modelos"
            value={formatTokens(tokensSpent - feeTokens)}
            hint="Tokens pendientes de retirar"
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top modelos */}
        <Card>
          <CardHeader>
            <CardTitle>Modelos con mas ingresos</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {topModels.map((model, index) => (
                <li key={model.id} className="flex items-center gap-3">
                  <span className="w-5 shrink-0 text-sm font-bold text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/models/${model.slug}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {model.stageName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {formatTokens(model.totalCalls)} llamadas
                    </p>
                  </div>
                  {model.isOnline && (
                    <Badge variant="live" className="gap-1">
                      <span className="live-dot !h-1.5 !w-1.5 bg-white" />
                      Live
                    </Badge>
                  )}
                  <span className="shrink-0 text-sm font-semibold text-token">
                    {formatTokens(model.totalTokensEarned)}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* Auditoria */}
        <Card>
          <CardHeader>
            <CardTitle>Actividad administrativa</CardTitle>
          </CardHeader>
          <CardContent>
            {recentAudit.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin actividad registrada.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {recentAudit.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 text-sm">
                    <Badge variant="muted" className="shrink-0 font-mono text-[10px]">
                      {log.action}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-muted-foreground">
                        {log.actor?.name ?? log.actor?.email ?? 'Sistema'} ·{' '}
                        {log.entityType}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {relativeTime(log.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
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

function EconomyStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function AlertCard({
  href,
  icon: Icon,
  count,
  label,
}: {
  href: string;
  icon: typeof Flag;
  count: number;
  label: string;
}) {
  return (
    <Link href={href}>
      <Card className="border-amber-500/40 bg-amber-500/5 transition-colors hover:border-amber-500">
        <CardContent className="flex items-center gap-4 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15">
            <Icon className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex-1">
            <p className="text-2xl font-bold">{count}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
          <Button variant="ghost" size="sm">
            Revisar
          </Button>
        </CardContent>
      </Card>
    </Link>
  );
}
