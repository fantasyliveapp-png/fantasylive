import 'server-only';

import { prisma } from '@/lib/prisma';
import { splitPayoutFee, tokensToPayoutCents, withdrawableTokens } from '@/lib/tokens';

/** En que punto esta cada persona que trajo un reclutador. */
export type RecruitStatus = 'registered' | 'verifying' | 'active' | 'out_of_quota';

export interface RecruitRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  slug: string | null;
  status: RecruitStatus;
  /** Lo que ha generado para el reclutador (centavos). */
  earnedCents: number;
  /** Lo generado en el mes en curso (centavos). */
  earnedThisMonthCents: number;
  /** Ventas de la creadora que le han dejado comision. */
  salesCount: number;
  lastSaleAt: string | null;
  joinedAt: string;
  /** Desde cuando es creadora (cuenta la ventana de meses). */
  creatorSince: string | null;
  /** Hasta cuando cobra por ella. null = para siempre o aun no es creadora. */
  commissionEndsAt: string | null;
}

export interface RecruiterPayment {
  id: string;
  date: string;
  /** Lo que se le transfirio (ya sin la comision de retiro). */
  cents: number;
  feeCents: number;
  description: string | null;
}

export interface RecruiterOverview {
  id: string;
  code: string;
  active: boolean;
  commissionPercent: number;
  months: number | null;
  maxCreators: number | null;
  notes: string | null;
  account: { userId: string; username: string | null; email: string };
  createdAt: string;
  recruits: RecruitRow[];
  payments: RecruiterPayment[];
  /** Lo ganado en los ultimos 6 meses, del mas antiguo al actual. */
  monthly: { month: string; cents: number }[];
  totals: {
    registered: number;
    verified: number;
    salesCount: number;
    earnedCents: number;
    earnedThisMonthCents: number;
    earnedLastMonthCents: number;
    pendingCents: number;
    /** Lo que recibe si se le paga hoy: su saldo menos la comision de retiro. */
    payNowCents: number;
    paidCents: number;
  };
}

/** Todo lo de un reclutador: condiciones, a quien trajo y cuanto gano. */
export async function getRecruiterOverview(recruiterId: string): Promise<RecruiterOverview | null> {
  const recruiter = await prisma.recruiter.findUnique({
    where: { id: recruiterId },
    include: {
      user: { select: { id: true, username: true, email: true, wallet: true } },
      creators: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          createdAt: true,
          modelProfile: {
            select: { stageName: true, avatarUrl: true, slug: true, kycStatus: true, createdAt: true },
          },
        },
      },
    },
  });
  if (!recruiter) return null;

  const earnings = await prisma.transaction.findMany({
    where: { userId: recruiter.userId, type: 'REFERRAL_EARNING' },
    select: { tokens: true, metadata: true, createdAt: true },
  });

  const now = new Date();
  const thisMonth = monthKey(now);
  const lastMonth = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const monthKeys = Array.from({ length: 6 }, (_, i) =>
    monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1))),
  );
  const byMonth = new Map<string, number>(monthKeys.map((k) => [k, 0]));

  type CreatorStats = { tokens: number; monthTokens: number; sales: number; last: Date | null };
  const byCreator = new Map<string, CreatorStats>();
  let earnedTokens = 0;
  let salesCount = 0;
  for (const t of earnings) {
    const meta = (t.metadata ?? {}) as { kind?: string; fromCreatorUserId?: string };
    if (meta.kind && meta.kind !== 'recruiter') continue;
    earnedTokens += t.tokens;
    salesCount += 1;
    const key = monthKey(t.createdAt);
    if (byMonth.has(key)) byMonth.set(key, byMonth.get(key)! + t.tokens);
    if (meta.fromCreatorUserId) {
      const s = byCreator.get(meta.fromCreatorUserId) ?? { tokens: 0, monthTokens: 0, sales: 0, last: null };
      s.tokens += t.tokens;
      s.sales += 1;
      if (key === thisMonth) s.monthTokens += t.tokens;
      if (!s.last || t.createdAt > s.last) s.last = t.createdAt;
      byCreator.set(meta.fromCreatorUserId, s);
    }
  }

  // Cupo: cuentan sus N primeras creadoras por orden de alta como creadora.
  const creatorOrder = recruiter.creators
    .filter((c) => c.modelProfile)
    .sort((a, b) => a.modelProfile!.createdAt.getTime() - b.modelProfile!.createdAt.getTime())
    .map((c) => c.id);

  const recruits: RecruitRow[] = recruiter.creators.map((c) => {
    const m = c.modelProfile;
    const inQuota =
      recruiter.maxCreators == null || creatorOrder.indexOf(c.id) < recruiter.maxCreators;
    const status: RecruitStatus = !m
      ? 'registered'
      : !inQuota
        ? 'out_of_quota'
        : m.kycStatus === 'APPROVED'
          ? 'active'
          : 'verifying';
    const s = byCreator.get(c.id);
    let commissionEndsAt: string | null = null;
    if (m && recruiter.months != null) {
      const end = new Date(m.createdAt);
      end.setMonth(end.getMonth() + recruiter.months);
      commissionEndsAt = end.toISOString();
    }
    return {
      userId: c.id,
      name: m?.stageName ?? c.name ?? c.username ?? 'Sin nombre',
      avatarUrl: m?.avatarUrl ?? c.image,
      slug: m?.kycStatus === 'APPROVED' ? m.slug : null,
      status,
      earnedCents: tokensToPayoutCents(s?.tokens ?? 0),
      earnedThisMonthCents: tokensToPayoutCents(s?.monthTokens ?? 0),
      salesCount: s?.sales ?? 0,
      lastSaleAt: s?.last?.toISOString() ?? null,
      joinedAt: c.createdAt.toISOString(),
      creatorSince: m?.createdAt.toISOString() ?? null,
      commissionEndsAt,
    };
  });
  // Las que mas le han hecho ganar, primero.
  recruits.sort((a, b) => b.earnedCents - a.earnedCents || a.joinedAt.localeCompare(b.joinedAt));

  const wallet = recruiter.user.wallet;
  const pendingTokens = wallet ? withdrawableTokens(wallet) : 0;
  // Lo que de verdad se le pago (ya sin la comision de retiro).
  const payouts = await prisma.transaction.findMany({
    where: { userId: recruiter.userId, type: 'PAYOUT' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, amountCents: true, platformFeeTokens: true, description: true },
  });
  const payments: RecruiterPayment[] = payouts.map((p) => ({
    id: p.id,
    date: p.createdAt.toISOString(),
    cents: p.amountCents ?? 0,
    feeCents: tokensToPayoutCents(p.platformFeeTokens),
    description: p.description,
  }));
  const thisMonthTokens = byMonth.get(thisMonth) ?? 0;
  const lastMonthTokens = byMonth.get(lastMonth) ?? 0;

  return {
    id: recruiter.id,
    code: recruiter.code,
    active: recruiter.active,
    commissionPercent: recruiter.commissionPercent,
    months: recruiter.months,
    maxCreators: recruiter.maxCreators,
    notes: recruiter.notes,
    account: {
      userId: recruiter.user.id,
      username: recruiter.user.username,
      email: recruiter.user.email,
    },
    createdAt: recruiter.createdAt.toISOString(),
    recruits,
    payments,
    monthly: monthKeys.map((k) => ({ month: k, cents: tokensToPayoutCents(byMonth.get(k) ?? 0) })),
    totals: {
      registered: recruits.length,
      verified: recruits.filter((r) => r.status === 'active').length,
      salesCount,
      earnedCents: tokensToPayoutCents(earnedTokens),
      earnedThisMonthCents: tokensToPayoutCents(thisMonthTokens),
      earnedLastMonthCents: tokensToPayoutCents(lastMonthTokens),
      pendingCents: tokensToPayoutCents(pendingTokens),
      payNowCents: tokensToPayoutCents(splitPayoutFee(pendingTokens).netTokens),
      paidCents: payments.reduce((sum, p) => sum + p.cents, 0),
    },
  };
}

/** "2026-09" (UTC). */
function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "sep 26" a partir de "2026-09". */
export function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, m! - 1, 1)),
  );
}

/** Texto corto de las condiciones: "3% · 12 meses · hasta 20 creadoras". */
export function termsLabel(r: {
  commissionPercent: number;
  months: number | null;
  maxCreators: number | null;
}) {
  return [
    `${r.commissionPercent}% de cada venta`,
    r.months == null ? 'para siempre' : `${r.months} meses por creador`,
    r.maxCreators == null ? 'sin tope' : `hasta ${r.maxCreators} creadores`,
  ].join(' · ');
}
