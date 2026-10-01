import 'server-only';

import { config } from '@/lib/config';
import { discountForTokens } from '@/lib/distributor-shared';
import { ORDER_LIMITS } from '@/lib/distributors';
import { prisma } from '@/lib/prisma';
import { SALE_STATUSES } from '@/lib/distributor-dashboard-labels';

export { SALE_STATUS_LABEL, SALE_STATUSES } from '@/lib/distributor-dashboard-labels';

/**
 * Numeros del panel de distribuidores (admin). Solo datos exactos:
 *   - lotes: lo que te pagan en dolares;
 *   - ventas a fans: tokens y lo que pago el fan en SU moneda, sumado por moneda.
 * No se pasa nada a dolares con el cambio del dia: en paises con cambio
 * paralelo (Venezuela, Argentina...) daria cifras falsas.
 */

export const PERIODS = { '7': 7, '30': 30, '90': 90, '365': 365 } as const;
export type PeriodKey = keyof typeof PERIODS;

export function parsePeriod(v: string | undefined): PeriodKey {
  return v && v in PERIODS ? (v as PeriodKey) : '30';
}

/** Importes por moneda: { MXN: 120000, USD: 4500 } (centesimas). */
export type AmountsByCurrency = Record<string, number>;

function addAmount(acc: AmountsByCurrency, currency: string, amount: number) {
  acc[currency] = (acc[currency] ?? 0) + amount;
}

/**
 * Descuento medio con el que compro cada distribuidor: lo que pago en sus
 * lotes frente a lo que valen esos tokens en la web. Es una media de sus lotes.
 */
export async function averageDiscounts(distributorIds?: string[]) {
  const lots = await prisma.distributorOrder.groupBy({
    by: ['distributorId'],
    where: { status: 'PAID', ...(distributorIds ? { distributorId: { in: distributorIds } } : {}) },
    _sum: { tokens: true, amountCents: true },
  });
  const map = new Map(lots.map((l) => [l.distributorId, l._sum]));
  const fallback = discountForTokens(ORDER_LIMITS.minTokens, config.distributors.discountPercent);
  return {
    get: (id: string) => {
      const l = map.get(id);
      const retail = (l?.tokens ?? 0) * config.economy.tokenValueCents;
      return retail ? Math.max(0, Math.round((1 - (l?.amountCents ?? 0) / retail) * 1000) / 10) : fallback;
    },
  };
}

function bucketDays(period: number) {
  return period <= 31 ? 1 : period <= 120 ? 7 : 30;
}

export async function getDistributorDashboard(periodKey: PeriodKey) {
  const days = PERIODS[periodKey];
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 3600_000);
  const tv = config.economy.tokenValueCents;

  const [distributors, sales, lots, openSales] = await Promise.all([
    prisma.distributor.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        legalName: true,
        country: true,
        countries: true,
        status: true,
        isAvailable: true,
        stockTokens: true,
        idVerifiedAt: true,
        sanctionsCheckedAt: true,
        contractSignedAt: true,
        createdAt: true,
        _count: { select: { accounts: { where: { active: true } } } },
      },
    }),
    prisma.distributorSale.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        distributorId: true,
        fanId: true,
        tokens: true,
        amount: true,
        currency: true,
        status: true,
        rating: true,
        createdAt: true,
        paidAt: true,
        completedAt: true,
        cancelReason: true,
        disputeBy: true,
        account: { select: { country: true, method: true } },
      },
    }),
    prisma.distributorOrder.findMany({
      where: { OR: [{ createdAt: { gte: since } }, { paidAt: { gte: since } }] },
      select: { distributorId: true, tokens: true, amountCents: true, status: true, paidAt: true, createdAt: true },
    }),
    prisma.distributorSale.aggregate({
      where: { status: { in: ['AWAITING_PAYMENT', 'PAID', 'DISPUTED'] } },
      _sum: { tokens: true },
      _count: true,
    }),
  ]);
  const disc = await averageDiscounts();

  // --- Totales -------------------------------------------------------------
  const completed = sales.filter((s) => s.status === 'COMPLETED');
  const cancelled = sales.filter((s) => s.status === 'CANCELLED');
  const expired = cancelled.filter((s) => s.cancelReason === 'No se pagó a tiempo');
  const disputedEver = sales.filter((s) => s.disputeBy != null);
  const paidLots = lots.filter((l) => l.status === 'PAID' && l.paidAt && l.paidAt >= since);
  const pendingLots = lots.filter((l) => l.status === 'PENDING');

  const fanAmounts: AmountsByCurrency = {};
  for (const s of completed) addAmount(fanAmounts, s.currency, s.amount);
  const releaseMinutes = completed
    .filter((s) => s.paidAt && s.completedAt)
    .map((s) => (s.completedAt!.getTime() - s.paidAt!.getTime()) / 60_000);
  const rated = completed.filter((s) => s.rating != null);
  const lotTokens = paidLots.reduce((n, l) => n + l.tokens, 0);
  const lotCents = paidLots.reduce((n, l) => n + l.amountCents, 0);
  const tokensDelivered = completed.reduce((n, s) => n + s.tokens, 0);

  const totals = {
    lotRevenueCents: lotCents,
    lotTokens,
    lotCount: paidLots.length,
    /** Descuento medio de los lotes cobrados en el periodo (exacto: pagado vs. valor en la web). */
    lotAvgDiscount: lotTokens ? Math.round((1 - lotCents / (lotTokens * tv)) * 1000) / 10 : null,
    pendingLotCount: pendingLots.length,
    pendingLotCents: pendingLots.reduce((n, l) => n + l.amountCents, 0),
    salesCreated: sales.length,
    salesCompleted: completed.length,
    salesCancelled: cancelled.length,
    salesExpired: expired.length,
    salesDisputed: disputedEver.length,
    conversion: sales.length ? Math.round((completed.length / sales.length) * 100) : null,
    tokensDelivered,
    fanAmounts,
    avgTicketTokens: completed.length ? Math.round(tokensDelivered / completed.length) : null,
    medianReleaseMin: median(releaseMinutes),
    uniqueFans: new Set(completed.map((s) => s.fanId)).size,
    positive: rated.length ? Math.round((rated.filter((s) => s.rating === 1).length / rated.length) * 100) : null,
    stockTokens: distributors.reduce((n, d) => n + d.stockTokens, 0),
    reservedTokens: openSales._sum.tokens ?? 0,
    openSales: openSales._count,
    activeDistributors: distributors.filter(
      (d) => d.status === 'ACTIVE' && d.idVerifiedAt && d.sanctionsCheckedAt && d.contractSignedAt,
    ).length,
    availableNow: distributors.filter((d) => d.status === 'ACTIVE' && d.isAvailable).length,
    totalDistributors: distributors.length,
  };

  // --- Serie temporal (tokens: vendidos en lotes y entregados a fans) ------
  const step = bucketDays(days);
  const nBuckets = Math.ceil(days / step);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (nBuckets * step - 1));
  const series = Array.from({ length: nBuckets }, (_, i) => {
    const from = new Date(start.getTime() + i * step * 24 * 3600_000);
    return { from, fanTokens: 0, lotTokens: 0, lotCents: 0, sales: 0 };
  });
  const idx = (d: Date) => Math.floor((d.getTime() - start.getTime()) / (step * 24 * 3600_000));
  for (const s of completed) {
    const i = idx(s.completedAt ?? s.createdAt);
    if (series[i]) {
      series[i].fanTokens += s.tokens;
      series[i].sales += 1;
    }
  }
  for (const l of paidLots) {
    const i = idx(l.paidAt!);
    if (series[i]) {
      series[i].lotTokens += l.tokens;
      series[i].lotCents += l.amountCents;
    }
  }

  // --- Por distribuidor ----------------------------------------------------
  const byDistributor = distributors.map((d) => {
    const mine = sales.filter((s) => s.distributorId === d.id);
    const done = mine.filter((s) => s.status === 'COMPLETED');
    const amounts: AmountsByCurrency = {};
    for (const s of done) addAmount(amounts, s.currency, s.amount);
    const r = done.filter((s) => s.rating != null);
    const rel = done.filter((s) => s.paidAt && s.completedAt).map((s) => (s.completedAt!.getTime() - s.paidAt!.getTime()) / 60_000);
    const myLots = paidLots.filter((l) => l.distributorId === d.id);
    const last = mine.reduce<Date | null>((m, s) => (!m || s.createdAt > m ? s.createdAt : m), null);
    return {
      ...d,
      compliant: Boolean(d.idVerifiedAt && d.sanctionsCheckedAt && d.contractSignedAt),
      discount: disc.get(d.id),
      lotCents: myLots.reduce((n, l) => n + l.amountCents, 0),
      lotTokens: myLots.reduce((n, l) => n + l.tokens, 0),
      sales: done.length,
      created: mine.length,
      tokens: done.reduce((n, s) => n + s.tokens, 0),
      amounts,
      positive: r.length ? Math.round((r.filter((s) => s.rating === 1).length / r.length) * 100) : null,
      disputes: mine.filter((s) => s.disputeBy != null).length,
      cancelRate: mine.length ? Math.round((mine.filter((s) => s.status === 'CANCELLED').length / mine.length) * 100) : null,
      medianReleaseMin: median(rel),
      fans: new Set(done.map((s) => s.fanId)).size,
      lastSaleAt: last,
    };
  });
  byDistributor.sort((a, b) => b.tokens - a.tokens || b.lotCents - a.lotCents);

  // --- Por pais y por metodo -----------------------------------------------
  const group = (key: (s: (typeof completed)[number]) => string) => {
    const m = new Map<string, { sales: number; tokens: number; amounts: AmountsByCurrency; distributors: Set<string>; fans: Set<string> }>();
    for (const s of completed) {
      const k = key(s);
      const g = m.get(k) ?? { sales: 0, tokens: 0, amounts: {}, distributors: new Set(), fans: new Set() };
      g.sales += 1;
      g.tokens += s.tokens;
      addAmount(g.amounts, s.currency, s.amount);
      g.distributors.add(s.distributorId);
      g.fans.add(s.fanId);
      m.set(k, g);
    }
    return [...m.entries()]
      .map(([k, g]) => ({
        key: k,
        sales: g.sales,
        tokens: g.tokens,
        amounts: g.amounts,
        distributors: g.distributors.size,
        fans: g.fans.size,
      }))
      .sort((a, b) => b.tokens - a.tokens);
  };
  // Donde ofrecen los distribuidores (aunque aun no haya ventas).
  const offered = await prisma.distributorAccount.findMany({
    where: { active: true },
    select: { country: true, method: true, distributorId: true },
  });

  return {
    since,
    days,
    totals: { ...totals, stockValueCents: totals.stockTokens * tv },
    series,
    step,
    byDistributor,
    byCountry: group((s) => s.account.country),
    byMethod: group((s) => s.account.method),
    offered,
  };
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
}

// ---------------------------------------------------------------------------
// Listados con filtros (ventas a fans y lotes) — pagina y CSV
// ---------------------------------------------------------------------------

export type SaleFilters = { estado?: string; dist?: string; pais?: string; metodo?: string; q?: string; p?: string };

export function salesWhere(f: SaleFilters, since: Date | null) {
  return {
    ...(since ? { createdAt: { gte: since } } : {}),
    ...(f.estado && (SALE_STATUSES as readonly string[]).includes(f.estado) ? { status: f.estado as (typeof SALE_STATUSES)[number] } : {}),
    ...(f.dist ? { distributorId: f.dist } : {}),
    ...(f.pais || f.metodo
      ? { account: { ...(f.pais ? { country: f.pais } : {}), ...(f.metodo ? { method: f.metodo } : {}) } }
      : {}),
    ...(f.q
      ? {
          OR: [
            { id: { endsWith: f.q.toLowerCase() } },
            { paymentRef: { contains: f.q, mode: 'insensitive' as const } },
            { fan: { username: { contains: f.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
}

export const SALE_LIST_INCLUDE = {
  distributor: { select: { id: true, legalName: true } },
  fan: { select: { id: true, username: true, name: true } },
  account: { select: { country: true, method: true } },
} as const;

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
