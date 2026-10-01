import 'server-only';

import type { TransactionType } from '@prisma/client';

import { basePlatformPercent } from '@/lib/deals';
import { prisma } from '@/lib/prisma';
import type { RecruiterSkip } from '@/lib/referrals';
import { EARNING_TYPES, tokensToPayoutCents, tokensToRetailCents } from '@/lib/tokens';

/**
 * VENTAS DE LAS CREADORAS DE LOS RECLUTADORES (admin).
 *
 * Cada venta sale del movimiento de ganancia de la creadora. Desde que se
 * guarda el desglose (`metadata.sale`) se sabe exacto cuanto se llevo cada
 * parte; en las ventas anteriores la parte del reclutador se empareja con su
 * comision (misma creadora, mismo instante) y el bruto se estima con la
 * comision de plataforma actual.
 */

const SALE_TYPES = EARNING_TYPES.filter((t) => t !== 'REFERRAL_EARNING');

const TYPE_LABEL: Partial<Record<TransactionType, string>> = {
  CALL_EARNING: 'Llamada',
  CONTENT_EARNING: 'Pack de contenido',
  TIP_EARNING: 'Regalo',
  SUBSCRIPTION_EARNING: 'Suscripcion',
  CONTENT_REQUEST_EARNING: 'Pedido a medida',
  MESSAGE_UNLOCK_EARNING: 'Abrir chat',
  MESSAGE_ATTACHMENT_EARNING: 'Archivo en chat',
  POST_EARNING: 'Publicacion',
};

/**
 * Si al reclutador le toca algo de la venta:
 * - earns: se lleva su %.
 * - paused / expired / out_of_quota / self: no, y por que.
 * - accruing: le toca, pero su % de esta venta es menos de un token: se le
 *   suma a lo acumulado y se le abona al completar el token.
 * - none: no le toco (ventas antiguas de importe tan pequeno que su % era 0).
 */
export type SaleRecruiterStatus = 'earns' | 'accruing' | RecruiterSkip | 'none';

export interface RecruiterSale {
  id: string;
  date: string;
  typeLabel: string;
  creator: { id: string; name: string; slug: string | null };
  recruiter: { id: string; handle: string; percent: number };
  fan: string | null;
  grossCents: number;
  creatorCents: number;
  /** Lo ya abonado a su saldo por esta venta (tokens enteros). */
  recruiterCents: number;
  /** Su % exacto de esta venta, con decimales (lo que le corresponde). */
  commissionCents: number;
  platformCents: number;
  /** El bruto de las ventas antiguas es una estimacion. */
  estimated: boolean;
  status: SaleRecruiterStatus;
  /** Fecha en que se le pago al reclutador su parte. null = aun no. */
  paidOn: string | null;
}

export interface RecruiterSalesFilters {
  recruiterId?: string;
  creatorId?: string;
  /** "2026-09" */
  month?: string;
  page?: number;
}

export const SALES_PAGE_SIZE = 50;

type SaleMeta = {
  grossTokens: number;
  creatorTokens: number;
  platformFeeTokens: number;
  payerId?: string;
  referrals?: { kind: string; userId: string; tokens: number }[];
  recruiterSkip?: RecruiterSkip | null;
  recruiterAccrued?: number;
};

export async function getRecruiterSales(filters: RecruiterSalesFilters) {
  const recruiters = await prisma.recruiter.findMany({
    where: filters.recruiterId ? { id: filters.recruiterId } : undefined,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      code: true,
      commissionPercent: true,
      months: true,
      maxCreators: true,
      user: { select: { username: true } },
      creators: {
        select: {
          id: true,
          name: true,
          username: true,
          modelProfile: { select: { stageName: true, slug: true, createdAt: true, founderNumber: true } },
        },
      },
    },
  });

  // Cada creadora con su reclutador y hasta cuando le deja comision.
  type CreatorInfo = {
    name: string;
    slug: string | null;
    recruiter: (typeof recruiters)[number];
    endsAt: Date | null;
    inQuota: boolean;
    /** % base de la plataforma (fundadores: menos), para estimar ventas antiguas. */
    platformPct: number;
  };
  const creators = new Map<string, CreatorInfo>();
  for (const r of recruiters) {
    const order = r.creators
      .filter((c) => c.modelProfile)
      .sort((a, b) => a.modelProfile!.createdAt.getTime() - b.modelProfile!.createdAt.getTime())
      .map((c) => c.id);
    for (const c of r.creators) {
      let endsAt: Date | null = null;
      if (c.modelProfile && r.months != null) {
        endsAt = new Date(c.modelProfile.createdAt);
        endsAt.setMonth(endsAt.getMonth() + r.months);
      }
      creators.set(c.id, {
        name: c.modelProfile?.stageName ?? c.name ?? c.username ?? 'Sin nombre',
        slug: c.modelProfile?.slug ?? null,
        recruiter: r,
        endsAt,
        inQuota: r.maxCreators == null || order.indexOf(c.id) < r.maxCreators,
        platformPct: basePlatformPercent(c.modelProfile),
      });
    }
  }

  const creatorIds = filters.creatorId
    ? creators.has(filters.creatorId)
      ? [filters.creatorId]
      : []
    : [...creators.keys()];

  const range = monthRange(filters.month);
  const rows = creatorIds.length
    ? await prisma.transaction.findMany({
        where: {
          userId: { in: creatorIds },
          type: { in: SALE_TYPES },
          status: 'COMPLETED',
          ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, userId: true, type: true, tokens: true, metadata: true, createdAt: true, bookingId: true },
      })
    : [];

  // Comisiones del reclutador, para las ventas sin desglose guardado.
  const recruiterUserIds = [...new Set(creatorIds.map((id) => creators.get(id)!.recruiter.userId))];
  const referralRows = recruiterUserIds.length
    ? await prisma.transaction.findMany({
        where: {
          userId: { in: recruiterUserIds },
          type: 'REFERRAL_EARNING',
          ...(range
            ? { createdAt: { gte: new Date(range.from.getTime() - 10_000), lt: new Date(range.to.getTime() + 10_000) } }
            : {}),
        },
        select: { id: true, tokens: true, metadata: true, createdAt: true },
      })
    : [];
  const referralsByCreator = new Map<string, { id: string; tokens: number; at: number }[]>();
  for (const t of referralRows) {
    const meta = (t.metadata ?? {}) as { kind?: string; fromCreatorUserId?: string };
    if ((meta.kind && meta.kind !== 'recruiter') || !meta.fromCreatorUserId) continue;
    const list = referralsByCreator.get(meta.fromCreatorUserId) ?? [];
    list.push({ id: t.id, tokens: t.tokens, at: t.createdAt.getTime() });
    referralsByCreator.set(meta.fromCreatorUserId, list);
  }
  const usedReferrals = new Set<string>();

  // Pagos a cada reclutador: una venta esta pagada si su comision es
  // anterior al ultimo pago (se le paga todo lo acumulado de una vez).
  const payouts = recruiterUserIds.length
    ? await prisma.transaction.findMany({
        where: { userId: { in: recruiterUserIds }, type: 'PAYOUT' },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, createdAt: true },
      })
    : [];
  const payoutsByUser = new Map<string, Date[]>();
  for (const p of payouts) {
    payoutsByUser.set(p.userId, [...(payoutsByUser.get(p.userId) ?? []), p.createdAt]);
  }

  const payerIds = new Set<string>();

  const all = rows.map((t) => {
    const info = creators.get(t.userId)!;
    const r = info.recruiter;
    const sale = ((t.metadata ?? {}) as { sale?: SaleMeta }).sale;
    const creatorTokens = t.tokens;

    let grossTokens: number;
    let recruiterTokens: number;
    let estimated = false;
    let skip: RecruiterSkip | null = null;
    let accrued = 0;

    if (sale) {
      grossTokens = sale.grossTokens;
      recruiterTokens = (sale.referrals ?? [])
        .filter((x) => x.kind === 'recruiter' && x.userId === r.userId)
        .reduce((s, x) => s + x.tokens, 0);
      skip = sale.recruiterSkip ?? null;
      accrued = sale.recruiterAccrued ?? 0;
      if (sale.payerId) payerIds.add(sale.payerId);
    } else {
      const at = t.createdAt.getTime();
      const match = (referralsByCreator.get(t.userId) ?? [])
        .filter((x) => !usedReferrals.has(x.id) && Math.abs(x.at - at) < 5_000)
        .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
      if (match) usedReferrals.add(match.id);
      recruiterTokens = match?.tokens ?? 0;
      estimated = true;
      grossTokens = Math.max(
        creatorTokens + recruiterTokens,
        Math.round((creatorTokens * 100) / Math.max(1, 100 - info.platformPct)),
      );
    }

    let status: SaleRecruiterStatus;
    if (recruiterTokens > 0) status = 'earns';
    else if (skip) status = skip;
    else if (accrued > 0) status = 'accruing';
    else if (info.endsAt && t.createdAt > info.endsAt) status = 'expired';
    else if (!info.inQuota) status = 'out_of_quota';
    else status = 'none';

    let paidOn: string | null = null;
    if (recruiterTokens > 0) {
      const next = (payoutsByUser.get(r.userId) ?? []).find((d) => d >= t.createdAt);
      paidOn = next ? next.toISOString() : null;
    }

    const grossCents = tokensToRetailCents(grossTokens);
    return {
      id: t.id,
      date: t.createdAt.toISOString(),
      typeLabel: t.bookingId ? 'Reserva' : (TYPE_LABEL[t.type] ?? t.type),
      creator: { id: t.userId, name: info.name, slug: info.slug },
      recruiter: { id: r.id, handle: r.user.username ?? r.code, percent: r.commissionPercent },
      payerId: sale?.payerId ?? null,
      grossCents,
      creatorCents: tokensToPayoutCents(creatorTokens),
      recruiterCents: tokensToPayoutCents(recruiterTokens),
      commissionCents: (grossCents * r.commissionPercent) / 100,
      // Lo que queda para la plataforma (incluye, si la hay, la comision de embajadora).
      platformCents:
        tokensToRetailCents(grossTokens) - tokensToPayoutCents(creatorTokens) - tokensToPayoutCents(recruiterTokens),
      estimated,
      status,
      paidOn,
    };
  });

  const summary = {
    count: all.length,
    grossCents: sum(all, (s) => s.grossCents),
    creatorCents: sum(all, (s) => s.creatorCents),
    recruiterCents: sum(all, (s) => s.recruiterCents),
    platformCents: sum(all, (s) => s.platformCents),
    recruiterPaidCents: sum(all, (s) => (s.paidOn ? s.recruiterCents : 0)),
    recruiterUnpaidCents: sum(all, (s) => (s.recruiterCents > 0 && !s.paidOn ? s.recruiterCents : 0)),
    withoutCommission: all.filter((s) => s.status !== 'earns' && s.status !== 'accruing').length,
    anyEstimated: all.some((s) => s.estimated),
    /** Cuadre: su % de todo lo vendido, y en que se queda. */
    commission: {
      fullCents: sum(all, (s) => s.commissionCents),
      earnedCents: sum(all, (s) => (s.status === 'earns' || s.status === 'accruing' ? s.commissionCents : 0)),
      excluded: (['paused', 'expired', 'out_of_quota', 'self', 'none'] as const)
        .map((reason) => ({
          reason,
          count: all.filter((s) => s.status === reason).length,
          cents: sum(all, (s) => (s.status === reason ? s.commissionCents : 0)),
        }))
        .filter((x) => x.count > 0),
    },
  };

  const page = Math.max(1, filters.page ?? 1);
  const pageRows = all.slice((page - 1) * SALES_PAGE_SIZE, page * SALES_PAGE_SIZE);

  const fans = payerIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...payerIds] } },
        select: { id: true, username: true, name: true },
      })
    : [];
  const fanName = new Map(fans.map((f) => [f.id, f.username ? `@${f.username}` : (f.name ?? 'Fan')]));

  const sales: RecruiterSale[] = pageRows.map(({ payerId, ...s }) => ({
    ...s,
    fan: payerId ? (fanName.get(payerId) ?? null) : null,
  }));

  return {
    sales,
    summary,
    page,
    pages: Math.max(1, Math.ceil(all.length / SALES_PAGE_SIZE)),
    recruiters: recruiters.map((r) => ({ id: r.id, handle: r.user.username ?? r.code })),
    creators: [...creators.entries()].map(([id, c]) => ({ id, name: c.name, recruiterId: c.recruiter.id })),
  };
}

function sum<T>(list: T[], f: (x: T) => number) {
  return list.reduce((acc, x) => acc + f(x), 0);
}

function monthRange(month?: string) {
  const m = month?.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { from: new Date(Date.UTC(y, mo, 1)), to: new Date(Date.UTC(y, mo + 1, 1)) };
}
