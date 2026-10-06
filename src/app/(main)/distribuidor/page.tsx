import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, BadgeCheck, ChevronRight, Coins, Landmark, ShieldCheck, Wallet } from 'lucide-react';

import { CancelOrderButton, DistributorOrderForm, LotProofForm } from '@/components/distributors/distributor-forms';
import { AccountsEditor, AvailabilityToggle } from '@/components/distributors/p2p';
import { requireUser } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { countryFlag, countryName } from '@/lib/countries';
import { COUNTRY_CURRENCY, discountTiers, formatLocal, paymentMethodLabel, RECOMMENDED_MAX_MARGIN } from '@/lib/distributor-shared';
import { averageDiscount, expireSales, operatingBlock, ORDER_LIMITS, SANCTIONED_COUNTRIES } from '@/lib/distributors';
import { prisma } from '@/lib/prisma';
import { cn, formatDateTime, formatMoney, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Panel de distribuidor' };
export const dynamic = 'force-dynamic';

const SALE_LABEL = {
  AWAITING_PAYMENT: { text: 'Esperando pago del fan', tone: 'bg-amber-500/15 text-amber-500' },
  PAID: { text: 'El fan pagó: confirma', tone: 'bg-primary/15 text-primary' },
  DISPUTED: { text: 'En disputa', tone: 'bg-rose-500/15 text-rose-500' },
  COMPLETED: { text: 'Completada', tone: 'bg-state-connected/15 text-state-connected' },
  CANCELLED: { text: 'Cancelada', tone: 'bg-muted text-muted-foreground' },
} as const;

/**
 * PANEL DE DISTRIBUIDOR OFICIAL: pedidos de fans (compra protegida), sus metodos
 * de cobro con su precio, y la compra de tokens al por mayor (en dolares).
 */
export default async function DistributorPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const user = await requireUser('/distribuidor');
  await expireSales();
  const d = await prisma.distributor.findUnique({
    where: { userId: user.id },
    include: {
      accounts: {
        where: { active: true },
        orderBy: { createdAt: 'asc' },
        include: { packages: { where: { active: true }, orderBy: { tokens: 'asc' } } },
      },
    },
  });
  if (!d) notFound();

  const [orders, sales, completed30, myDiscount] = await Promise.all([
    prisma.distributorOrder.findMany({ where: { distributorId: d.id }, orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.distributorSale.findMany({
      where: { distributorId: d.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { fan: { select: { username: true, name: true } }, account: { select: { method: true } } },
    }),
    prisma.distributorSale.aggregate({
      where: { distributorId: d.id, status: 'COMPLETED', completedAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } },
      _sum: { tokens: true },
      _count: true,
    }),
    averageDiscount(d.id),
  ]);
  const block = operatingBlock(d);
  const maxPct = config.distributors.discountPercent;
  const tiers = discountTiers(maxPct);
  const tv = config.economy.tokenValueCents;
  const reserved = sales.filter((s) => ['AWAITING_PAYMENT', 'PAID', 'DISPUTED'].includes(s.status)).reduce((n, s) => n + s.tokens, 0);
  const needAction = sales.filter((s) => s.status === 'PAID' || s.status === 'AWAITING_PAYMENT' || s.status === 'DISPUTED');
  const history = sales.filter((s) => !needAction.includes(s)).slice(0, 15);

  const allCountries = Object.keys(COUNTRY_CURRENCY)
    .filter((c) => !SANCTIONED_COUNTRIES.has(c))
    .sort((a, b) => countryName(a).localeCompare(countryName(b), 'es'))
    .map((c) => ({ code: c, label: `${countryFlag(c)} ${countryName(c)}` }));
  const countryNames = Object.fromEntries(d.countries.map((c) => [c, `${countryFlag(c)} ${countryName(c)}`]));

  const tab = params.tab === 'precios' || params.tab === 'comprar' ? params.tab : 'pedidos';
  const toConfirm = needAction.filter((s) => s.status === 'PAID').length;
  const tabs = [
    { key: 'pedidos', label: 'Pedidos', badge: toConfirm || null },
    { key: 'precios', label: 'Mis precios', badge: d.accounts.length === 0 ? '!' : null },
    { key: 'comprar', label: 'Comprar tokens', badge: orders.filter((o) => o.status === 'PENDING' && !o.proofKey).length || null },
  ] as const;

  return (
    <div className="container max-w-2xl space-y-4 py-6">
      {/* Cabecera */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-1.5 font-heading text-2xl uppercase tracking-wide">
            Distribuidor <BadgeCheck className="h-5 w-5 shrink-0 text-state-connected" />
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {d.legalName} · {d.countries.map((c) => countryFlag(c)).join(' ')}
          </p>
        </div>
        <AvailabilityToggle available={d.isAvailable} compact />
      </header>

      {block && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {block}
        </p>
      )}

      {/* Numeros */}
      <section className="grid grid-cols-3 divide-x divide-border/60 rounded-2xl border border-border/60 bg-card py-3 text-center">
        <Stat label="Para vender" value={formatTokens(d.stockTokens)} sub={reserved ? `+${formatTokens(reserved)} reservados` : 'tokens'} highlight />
        <Stat label="Ventas 30 días" value={String(completed30._count)} sub={`${formatTokens(completed30._sum.tokens ?? 0)} tk`} />
        <Stat label="Descuento medio" value={`−${myDiscount.toLocaleString('es')}%`} sub={`hasta −${maxPct}%`} />
      </section>

      {/* Pestanas */}
      <nav className="grid grid-cols-3 gap-1 rounded-xl bg-muted/40 p-1 text-sm">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === 'pedidos' ? '/distribuidor' : `/distribuidor?tab=${t.key}`}
            scroll={false}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-colors',
              tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.badge && <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4 text-primary-foreground">{t.badge}</span>}
          </Link>
        ))}
      </nav>

      {tab === 'pedidos' && (
        <section className="space-y-3">
          {needAction.length === 0 && history.length === 0 ? (
            <Empty>
              Aún no tienes pedidos. Los fans te encuentran por tu país y tus métodos de pago.
              {d.accounts.length === 0 && (
                <Link href="/distribuidor?tab=precios" className="mt-2 block font-semibold text-primary">
                  Añade tus métodos y precios →
                </Link>
              )}
            </Empty>
          ) : (
            <>
              {needAction.length > 0 && <SaleList title="Pendientes" sales={needAction} />}
              {history.length > 0 && <SaleList title="Historial" sales={history} muted />}
            </>
          )}
        </section>
      )}

      {tab === 'precios' && (
        <section className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Cada método (país, moneda y tus datos) con sus paquetes y precios. Recomendado: no ganar más del{' '}
            {RECOMMENDED_MAX_MARGIN}% por venta.
          </p>
          <AccountsEditor
            accounts={d.accounts.map((a) => ({
              id: a.id,
              country: a.country,
              currency: a.currency,
              method: a.method,
              details: a.details,
              packages: a.packages.map((p) => ({ id: p.id, tokens: p.tokens, price: p.price })),
            }))}
            countries={d.countries}
            countryNames={countryNames}
            allCountries={allCountries}
          />
        </section>
      )}

      {tab === 'comprar' && (
        <section className="space-y-4">
          <div className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">
              Más tokens, más descuento. Pide el lote, paga en dólares por transferencia
              {config.distributors.usdtAddress ? ' o USDT' : ''} y envía el recibo. Cuando lo confirmemos, los tokens se suman a tu
              stock.
            </p>
            <DistributorOrderForm
              tokenValueCents={tv}
              maxDiscountPercent={maxPct}
              usdt={config.distributors.usdtAddress ? { network: config.distributors.usdtNetwork } : null}
              disabled={Boolean(block)}
            />
          </div>

          {(config.distributors.wireInstructions || config.distributors.usdtAddress) && (
            <details className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-xs">
              <summary className="cursor-pointer text-sm font-medium">Datos para pagar</summary>
              <div className="mt-2 space-y-2">
                {config.distributors.wireInstructions && (
                  <p className="flex items-start gap-2 whitespace-pre-line">
                    <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span><strong>Transferencia (USD):</strong> {config.distributors.wireInstructions}</span>
                  </p>
                )}
                {config.distributors.usdtAddress && (
                  <p className="flex items-start gap-2 break-all">
                    <Coins className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>
                      <strong>USDT ({config.distributors.usdtNetwork}):</strong> {config.distributors.usdtAddress}
                      <span className="mt-1 block text-amber-500">Solo por la red {config.distributors.usdtNetwork}.</span>
                    </span>
                  </p>
                )}
              </div>
            </details>
          )}

          {orders.length > 0 && (
            <div className="space-y-1.5">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tus lotes</h2>
              <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card text-sm">
                {orders.map((o) => {
                  const state =
                    o.status === 'PAID'
                      ? { text: 'Pagado', tone: 'bg-state-connected/15 text-state-connected' }
                      : o.status === 'CANCELLED'
                        ? { text: o.rejectReason ? 'Rechazado' : 'Cancelado', tone: 'bg-muted text-muted-foreground' }
                        : o.proofKey
                          ? { text: 'Recibo enviado', tone: 'bg-primary/15 text-primary' }
                          : { text: 'Falta tu pago', tone: 'bg-amber-500/15 text-amber-500' };
                  return (
                    <li key={o.id} className="space-y-2 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">
                            {formatTokens(o.tokens)} tk · {formatMoney(o.amountCents)}
                            {o.discountPercent > 0 && <span className="text-state-connected"> · −{o.discountPercent}%</span>}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {formatDateTime(o.createdAt.toISOString())} · {o.paymentMethod === 'USDT' ? 'USDT' : 'Transferencia'} · lote{' '}
                            {o.id.slice(-8).toUpperCase()}
                          </span>
                        </span>
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', state.tone)}>{state.text}</span>
                        {o.status === 'PENDING' && !o.proofKey && <CancelOrderButton id={o.id} />}
                      </div>
                      {o.status === 'PENDING' && !o.proofKey && <LotProofForm orderId={o.id} usdt={o.paymentMethod === 'USDT'} />}
                      {o.status === 'PENDING' && o.proofKey && (
                        <p className="text-[11px] text-muted-foreground">
                          Ref. {o.paymentRef}. El equipo está revisando tu recibo; te avisamos al confirmarlo.
                        </p>
                      )}
                      {o.status === 'CANCELLED' && o.rejectReason && (
                        <p className="text-[11px] text-rose-500">Motivo: {o.rejectReason}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <details className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm">
            <summary className="flex cursor-pointer items-center gap-2 font-medium">
              <Wallet className="h-4 w-4 text-state-connected" /> Cómo ganas
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Compras tokens con descuento: {tiers.map((t) => `−${t.percent}% desde ${formatTokens(t.minTokens)}`).join(' · ')}.</li>
              <li>Los vendes a tus fans al precio que pones en cada paquete, en tu moneda.</li>
              <li>Recomendado: no ganar más del {RECOMMENDED_MAX_MARGIN}% por venta; los fans compran a quien vende más barato.</li>
              <li>Entre {formatTokens(ORDER_LIMITS.minTokens)} y {formatTokens(ORDER_LIMITS.maxTokens)} tokens por lote, nunca con tarjeta.</li>
            </ul>
          </details>
        </section>
      )}

      <p className="flex items-start gap-1.5 px-1 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
        Vende solo con pedidos dentro de Fantasy Live. Nunca a menores ni con tarjetas de terceros.
      </p>
    </div>
  );
}

function SaleList({
  title,
  sales,
  muted,
}: {
  title: string;
  sales: { id: string; tokens: number; amount: number; currency: string; status: keyof typeof SALE_LABEL; createdAt: Date; fan: { username: string | null; name: string | null }; account: { method: string } }[];
  muted?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <ul className={cn('divide-y divide-border/60 rounded-2xl border border-border/60 bg-card', muted && 'opacity-80')}>
        {sales.map((s) => (
          <li key={s.id}>
            <Link href={`/compra-tokens/${s.id}`} className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted/40">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {formatTokens(s.tokens)} tk · {formatLocal(s.amount, s.currency)}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  @{s.fan.username ?? s.fan.name} · {paymentMethodLabel(s.account.method)} · {formatDateTime(s.createdAt.toISOString())}
                </span>
              </span>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', SALE_LABEL[s.status].tone)}>
                {SALE_LABEL[s.status].text}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="px-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-bold leading-tight', highlight && 'text-token')}>{value}</p>
      {sub && <p className="truncate text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
