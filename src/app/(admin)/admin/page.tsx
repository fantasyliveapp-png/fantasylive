import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  ChevronRight,
  CircleCheck,
  Crown,
  Flag,
  Handshake,
  LifeBuoy,
  PhoneCall,
  Radio,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { auditLabel, getAdminOverview, type DayPoint, type Kpi } from '@/lib/admin-overview';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { cn, formatMoney, formatTokens, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const user = await requireAdmin();
  const [o, me] = await Promise.all([
    getAdminOverview(),
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true, username: true } }),
  ]);
  const firstName = (me?.name ?? me?.username ?? '').split(' ')[0];
  const today = new Intl.DateTimeFormat('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  const tasks: Task[] = [
    {
      href: '/admin/kyc',
      icon: BadgeCheck,
      count: o.counts.kyc,
      title: 'Verificaciones de identidad',
      detail: o.oldestKycAt
        ? `La mas antigua espera desde ${relativeTime(o.oldestKycAt)}`
        : 'Creadoras esperando para poder publicar',
    },
    {
      href: '/admin/reports',
      icon: Flag,
      count: o.counts.reports,
      title: 'Reportes y disputas',
      detail: 'Denuncias de usuarios sin cerrar',
    },
    {
      href: '/admin/payouts',
      icon: Wallet,
      count: o.counts.payouts,
      title: 'Retiros de creadoras',
      detail: `${formatMoney(o.payoutsPendingCents)} por pagar en total`,
    },
    {
      href: '/admin/soporte',
      icon: LifeBuoy,
      count: o.counts.support,
      title: 'Consultas de soporte',
      detail: 'Fans y creadoras esperando respuesta',
    },
    {
      href: '/admin/reclutadores',
      icon: Handshake,
      count: o.counts.recruitersToPay,
      title: 'Pagos a reclutadores',
      detail: 'Ya llegaron al minimo de pago semanal',
    },
  ];
  const pending = tasks.filter((t) => t.count > 0);

  return (
    <>
      <AdminPageHeader
        title={firstName ? `Hola, ${firstName}` : 'Resumen'}
        description={<span className="inline-block first-letter:uppercase">{today}</span>}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {/* Lo que hay que hacer */}
          <Panel
            title="Por revisar"
            aside={pending.length > 0 ? `${pending.length} pendientes` : undefined}
          >
            {pending.length === 0 ? (
              <div className="flex items-center gap-3 px-5 py-6 text-sm">
                <CircleCheck className="h-5 w-5 text-state-connected" />
                <span>
                  <span className="font-medium">Todo al dia.</span>{' '}
                  <span className="text-muted-foreground">No hay nada esperando por ti.</span>
                </span>
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {pending.map((t) => (
                  <li key={t.href}>
                    <Link
                      href={t.href}
                      className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.03]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <t.icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{t.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t.detail}
                        </span>
                      </span>
                      <span className="text-lg font-semibold tabular-nums">{t.count}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Como va la semana */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Ventas" kpi={o.kpis.revenue} money />
            <KpiCard label="Tu comision" kpi={o.kpis.commission} money />
            <KpiCard label="Cuentas nuevas" kpi={o.kpis.fans} />
            <KpiCard label="Creadoras nuevas" kpi={o.kpis.creators} />
          </div>

          <Panel title="Ventas de tokens" aside="Ultimos 30 dias">
            <RevenueChart series={o.series} />
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Creadoras que mas ganan" aside="30 dias">
              {o.top.length === 0 ? (
                <Empty>Aun no hay ventas este mes.</Empty>
              ) : (
                <ol className="divide-y divide-white/[0.06]">
                  {o.top.map((c, i) => (
                    <li key={c.userId} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="w-4 text-xs font-semibold text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      {c.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.avatarUrl}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold uppercase">
                          {c.name.slice(0, 1)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        {c.slug ? (
                          <Link
                            href={`/models/${c.slug}`}
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {c.name}
                          </Link>
                        ) : (
                          <span className="block truncate text-sm font-medium">{c.name}</span>
                        )}
                        {c.isOnline && (
                          <span className="text-[11px] text-state-connected">Conectada</span>
                        )}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatMoney(c.earnedCents)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            <Panel title="Actividad reciente">
              {o.recentAudit.length === 0 ? (
                <Empty>Sin actividad todavia.</Empty>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {o.recentAudit.map((a) => (
                    <li key={a.id} className="flex items-baseline gap-3 px-5 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{auditLabel(a.action)}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {a.actor}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {relativeTime(a.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>

        {/* Columna derecha: ahora mismo y crecimiento */}
        <div className="space-y-6">
          <Panel title="Ahora mismo">
            <ul className="divide-y divide-white/[0.06]">
              <LiveRow icon={Radio} label="Directos en vivo" value={o.live.liveNow} hot />
              <LiveRow icon={PhoneCall} label="Llamadas en curso" value={o.live.activeCalls} hot />
              <LiveRow
                icon={BadgeCheck}
                label="Creadoras conectadas"
                value={o.live.onlineCreators}
              />
            </ul>
          </Panel>

          <Panel title="Fundadoras">
            <div className="space-y-3 px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="flex items-center gap-2 text-sm">
                  <Crown className="h-4 w-4 text-champagne-gold" />
                  Plazas ocupadas
                </span>
                <span className="text-sm tabular-nums">
                  <span className="text-lg font-semibold">{o.founders.taken}</span>
                  <span className="text-muted-foreground"> / {o.founders.spots}</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-champagne-gold"
                  style={{
                    width: `${Math.min(100, (o.founders.taken / o.founders.spots) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Quedan {Math.max(0, o.founders.spots - o.founders.taken)} plazas con el 5% para
                siempre.
              </p>
            </div>
          </Panel>

          <Panel title="En total">
            <dl className="divide-y divide-white/[0.06] text-sm">
              <TotalRow label="Cuentas" value={formatTokens(o.totals.users)} />
              <TotalRow label="Creadoras" value={formatTokens(o.totals.creators)} />
              <TotalRow
                label="Creadoras verificadas"
                value={formatTokens(o.totals.verifiedCreators)}
              />
            </dl>
            <div className="border-t border-white/[0.06] px-5 py-3">
              <Link
                href="/admin/users"
                className="text-xs font-medium text-primary hover:underline"
              >
                Ver todas las cuentas
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

type Task = { href: string; icon: LucideIcon; count: number; title: string; detail: string };

function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#141417]">
      <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function KpiCard({ label, kpi, money }: { label: string; kpi: Kpi; money?: boolean }) {
  const fmt = (n: number) => (money ? formatMoney(n) : formatTokens(n));
  const diff = kpi.value - kpi.previous;
  const pct = kpi.previous > 0 ? Math.round((diff / kpi.previous) * 100) : null;
  const up = diff > 0;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#141417] p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{fmt(kpi.value)}</p>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        {diff !== 0 && (
          <span
            className={cn(
              'flex items-center font-medium',
              up ? 'text-state-connected' : 'text-destructive',
            )}
          >
            {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {pct !== null ? `${Math.abs(pct)}%` : fmt(Math.abs(diff))}
          </span>
        )}
        <span>{diff === 0 ? 'igual que' : 'vs'} semana anterior</span>
      </p>
    </div>
  );
}

function RevenueChart({ series }: { series: DayPoint[] }) {
  const max = Math.max(1, ...series.map((d) => d.revenueCents));
  const total = series.reduce((s, d) => s + d.revenueCents, 0);
  const signups = series.reduce((s, d) => s + d.signups, 0);
  const label = (day: string) =>
    new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(day),
    );

  return (
    <div className="px-5 pb-4 pt-4">
      <div className="mb-4 flex flex-wrap gap-x-8 gap-y-1">
        <p>
          <span className="text-2xl font-semibold tabular-nums">{formatMoney(total)}</span>
          <span className="ml-2 text-xs text-muted-foreground">vendido</span>
        </p>
        <p>
          <span className="text-2xl font-semibold tabular-nums">{formatTokens(signups)}</span>
          <span className="ml-2 text-xs text-muted-foreground">cuentas nuevas</span>
        </p>
      </div>
      <div className="flex h-36 items-end gap-[3px]">
        {series.map((d) => (
          <div
            key={d.day}
            className="group relative flex h-full flex-1 items-end"
            title={`${label(d.day)}: ${formatMoney(d.revenueCents)} · ${d.signups} cuentas nuevas`}
          >
            <div
              className={cn(
                'w-full rounded-sm transition-colors',
                d.revenueCents > 0 ? 'bg-primary/70 group-hover:bg-primary' : 'bg-white/[0.06]',
              )}
              style={{
                height:
                  d.revenueCents > 0 ? `${Math.max(4, (d.revenueCents / max) * 100)}%` : '2px',
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>{label(series[0]!.day)}</span>
        <span>Hoy</span>
      </div>
    </div>
  );
}

function LiveRow({
  icon: Icon,
  label,
  value,
  hot,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  hot?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 px-5 py-3 text-sm">
      <Icon
        className={cn('h-4 w-4', hot && value > 0 ? 'text-primary' : 'text-muted-foreground')}
      />
      <span className="flex-1">{label}</span>
      {hot && value > 0 && <span className="live-dot !h-1.5 !w-1.5 bg-primary" />}
      <span className="font-semibold tabular-nums">{value}</span>
    </li>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
