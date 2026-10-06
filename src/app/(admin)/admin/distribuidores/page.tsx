import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Download, ShieldAlert } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { CreateDistributorForm, DistributorRow, PendingOrderRow } from '@/components/admin/distributor-admin';
import { Kpi, Pager, SaleStatus, Select, StatusPill, TableWrap, Td, Th } from '@/components/admin/distributor-dashboard-ui';
import { ResolveDispute } from '@/components/distributors/p2p';
import { requireAdmin } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { countryFlag, countryName } from '@/lib/countries';
import {
  getDistributorDashboard,
  parsePeriod,
  PERIODS,
  SALE_LIST_INCLUDE,
  SALE_STATUS_LABEL,
  SALE_STATUSES,
  salesWhere,
  type PeriodKey,
  type SaleFilters,
} from '@/lib/distributor-dashboard';
import { discountTiers, formatAmounts, formatLocal, lotMath, PAYMENT_METHODS, paymentMethodLabel } from '@/lib/distributor-shared';
import { expireSales, getDistributorAlerts, isCompliant } from '@/lib/distributors';
import { peerPair } from '@/lib/chat';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';
import { cn, formatDateTime, formatMoney, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Distribuidores' };
export const dynamic = 'force-dynamic';

const BASE = '/admin/distribuidores';
const TABS = [
  { value: '', label: 'Resumen' },
  { value: 'lotes', label: '1 · Ventas a distribuidores' },
  { value: 'ventas', label: '2 · Ventas a fans' },
  { value: 'disputas', label: 'Disputas' },
  { value: 'gestion', label: 'Gestión y altas' },
] as const;
const PAGE_SIZE = 50;

type Params = SaleFilters & { tab?: string; periodo?: string };

/**
 * DISTRIBUIDORES OFICIALES (admin): resumen con numeros del periodo, todas las
 * ventas a fans y los lotes con filtros, y la gestion (altas, verificacion).
 */
export default async function AdminDistributorsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  await expireSales();
  const params = await searchParams;
  const tab = TABS.some((t) => t.value === params.tab) ? (params.tab as string) : '';
  const period = parsePeriod(params.periodo);
  const openDisputes = await prisma.distributorSale.count({ where: { status: 'DISPUTED' } });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Distribuidores oficiales"
        description="Revendedores de tokens por país: lo que compran, lo que venden a los fans, a qué precio y cómo atienden."
        actions={
          <Link href="/distribuidores" className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-muted/40">
            Ver página pública
          </Link>
        }
        tabs={
          <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06]">
            {TABS.map((t) => (
              <Link
                key={t.value || 'resumen'}
                href={href({ tab: t.value, periodo: period })}
                className={cn(
                  '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  t.value === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
                {t.value === 'disputas' && openDisputes > 0 && (
                  <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{openDisputes}</span>
                )}
              </Link>
            ))}
          </div>
        }
      />

      {!config.distributors.enabled && (
        <p className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>
            <strong>Programa apagado.</strong> Puedes prepararlo (dar de alta y verificar distribuidores), pero nadie
            puede pedir lotes ni vender, y la página pública no se ve. Para activarlo, con el visto bueno legal, pon{' '}
            <code className="font-mono">DISTRIBUTORS_ENABLED=&quot;true&quot;</code> en el servidor.
          </span>
        </p>
      )}

      {tab === '' && <Overview period={period} />}
      {tab === 'ventas' && <SalesTab params={params} period={period} />}
      {tab === 'lotes' && <LotsTab params={params} />}
      {tab === 'disputas' && <DisputesTab />}
      {tab === 'gestion' && <ManageTab />}
    </div>
  );
}

/** Lotes pendientes para PendingOrderRow: primero los que ya tienen recibo, con su URL firmada. */
async function pendingLotRows(
  pending: {
    id: string;
    tokens: number;
    amountCents: number;
    discountPercent: number;
    createdAt: Date;
    paymentMethod: 'WIRE' | 'USDT';
    paymentRef: string | null;
    proofKey: string | null;
    proofUploadedAt: Date | null;
    distributor: { legalName: string; country: string };
  }[],
) {
  const rows = await Promise.all(
    pending.map(async (o) => ({
      id: o.id,
      ref: o.id.slice(-8).toUpperCase(),
      who: `${o.distributor.legalName} (${o.distributor.country}) · −${o.discountPercent}%`,
      tokens: o.tokens,
      amountCents: o.amountCents,
      createdAt: o.createdAt.toISOString(),
      method: o.paymentMethod,
      proofUrl: o.proofKey ? await resolveAssetUrl(o.proofKey, { isPublic: false }) : null,
      proofIsPdf: Boolean(o.proofKey?.toLowerCase().endsWith('.pdf')),
      proofAt: o.proofUploadedAt?.toISOString() ?? null,
      distributorRef: o.proofKey ? o.paymentRef : null,
    })),
  );
  return rows.sort((a, b) => Number(Boolean(b.proofUrl)) - Number(Boolean(a.proofUrl)));
}

function href(p: Record<string, string | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v && !(k === 'periodo' && v === '30')) q.set(k, v);
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

// ---------------------------------------------------------------------------
// RESUMEN
// ---------------------------------------------------------------------------

async function Overview({ period }: { period: PeriodKey }) {
  const [dash, alerts, disputes, pending] = await Promise.all([
    getDistributorDashboard(period),
    getDistributorAlerts(),
    prisma.distributorSale.findMany({
      where: { status: 'DISPUTED' },
      orderBy: { disputedAt: 'asc' },
      include: SALE_LIST_INCLUDE,
    }),
    prisma.distributorOrder.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { distributor: { select: { legalName: true, country: true } } },
    }),
  ]);
  const t = dash.totals;
  const maxBar = Math.max(1, ...dash.series.map((s) => s.fanTokens), ...dash.series.map((s) => s.lotTokens));
  const fmtMin = (m: number | null) => (m == null ? '—' : m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`);
  const label = dash.step === 1 ? 'día' : dash.step === 7 ? 'semana' : 'mes';

  // Cobertura: paises y metodos que se ofrecen.
  const coverage = new Map<string, { distributors: Set<string>; methods: Set<string> }>();
  for (const a of dash.offered) {
    const c = coverage.get(a.country) ?? { distributors: new Set(), methods: new Set() };
    c.distributors.add(a.distributorId);
    c.methods.add(a.method);
    coverage.set(a.country, c);
  }
  const salesByCountry = new Map(dash.byCountry.map((c) => [c.key, c]));

  return (
    <div className="space-y-6">
      {/* Periodo */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-muted-foreground">Periodo:</span>
        {(Object.keys(PERIODS) as PeriodKey[]).map((k) => (
          <Link
            key={k}
            href={href({ periodo: k })}
            className={cn(
              'rounded-full border px-3 py-1 font-medium',
              k === period ? 'border-primary bg-primary/10' : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            {k === '365' ? '1 año' : `${k} días`}
          </Link>
        ))}
      </div>

      {/* Necesita atencion */}
      {(pending.length > 0 || disputes.length > 0 || alerts.length > 0) && (
        <section className="space-y-3">
          <h2 className="font-semibold">Necesita tu atención</h2>
          {disputes.length > 0 && (
            <Link
              href={href({ tab: 'disputas' })}
              className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/5 p-4 text-sm hover:bg-rose-500/10"
            >
              <span>
                <strong className="text-rose-500">{disputes.length} {disputes.length === 1 ? 'disputa abierta' : 'disputas abiertas'}</strong>
                <span className="block text-xs text-muted-foreground">
                  La más antigua: {formatDateTime((disputes[0]!.disputedAt ?? disputes[0]!.createdAt).toISOString())}. Revisa los
                  comprobantes y decide.
                </span>
              </span>
              <span className="shrink-0 font-semibold text-rose-500">Revisar →</span>
            </Link>
          )}
          {pending.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Lotes pendientes ({pending.length}) · {pending.filter((o) => o.proofKey).length} con recibo para revisar</h3>
              <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
                {(await pendingLotRows(pending)).map((o) => (
                  <PendingOrderRow key={o.id} order={o} />
                ))}
              </ul>
            </div>
          )}
          {alerts.length > 0 && (
            <details className="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-4">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-rose-500">
                <AlertTriangle className="h-4 w-4" /> Posible abuso o lavado ({alerts.length})
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {alerts.map((a, i) => (
                  <li key={i}>{a.href ? <Link href={a.href} className="hover:underline">{a.text}</Link> : a.text}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* 1. Tu -> distribuidores */}
      <section className="space-y-3 rounded-2xl border border-state-connected/30 p-4">
        <FlowHeader
          step="1"
          title="Ventas a distribuidores"
          desc="Lo que tú les vendes: lotes de tokens que te pagan en dólares."
          link={{ href: href({ tab: 'lotes' }), label: 'Ver todos los lotes' }}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Cobrado" value={formatMoney(t.lotRevenueCents)} sub={`${t.lotCount} ${t.lotCount === 1 ? 'lote pagado' : 'lotes pagados'}`} tone="good" />
          <Kpi label="Tokens vendidos" value={formatTokens(t.lotTokens)} sub={t.lotAvgDiscount == null ? undefined : `descuento medio −${t.lotAvgDiscount.toLocaleString('es')}%`} />
          <Kpi label="Por cobrar" value={formatMoney(t.pendingLotCents)} sub={`${t.pendingLotCount} ${t.pendingLotCount === 1 ? 'lote pendiente' : 'lotes pendientes'}`} tone={t.pendingLotCount ? 'warn' : undefined} />
          <Kpi label="Stock sin vender" value={`${formatTokens(t.stockTokens)} tk`} sub="ya pagados, en manos de distribuidores" />
        </div>
      </section>

      {/* 2. Distribuidores -> fans */}
      <section className="space-y-3 rounded-2xl border border-primary/30 p-4">
        <FlowHeader
          step="2"
          title="Ventas de distribuidores a fans"
          desc="Lo que ellos venden a los fans, cobrado en la moneda de cada país. Ese dinero no pasa por ti."
          link={{ href: href({ tab: 'ventas', periodo: period }), label: 'Ver todas las ventas' }}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Tokens entregados" value={formatTokens(t.tokensDelivered)} sub={`${t.salesCompleted} ventas completadas`} tone="good" />
          <Kpi label="Pedidos" value={String(t.salesCreated)} sub={t.conversion == null ? '' : `${t.conversion}% se completan · ${t.salesCancelled} cancelados`} />
          <Kpi label="Fans que compraron" value={String(t.uniqueFans)} sub={t.avgTicketTokens == null ? undefined : `${formatTokens(t.avgTicketTokens)} tk por compra de media`} />
          <Kpi label="En curso ahora" value={String(t.openSales)} sub={`${formatTokens(t.reservedTokens)} tk reservados`} />
          <Kpi label="Disputas" value={String(t.salesDisputed)} sub={t.salesCreated ? `${Math.round((t.salesDisputed / t.salesCreated) * 100)}% de los pedidos` : ''} tone={t.salesDisputed ? 'warn' : undefined} />
          <Kpi label="Tiempo para liberar" value={fmtMin(t.medianReleaseMin)} sub="mediana desde «Ya pagué»" />
          <Kpi label="Valoraciones positivas" value={t.positive == null ? '—' : `${t.positive}%`} />
          <Kpi label="Distribuidores" value={`${t.activeDistributors} / ${t.totalDistributors}`} sub={`operando · ${t.availableNow} disponibles ahora`} />
        </div>
        <p className="text-xs text-muted-foreground">Cobrado por los distribuidores: {formatAmounts(t.fanAmounts)}</p>
      </section>

      {/* Grafico */}
      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Evolución por {label}</h2>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-primary" /> Tokens entregados a fans</span>
            <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-state-connected" /> Tokens vendidos en lotes</span>
          </div>
        </div>
        <div className="flex h-40 items-end gap-[3px]">
          {dash.series.map((s) => (
            <div
              key={s.from.toISOString()}
              className="group relative flex h-full flex-1 items-end gap-px"
              title={`${s.from.toLocaleDateString('es')}: ${formatTokens(s.fanTokens)} tk a fans en ${s.sales} ventas · ${formatTokens(s.lotTokens)} tk en lotes (${formatMoney(s.lotCents)})`}
            >
              <div className="w-1/2 rounded-t bg-primary/80" style={{ height: `${(s.fanTokens / maxBar) * 100}%`, minHeight: s.fanTokens ? 2 : 0 }} />
              <div className="w-1/2 rounded-t bg-state-connected/80" style={{ height: `${(s.lotTokens / maxBar) * 100}%`, minHeight: s.lotTokens ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{dash.series[0]?.from.toLocaleDateString('es')}</span>
          <span>hoy</span>
        </div>
      </section>

      {/* Ranking */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Distribuidores en el periodo</h2>
          <Link href={href({ tab: 'gestion' })} className="text-xs font-semibold text-primary">Gestionar →</Link>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <Th>Distribuidor</Th>
              <Th>Estado</Th>
              <Th right>Stock</Th>
              <Th right>Lotes</Th>
              <Th right>Desc.</Th>
              <Th right>Ventas</Th>
              <Th right>Tokens</Th>
              <Th>Cobró a fans</Th>
              <Th right>Valor.</Th>
              <Th right>Disputas</Th>
              <Th right>Cancel.</Th>
              <Th right>Libera en</Th>
              <Th>Última venta</Th>
            </tr>
          </thead>
          <tbody>
            {dash.byDistributor.map((d) => (
              <tr key={d.id} className="border-t border-border/40 hover:bg-muted/30">
                <Td>
                  <Link href={`${BASE}/${d.id}`} className="font-semibold hover:underline">{d.legalName}</Link>
                  <span className="block text-[11px] text-muted-foreground">{d.countries.map(countryFlag).join(' ')} · {d._count.accounts} métodos</span>
                </Td>
                <Td>
                  <StatusPill d={d} />
                </Td>
                <Td right>{formatTokens(d.stockTokens)}</Td>
                <Td right>{d.lotCents ? formatMoney(d.lotCents) : '—'}</Td>
                <Td right>−{d.discount.toLocaleString('es')}%</Td>
                <Td right>{d.sales}<span className="text-muted-foreground">/{d.created}</span></Td>
                <Td right>{formatTokens(d.tokens)}</Td>
                <Td className="whitespace-nowrap">{formatAmounts(d.amounts)}</Td>
                <Td right>{d.positive == null ? '—' : `${d.positive}%`}</Td>
                <Td right className={d.disputes ? 'text-rose-500' : ''}>{d.disputes}</Td>
                <Td right>{d.cancelRate == null ? '—' : `${d.cancelRate}%`}</Td>
                <Td right>{fmtMin(d.medianReleaseMin)}</Td>
                <Td>{d.lastSaleAt ? formatDateTime(d.lastSaleAt.toISOString()) : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Por pais */}
        <section className="space-y-2">
          <h2 className="font-semibold">Por país</h2>
          <TableWrap>
            <thead>
              <tr>
                <Th>País</Th>
                <Th right>Distrib.</Th>
                <Th right>Métodos</Th>
                <Th right>Ventas</Th>
                <Th right>Tokens</Th>
                <Th>Pagado por fans</Th>
              </tr>
            </thead>
            <tbody>
              {[...coverage.entries()]
                .sort((a, b) => (salesByCountry.get(b[0])?.tokens ?? 0) - (salesByCountry.get(a[0])?.tokens ?? 0) || countryName(a[0]).localeCompare(countryName(b[0]), 'es'))
                .map(([c, cov]) => {
                  const s = salesByCountry.get(c);
                  return (
                    <tr key={c} className="border-t border-border/40">
                      <Td>
                        <Link href={href({ tab: 'ventas', pais: c, periodo: period })} className="hover:underline">
                          {countryFlag(c)} {countryName(c)}
                        </Link>
                      </Td>
                      <Td right>{cov.distributors.size}</Td>
                      <Td right title={[...cov.methods].map(paymentMethodLabel).join(', ')}>{cov.methods.size}</Td>
                      <Td right>{s?.sales ?? 0}</Td>
                      <Td right>{formatTokens(s?.tokens ?? 0)}</Td>
                      <Td className="whitespace-nowrap">{s ? formatAmounts(s.amounts) : '—'}</Td>
                    </tr>
                  );
                })}
            </tbody>
          </TableWrap>
        </section>

        {/* Por metodo */}
        <section className="space-y-2">
          <h2 className="font-semibold">Por método de pago</h2>
          <TableWrap>
            <thead>
              <tr>
                <Th>Método</Th>
                <Th right>Ventas</Th>
                <Th right>Tokens</Th>
                <Th>Pagado por fans</Th>
                <Th right>Fans</Th>
              </tr>
            </thead>
            <tbody>
              {dash.byMethod.length === 0 ? (
                <tr><Td colSpan={5} className="text-center text-muted-foreground">Sin ventas en el periodo.</Td></tr>
              ) : (
                dash.byMethod.map((m) => (
                  <tr key={m.key} className="border-t border-border/40">
                    <Td>
                      <Link href={href({ tab: 'ventas', metodo: m.key, periodo: period })} className="hover:underline">{paymentMethodLabel(m.key)}</Link>
                    </Td>
                    <Td right>{m.sales}</Td>
                    <Td right>{formatTokens(m.tokens)}</Td>
                    <Td className="whitespace-nowrap">{formatAmounts(m.amounts)}</Td>
                    <Td right>{m.fans}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        </section>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Lo que pagan los fans se muestra en su moneda, sin pasarlo a dólares: el cambio real de cada país puede ser
        distinto del oficial. Lo que te pagan a ti (los lotes) sí es en dólares exactos.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VENTAS A FANS
// ---------------------------------------------------------------------------

async function SalesTab({ params, period }: { params: Params; period: PeriodKey }) {
  const page = Math.max(1, Number(params.p) || 1);
  const since = params.periodo === 'todo' ? null : new Date(Date.now() - PERIODS[period] * 24 * 3600_000);
  const where = salesWhere(params, since);
  const [rows, total, sums, byStatus, distributors, accounts] = await Promise.all([
    prisma.distributorSale.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: SALE_LIST_INCLUDE }),
    prisma.distributorSale.count({ where }),
    prisma.distributorSale.aggregate({ where: { ...where, status: 'COMPLETED' }, _sum: { tokens: true }, _count: true }),
    prisma.distributorSale.groupBy({ by: ['status'], where: salesWhere({ ...params, estado: undefined }, since), _count: true }),
    prisma.distributor.findMany({ select: { id: true, legalName: true }, orderBy: { legalName: 'asc' } }),
    prisma.distributorAccount.findMany({ select: { country: true, method: true }, distinct: ['country', 'method'] }),
  ]);
  const countries = [...new Set(accounts.map((a) => a.country))].sort();
  const methods = PAYMENT_METHODS.filter((m) => accounts.some((a) => a.method === m.key));
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const keep = { tab: 'ventas', periodo: params.periodo, estado: params.estado, dist: params.dist, pais: params.pais, metodo: params.metodo, q: params.q };
  const exportQs = new URLSearchParams(Object.entries({ ...keep, tab: undefined, tipo: 'ventas' }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pedidos de fans a distribuidores (compra protegida). El fan paga al distribuidor en su moneda; tú no recibes ese
        dinero. Aquí ves cada pedido, su comprobante y en qué quedó.
      </p>
      {/* Filtros */}
      <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-border/60 bg-card p-3 text-sm" action={BASE}>
        <input type="hidden" name="tab" value="ventas" />
        <Select name="periodo" label="Periodo" value={params.periodo ?? '30'} options={[['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['365', '1 año'], ['todo', 'Todo']]} />
        <Select name="dist" label="Distribuidor" value={params.dist ?? ''} options={[['', 'Todos'], ...distributors.map((d) => [d.id, d.legalName] as [string, string])]} />
        <Select name="pais" label="País" value={params.pais ?? ''} options={[['', 'Todos'], ...countries.map((c) => [c, `${countryFlag(c)} ${countryName(c)}`] as [string, string])]} />
        <Select name="metodo" label="Método" value={params.metodo ?? ''} options={[['', 'Todos'], ...methods.map((m) => [m.key, m.label] as [string, string])]} />
        <Select name="estado" label="Estado" value={params.estado ?? ''} options={[['', 'Todos'], ...SALE_STATUSES.map((s) => [s, SALE_STATUS_LABEL[s]] as [string, string])]} />
        <label className="space-y-1 text-[11px] text-muted-foreground">
          Buscar
          <input name="q" defaultValue={params.q ?? ''} placeholder="@fan, ref. o pedido" className="block h-9 w-44 rounded-lg border border-border/60 bg-background px-2 text-sm text-foreground" />
        </label>
        <button className="h-9 rounded-lg bg-primary px-4 font-semibold text-primary-foreground">Filtrar</button>
        <Link href={`${BASE}?tab=ventas`} className="h-9 px-2 leading-9 text-muted-foreground hover:text-foreground">Limpiar</Link>
        <a href={`${BASE}/export?${exportQs}`} className="ml-auto flex h-9 items-center gap-1 rounded-lg border border-border/60 px-3 hover:bg-muted/40">
          <Download className="h-4 w-4" /> CSV
        </a>
      </form>

      <div className="flex flex-wrap gap-1.5 text-xs">
        {SALE_STATUSES.map((s) => (
          <Link key={s} href={href({ ...keep, estado: params.estado === s ? undefined : s })} className={cn('rounded-full border px-2.5 py-1', params.estado === s ? 'border-primary bg-primary/10' : 'border-border/60 text-muted-foreground')}>
            {SALE_STATUS_LABEL[s]} · {count(s)}
          </Link>
        ))}
        <span className="ml-auto self-center text-muted-foreground">
          {total} pedidos · {sums._count} completados · {formatTokens(sums._sum.tokens ?? 0)} tk entregados
        </span>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Pedido</Th>
            <Th>Distribuidor</Th>
            <Th>Fan</Th>
            <Th>País · método</Th>
            <Th right>Tokens</Th>
            <Th right>Pagó</Th>
            <Th right>100 tk a</Th>
            <Th>Estado</Th>
            <Th right>Libera en</Th>
            <Th>Compr.</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><Td colSpan={11} className="py-8 text-center text-muted-foreground">No hay ventas con estos filtros.</Td></tr>
          ) : (
            rows.map((s) => {
              const rel = s.paidAt && s.completedAt ? Math.round((s.completedAt.getTime() - s.paidAt.getTime()) / 60_000) : null;
              return (
                <tr key={s.id} className="border-t border-border/40 hover:bg-muted/30">
                  <Td className="whitespace-nowrap">{formatDateTime(s.createdAt.toISOString())}</Td>
                  <Td><Link href={`/compra-tokens/${s.id}`} className="font-mono text-xs hover:underline">{s.id.slice(-8).toUpperCase()}</Link></Td>
                  <Td><Link href={`${BASE}/${s.distributor.id}`} className="hover:underline">{s.distributor.legalName}</Link></Td>
                  <Td><Link href={`/admin/users/${s.fan.id}`} className="hover:underline">@{s.fan.username ?? s.fan.name}</Link></Td>
                  <Td className="whitespace-nowrap">{countryFlag(s.account.country)} {paymentMethodLabel(s.account.method)}</Td>
                  <Td right>{formatTokens(s.tokens)}</Td>
                  <Td right className="whitespace-nowrap">{formatLocal(s.amount, s.currency)}</Td>
                  <Td right className="whitespace-nowrap text-muted-foreground">{formatLocal(Math.round((s.amount / s.tokens) * 100), s.currency)}</Td>
                  <Td><SaleStatus status={s.status} /></Td>
                  <Td right>{rel == null ? '—' : rel < 60 ? `${rel} min` : `${Math.round(rel / 6) / 10} h`}</Td>
                  <Td>{s.paymentProofKey ? <Link href={`/compra-tokens/${s.id}`} className="text-primary">Ver</Link> : '—'}</Td>
                </tr>
              );
            })
          )}
        </tbody>
      </TableWrap>

      <Pager page={page} pages={pages} hrefFor={(p) => href({ ...keep, p: String(p) })} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// LOTES
// ---------------------------------------------------------------------------

async function LotsTab({ params }: { params: Params }) {
  const page = Math.max(1, Number(params.p) || 1);
  const estado = ['PENDING', 'PAID', 'CANCELLED'].includes(params.estado ?? '') ? (params.estado as 'PENDING' | 'PAID' | 'CANCELLED') : undefined;
  const where = { ...(estado ? { status: estado } : {}), ...(params.dist ? { distributorId: params.dist } : {}) };
  const [rows, total, byStatus, distributors, pending, perDist] = await Promise.all([
    prisma.distributorOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { distributor: { select: { id: true, legalName: true, country: true } } },
    }),
    prisma.distributorOrder.count({ where }),
    prisma.distributorOrder.groupBy({ by: ['status'], where: params.dist ? { distributorId: params.dist } : {}, _count: true, _sum: { amountCents: true, tokens: true } }),
    prisma.distributor.findMany({ select: { id: true, legalName: true, country: true, stockTokens: true }, orderBy: { legalName: 'asc' } }),
    prisma.distributorOrder.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { distributor: { select: { legalName: true, country: true } } },
    }),
    prisma.distributorOrder.groupBy({
      by: ['distributorId'],
      where: { status: 'PAID' },
      _sum: { amountCents: true, tokens: true },
      _count: true,
      _max: { paidAt: true },
    }),
  ]);
  const st = (s: string) => byStatus.find((b) => b.status === s);
  const perDistRows = distributors
    .map((d) => ({ d, g: perDist.find((x) => x.distributorId === d.id) }))
    .sort((a, b) => (b.g?._sum.amountCents ?? 0) - (a.g?._sum.amountCents ?? 0));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const keep = { tab: 'lotes', estado, dist: params.dist };
  const tiers = discountTiers(config.distributors.discountPercent);
  const exportQs = new URLSearchParams(Object.entries({ tipo: 'lotes', estado, dist: params.dist }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tú vendes tokens a los distribuidores en lotes. Te pagan en dólares por transferencia o USDT y te envían el recibo.
        Cuando compruebas que el dinero llegó y confirmas, los tokens pasan a su stock para venderlos a los fans.
      </p>

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Lotes pendientes ({pending.length}) · {pending.filter((o) => o.proofKey).length} con recibo para revisar</h2>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-amber-500/40 bg-card">
            {(await pendingLotRows(pending)).map((o) => (
              <PendingOrderRow key={o.id} order={o} />
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Cobrado (todo)" value={formatMoney(st('PAID')?._sum.amountCents ?? 0)} sub={`${st('PAID')?._count ?? 0} lotes · ${formatTokens(st('PAID')?._sum.tokens ?? 0)} tk`} tone="good" />
        <Kpi label="Esperando pago" value={formatMoney(st('PENDING')?._sum.amountCents ?? 0)} sub={`${st('PENDING')?._count ?? 0} lotes`} tone={st('PENDING') ? 'warn' : undefined} />
        <Kpi label="Cancelados" value={String(st('CANCELLED')?._count ?? 0)} />
      </div>

      <section className="rounded-2xl border border-border/60 bg-card p-4 text-sm">
        <p className="font-semibold">Descuento progresivo por tamaño del lote</p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {tiers.map((t) => {
            const m = lotMath(t.minTokens, config.economy.tokenValueCents, t.percent);
            return (
              <div key={t.minTokens} className="rounded-xl bg-muted/40 p-2 text-center">
                <p className="text-lg font-bold text-state-connected">−{t.percent}%</p>
                <p className="text-[11px] text-muted-foreground">desde {formatTokens(t.minTokens)} tk</p>
                <p className="text-[11px]">{formatMoney(m.costCents)}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          El tope es −{config.distributors.discountPercent}% (DISTRIBUTOR_DISCOUNT_PERCENT, nunca más de 20). Ni con el
          descuento máximo se paga menos de lo que se le da al creador.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Lo que te ha comprado cada distribuidor</h2>
        <TableWrap>
          <thead>
            <tr>
              <Th>Distribuidor</Th>
              <Th right>Lotes pagados</Th>
              <Th right>Tokens</Th>
              <Th right>Te pagó</Th>
              <Th right>Desc. medio</Th>
              <Th right>Stock sin vender</Th>
              <Th>Último lote</Th>
            </tr>
          </thead>
          <tbody>
            {perDistRows.map(({ d, g }) => {
              const tk = g?._sum.tokens ?? 0;
              const paid = g?._sum.amountCents ?? 0;
              return (
                <tr key={d.id} className="border-t border-border/40 hover:bg-muted/30">
                  <Td>
                    <Link href={href({ tab: 'lotes', dist: d.id })} className="hover:underline">{countryFlag(d.country)} {d.legalName}</Link>
                  </Td>
                  <Td right>{g?._count ?? 0}</Td>
                  <Td right>{formatTokens(tk)}</Td>
                  <Td right>{paid ? formatMoney(paid) : '—'}</Td>
                  <Td right>{tk ? `−${(Math.round((1 - paid / (tk * config.economy.tokenValueCents)) * 1000) / 10).toLocaleString('es')}%` : '—'}</Td>
                  <Td right>{formatTokens(d.stockTokens)}</Td>
                  <Td className="whitespace-nowrap">{g?._max.paidAt ? formatDateTime(g._max.paidAt.toISOString()) : '—'}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </section>

      <h2 className="font-semibold">Todos los lotes</h2>
      <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-border/60 bg-card p-3 text-sm" action={BASE}>
        <input type="hidden" name="tab" value="lotes" />
        <Select name="dist" label="Distribuidor" value={params.dist ?? ''} options={[['', 'Todos'], ...distributors.map((d) => [d.id, d.legalName] as [string, string])]} />
        <Select name="estado" label="Estado" value={estado ?? ''} options={[['', 'Todos'], ['PENDING', 'Esperando pago'], ['PAID', 'Pagado'], ['CANCELLED', 'Cancelado']]} />
        <button className="h-9 rounded-lg bg-primary px-4 font-semibold text-primary-foreground">Filtrar</button>
        <a href={`${BASE}/export?${exportQs}`} className="ml-auto flex h-9 items-center gap-1 rounded-lg border border-border/60 px-3 hover:bg-muted/40">
          <Download className="h-4 w-4" /> CSV
        </a>
      </form>

      <TableWrap>
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Lote</Th>
            <Th>Distribuidor</Th>
            <Th right>Tokens</Th>
            <Th right>Descuento</Th>
            <Th right>Importe</Th>
            <Th right>Precio/100 tk</Th>
            <Th>Pago</Th>
            <Th>Ref.</Th>
            <Th>Recibo</Th>
            <Th>Estado</Th>
            <Th>Confirmado</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><Td colSpan={12} className="py-8 text-center text-muted-foreground">No hay lotes.</Td></tr>
          ) : (
            rows.map((o) => (
              <tr key={o.id} className="border-t border-border/40 hover:bg-muted/30">
                <Td className="whitespace-nowrap">{formatDateTime(o.createdAt.toISOString())}</Td>
                <Td className="font-mono text-xs">{o.id.slice(-8).toUpperCase()}</Td>
                <Td><Link href={`${BASE}/${o.distributor.id}`} className="hover:underline">{countryFlag(o.distributor.country)} {o.distributor.legalName}</Link></Td>
                <Td right>{formatTokens(o.tokens)}</Td>
                <Td right>−{o.discountPercent}%</Td>
                <Td right>{formatMoney(o.amountCents)}</Td>
                <Td right>{formatMoney(Math.round((o.amountCents / o.tokens) * 100))}</Td>
                <Td>{o.paymentMethod === 'USDT' ? 'USDT' : 'Transferencia'}</Td>
                <Td className="max-w-[10rem] truncate font-mono text-xs">{o.paymentRef ?? '—'}</Td>
                <Td>{o.proofKey ? <a href={`${BASE}/recibo/${o.id}`} target="_blank" rel="noreferrer" className="text-primary">Ver</a> : '—'}</Td>
                <Td>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', o.status === 'PAID' ? 'bg-state-connected/15 text-state-connected' : o.status === 'PENDING' ? 'bg-amber-500/15 text-amber-500' : 'bg-muted text-muted-foreground')}>
                    {o.status === 'PAID' ? 'Pagado' : o.status === 'PENDING' ? (o.proofKey ? 'Recibo por revisar' : 'Esperando pago') : o.rejectReason ? 'Rechazado' : 'Cancelado'}
                  </span>
                  {o.rejectReason && <span className="mt-0.5 block max-w-[12rem] text-[11px] text-muted-foreground">{o.rejectReason}</span>}
                </Td>
                <Td className="whitespace-nowrap">{o.paidAt ? formatDateTime(o.paidAt.toISOString()) : '—'}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>
      <Pager page={page} pages={pages} hrefFor={(p) => href({ ...keep, p: String(p) })} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DISPUTAS: todas las pruebas juntas para decidir
// ---------------------------------------------------------------------------

async function DisputesTab() {
  const [open, resolved] = await Promise.all([
    prisma.distributorSale.findMany({
      where: { status: 'DISPUTED' },
      orderBy: { disputedAt: 'asc' },
      include: {
        distributor: { select: { id: true, legalName: true, userId: true, user: { select: { username: true } } } },
        fan: { select: { id: true, username: true, name: true, createdAt: true } },
        account: { select: { country: true, method: true, details: true } },
      },
    }),
    prisma.distributorSale.findMany({
      where: { disputeBy: { not: null }, status: { in: ['COMPLETED', 'CANCELLED'] } },
      orderBy: { resolvedAt: { sort: 'desc', nulls: 'last' } },
      take: 30,
      include: { distributor: { select: { id: true, legalName: true } }, fan: { select: { id: true, username: true } } },
    }),
  ]);

  // Historial de cada parte: compras/ventas completadas y disputas anteriores.
  const fanIds = [...new Set(open.map((s) => s.fanId))];
  const distIds = [...new Set(open.map((s) => s.distributorId))];
  const [fanDone, fanDisputes, distDone, distDisputes, chats, resolvers] = await Promise.all([
    prisma.distributorSale.groupBy({ by: ['fanId'], where: { fanId: { in: fanIds }, status: 'COMPLETED' }, _count: true }),
    prisma.distributorSale.groupBy({ by: ['fanId'], where: { fanId: { in: fanIds }, disputeBy: { not: null } }, _count: true }),
    prisma.distributorSale.groupBy({ by: ['distributorId'], where: { distributorId: { in: distIds }, status: 'COMPLETED' }, _count: true }),
    prisma.distributorSale.groupBy({ by: ['distributorId'], where: { distributorId: { in: distIds }, disputeBy: { not: null } }, _count: true }),
    prisma.peerChat.findMany({
      where: { OR: open.map((s) => peerPair(s.fanId, s.distributor.userId)) },
      select: { id: true, userAId: true, userBId: true },
    }),
    prisma.user.findMany({
      where: { id: { in: resolved.map((r) => r.resolvedById).filter((x): x is string => Boolean(x)) } },
      select: { id: true, name: true, username: true },
    }),
  ]);
  const byFan = (rows: { fanId: string; _count: number }[]) => new Map(rows.map((r) => [r.fanId, r._count]));
  const byDist = (rows: { distributorId: string; _count: number }[]) => new Map(rows.map((r) => [r.distributorId, r._count]));
  const [fanDoneN, fanDisputesN, distDoneN, distDisputesN] = [byFan(fanDone), byFan(fanDisputes), byDist(distDone), byDist(distDisputes)];
  const urls = new Map<string, string | null>();
  for (const s of open) {
    if (s.paymentProofKey) urls.set(`p:${s.id}`, await resolveAssetUrl(s.paymentProofKey, { isPublic: false }));
    if (s.disputeEvidenceKey) urls.set(`e:${s.id}`, await resolveAssetUrl(s.disputeEvidenceKey, { isPublic: false }));
  }
  const chatFor = (fanId: string, distUserId: string) => {
    const p = peerPair(fanId, distUserId);
    return chats.find((c) => c.userAId === p.userAId && c.userBId === p.userBId)?.id ?? null;
  };
  const fmtAt = (d: Date | null) => (d ? formatDateTime(d.toISOString()) : '—');

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-semibold">Abiertas ({open.length})</h2>
        {open.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">No hay disputas abiertas.</p>
        ) : (
          open.map((s) => {
            const proof = urls.get(`p:${s.id}`);
            const evidence = urls.get(`e:${s.id}`);
            const chatId = chatFor(s.fanId, s.distributor.userId);
            const fanAgeDays = Math.floor((Date.now() - s.fan.createdAt.getTime()) / 86_400_000);
            return (
              <article key={s.id} className="space-y-4 rounded-2xl border border-rose-500/40 bg-card p-4 sm:p-5">
                {/* Cabecera */}
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-bold">
                      {formatTokens(s.tokens)} tokens · {formatLocal(s.amount, s.currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Pedido{' '}
                      <Link href={`/compra-tokens/${s.id}`} className="font-mono hover:underline">{s.id.slice(-8).toUpperCase()}</Link> ·{' '}
                      {countryFlag(s.account.country)} {paymentMethodLabel(s.account.method)}
                    </p>
                  </div>
                  <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-500">
                    Abierta por {s.disputeBy === 'FAN' ? 'el fan' : 'el distribuidor'}
                  </span>
                </header>

                <blockquote className="rounded-xl border-l-4 border-rose-500 bg-rose-500/5 px-3 py-2 text-sm">
                  «{s.disputeReason}»
                </blockquote>

                {/* Partes */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Party
                    role="Fan (comprador)"
                    name={`@${s.fan.username ?? s.fan.name}`}
                    href={`/admin/users/${s.fan.id}`}
                    lines={[
                      `Cuenta de hace ${fanAgeDays} ${fanAgeDays === 1 ? 'día' : 'días'}`,
                      `${fanDoneN.get(s.fanId) ?? 0} compras completadas`,
                      `${fanDisputesN.get(s.fanId) ?? 0} disputas en total`,
                    ]}
                  />
                  <Party
                    role="Distribuidor (vendedor)"
                    name={s.distributor.legalName}
                    href={`${BASE}/${s.distributor.id}`}
                    lines={[
                      `@${s.distributor.user.username ?? '—'}`,
                      `${distDoneN.get(s.distributorId) ?? 0} ventas completadas`,
                      `${distDisputesN.get(s.distributorId) ?? 0} disputas en total`,
                    ]}
                  />
                </div>

                {/* Pago */}
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="space-y-1 rounded-xl bg-muted/40 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dónde debía pagar el fan</p>
                    <p className="font-mono text-xs">{s.account.details}</p>
                    <p>
                      Importe: <strong>{formatLocal(s.amount, s.currency)}</strong>
                    </p>
                    <p>
                      Referencia que dio el fan: <strong className="font-mono">{s.paymentRef ?? '—'}</strong>
                    </p>
                  </div>
                  <div className="space-y-1 rounded-xl bg-muted/40 p-3 text-xs">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cronología</p>
                    <p>Pedido creado: {fmtAt(s.createdAt)}</p>
                    <p>«Ya pagué»: {fmtAt(s.paidAt)}</p>
                    <p>Disputa abierta: {fmtAt(s.disputedAt)}</p>
                    {chatId ? (
                      <Link href={`/admin/chats/peer/${chatId}`} className="mt-1 inline-block font-semibold text-primary">
                        Leer su chat →
                      </Link>
                    ) : (
                      <p className="mt-1 text-muted-foreground">No hablaron por chat.</p>
                    )}
                  </div>
                </div>

                {/* Pruebas */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Evidence title="Comprobante de pago del fan" url={proof ?? null} empty="El fan no subió comprobante." />
                  <Evidence
                    title={`Prueba de la disputa (${s.disputeBy === 'FAN' ? 'fan' : 'distribuidor'})`}
                    url={evidence ?? null}
                    empty="No subió ninguna prueba al abrir la disputa."
                  />
                </div>

                <div className="border-t border-border/60 pt-3">
                  <ResolveDispute saleId={s.id} />
                </div>
              </article>
            );
          })
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Resueltas</h2>
        <TableWrap>
          <thead>
            <tr>
              <Th>Resuelta</Th>
              <Th>Pedido</Th>
              <Th>Fan → Distribuidor</Th>
              <Th right>Tokens</Th>
              <Th>Abrió</Th>
              <Th>Decisión</Th>
              <Th>Motivo</Th>
              <Th>Por</Th>
            </tr>
          </thead>
          <tbody>
            {resolved.length === 0 ? (
              <tr><Td colSpan={8} className="py-6 text-center text-muted-foreground">Aún no hay disputas resueltas.</Td></tr>
            ) : (
              resolved.map((r) => {
                const by = resolvers.find((u) => u.id === r.resolvedById);
                return (
                  <tr key={r.id} className="border-t border-border/40">
                    <Td className="whitespace-nowrap">{fmtAt(r.resolvedAt ?? r.completedAt ?? r.cancelledAt)}</Td>
                    <Td><Link href={`/compra-tokens/${r.id}`} className="font-mono text-xs hover:underline">{r.id.slice(-8).toUpperCase()}</Link></Td>
                    <Td>@{r.fan.username} → <Link href={`${BASE}/${r.distributor.id}`} className="hover:underline">{r.distributor.legalName}</Link></Td>
                    <Td right>{formatTokens(r.tokens)}</Td>
                    <Td>{r.disputeBy === 'FAN' ? 'Fan' : 'Distribuidor'}</Td>
                    <Td><SaleStatus status={r.status} /></Td>
                    <Td className="max-w-xs text-xs text-muted-foreground">{r.resolutionNote ?? '—'}</Td>
                    <Td className="text-xs">{by ? (by.username ? `@${by.username}` : by.name) : '—'}</Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </section>
    </div>
  );
}

function Party({ role, name, href, lines }: { role: string; name: string; href: string; lines: string[] }) {
  return (
    <div className="rounded-xl border border-border/60 p-3 text-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{role}</p>
      <Link href={href} className="font-semibold hover:underline">{name}</Link>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </div>
  );
}

function Evidence({ title, url, empty }: { title: string; url: string | null; empty: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold">{title}</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-border/60 bg-muted/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={title} className="max-h-96 w-full object-contain" />
          <span className="block px-2 py-1 text-center text-[11px] text-muted-foreground">Abrir en grande</span>
        </a>
      ) : (
        <p className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border/60 px-3 text-center text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function FlowHeader({ step, title, desc, link }: { step: string; title: string; desc: string; link: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">{step}</span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <Link href={link.href} className="text-xs font-semibold text-primary">{link.label} →</Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GESTION
// ---------------------------------------------------------------------------

async function ManageTab() {
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600_000);
  const [distributors, sent30] = await Promise.all([
    prisma.distributor.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { username: true, email: true } },
        accounts: { where: { active: true }, select: { method: true } },
      },
    }),
    prisma.distributorTransfer.groupBy({ by: ['distributorId'], where: { createdAt: { gte: monthAgo } }, _sum: { tokens: true } }),
  ]);
  const sentBy = new Map(sent30.map((s) => [s.distributorId, s._sum.tokens ?? 0]));
  const tiers = discountTiers(config.distributors.discountPercent);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/60 bg-card p-5 text-sm">
        <h2 className="font-semibold">Reglas que aplica el sistema</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Lotes pagados por transferencia bancaria o USDT, nunca con tarjeta.</li>
          <li>
            Descuento progresivo por tamaño del lote: {tiers.map((t) => `−${t.percent}% desde ${formatTokens(t.minTokens)}`).join(' · ')}.
          </li>
          <li>Cada distribuidor pone sus paquetes y precios en su moneda. Se le recomienda no ganar más del 20% por venta.</li>
          <li>
            Las ventas a fans son compras protegidas: los tokens se reservan, el fan paga al distribuidor y sube el
            comprobante, y el distribuidor los libera. Fantasy Live no recibe el dinero del fan. Si no se paga en 30 min
            caduca; las disputas las resuelves en el Resumen.
          </li>
          <li>
            Cada fan recibe como mucho {formatTokens(config.distributors.fanDailyTokens)} tokens al día (
            {formatMoney(config.distributors.fanDailyTokens * config.economy.tokenValueCents)}).
          </li>
          <li>Solo a fans verificados (+18), nunca a creadores ni a países con embargo (Cuba, Irán, Corea del Norte, Siria).</li>
          <li>Los tokens recibidos cuentan como comprados: nadie puede retirarlos ni pasarlos a otro fan.</li>
        </ul>
      </section>

      <CreateDistributorForm />

      <section className="space-y-2">
        <h2 className="font-semibold">Distribuidores ({distributors.length})</h2>
        {distributors.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">Aún no hay distribuidores.</p>
        ) : (
          <div className="space-y-2">
            {distributors.map((d) => (
              <div key={d.id} className="space-y-1">
                <DistributorRow
                  d={{
                    id: d.id,
                    legalName: d.legalName,
                    country: d.country,
                    account: d.user.username ? `@${d.user.username}` : d.user.email,
                    publicContact: d.publicContact,
                    status: d.status,
                    countries: d.countries,
                    methods: [...new Set(d.accounts.map((a) => a.method))],
                    dailyLimitTokens: d.dailyLimitTokens,
                    stockTokens: d.stockTokens,
                    sent30: sentBy.get(d.id) ?? 0,
                    idVerified: Boolean(d.idVerifiedAt),
                    sanctionsChecked: Boolean(d.sanctionsCheckedAt),
                    contractSigned: Boolean(d.contractSignedAt),
                    compliant: isCompliant(d),
                  }}
                />
                <Link href={`${BASE}/${d.id}`} className="block px-1 text-right text-xs font-semibold text-primary">Ver ficha completa →</Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
