import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BarChart3,
  ChevronRight,
  Crown,
  Gift,
  History,
  Images,
  MessageCircle,
  SquarePen,
  Video,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { EarningsWeekChart } from '@/components/model/earnings-week-chart';
import { Button } from '@/components/ui/button';
import { requireModel } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { getCreatorEarnings, type EarningType } from '@/lib/creator-dashboard';
import { getWalletSummary, tokensToPayoutCents } from '@/lib/tokens';
import { cn, formatMoney, formatTokens, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dinero' };
export const dynamic = 'force-dynamic';

const SOURCE_ICONS: Record<EarningType, LucideIcon> = {
  CALL_EARNING: Video,
  POST_EARNING: SquarePen,
  SUBSCRIPTION_EARNING: Crown,
  TIP_EARNING: Gift,
  CONTENT_EARNING: Images,
  CONTENT_REQUEST_EARNING: Gift,
  MESSAGE_UNLOCK_EARNING: MessageCircle,
  MESSAGE_ATTACHMENT_EARNING: MessageCircle,
};

/**
 * DINERO
 *
 * Todo lo del dinero en una pagina: cuanto hay para retirar, cuanto se ha
 * ganado y de donde viene. Retiros, historial y estadisticas cuelgan de aqui
 * en vez de ser secciones sueltas del menu. Siempre en dolares.
 */
export default async function MoneyPage() {
  const { user } = await requireModel();
  const [wallet, earnings] = await Promise.all([
    getWalletSummary(user.id),
    getCreatorEarnings(user.id),
  ]);

  const usd = (tokens: number) => formatMoney(tokensToPayoutCents(tokens));
  const canWithdraw = wallet.balance >= config.economy.minPayoutTokens;
  const feePercent = config.economy.payoutFeePercent;

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl uppercase tracking-wide">Dinero</h1>

      {/* Disponible y retirar */}
      <section className="relative overflow-hidden rounded-3xl border border-border/60 bg-card p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-state-connected/15 blur-3xl"
        />
        <div className="relative grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Disponible para retirar
            </p>
            <p className="mt-1 font-heading text-5xl leading-none text-state-connected">
              {usd(wallet.balance)}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {formatTokens(wallet.balance)} tokens
              {feePercent > 0 && ` · al retirar se descuenta un ${feePercent}%`}
              {!canWithdraw && ` · minimo ${usd(config.economy.minPayoutTokens)}`}
            </p>
          </div>
          <Link href="/dashboard/model/payouts">
            <Button variant={canWithdraw ? 'brand' : 'outline'} size="lg" className="w-full sm:w-auto">
              <Wallet className="h-4 w-4" />
              Retirar dinero
            </Button>
          </Link>
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
            <p className="text-[11px] text-muted-foreground">Esta semana</p>
            <p className="mt-1 text-lg font-bold leading-none">{usd(earnings.weekTokens)}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
            <p className="text-[11px] text-muted-foreground">Ultimos 30 dias</p>
            <p className="mt-1 text-lg font-bold leading-none">{usd(earnings.monthTokens)}</p>
          </div>
        </div>
      </section>

      {/* Semana y origen */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <h2 className="text-sm font-semibold">Lo que has ganado esta semana</h2>
          <div className="mt-4">
            <EarningsWeekChart
              days={earnings.days.map((d) => ({
                label: d.label,
                cents: tokensToPayoutCents(d.tokens),
              }))}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <h2 className="text-sm font-semibold">De donde viene tu dinero</h2>
          <p className="text-xs text-muted-foreground">Ultimos 30 dias</p>
          {earnings.bySource.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Aun no hay ingresos este mes.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {earnings.bySource.map((s) => {
                const Icon = SOURCE_ICONS[s.type];
                const pct = earnings.monthTokens
                  ? Math.round((s.tokens / earnings.monthTokens) * 100)
                  : 0;
                return (
                  <li key={s.label}>
                    <div className="flex items-center gap-2.5 text-sm">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{s.label}</span>
                      <span className="font-semibold tabular-nums">{usd(s.tokens)}</span>
                      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                        {pct}%
                      </span>
                    </div>
                    <div className="ml-[26px] mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-state-connected/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Ultimos ingresos */}
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <h2 className="text-sm font-semibold">Ultimos ingresos</h2>
        {earnings.recent.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Cuando alguien te pague, lo veras aqui al momento.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {earnings.recent.map((t) => {
              const Icon = SOURCE_ICONS[t.type];
              return (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{t.description ?? t.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.label} · {relativeTime(t.createdAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-state-connected">
                    +{usd(t.tokens)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Lo demas del dinero, un toque mas alla */}
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        <MoreLink
          href="/dashboard/model/payouts"
          icon={Wallet}
          title="Retiros"
          hint="Pide un retiro y mira los que ya hiciste"
        />
        <MoreLink
          href="/dashboard/model/earnings"
          icon={History}
          title="Historial completo"
          hint="Cada pago, uno por uno"
        />
        <MoreLink
          href="/dashboard/model/analytics"
          icon={BarChart3}
          title="Estadisticas"
          hint="Visitas a tu perfil, de donde vienen y que convierte"
        />
      </section>
    </div>
  );
}

function MoreLink({
  href,
  icon: Icon,
  title,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 border-b border-border/60 px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/40',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
