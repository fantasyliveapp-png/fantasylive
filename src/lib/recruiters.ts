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
  joinedAt: string;
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
  recruits: RecruitRow[];
  totals: {
    registered: number;
    verified: number;
    earnedCents: number;
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
    select: { tokens: true, metadata: true },
  });
  const byCreator = new Map<string, number>();
  let earnedTokens = 0;
  for (const t of earnings) {
    const meta = (t.metadata ?? {}) as { kind?: string; fromCreatorUserId?: string };
    if (meta.kind && meta.kind !== 'recruiter') continue;
    earnedTokens += t.tokens;
    if (meta.fromCreatorUserId) {
      byCreator.set(meta.fromCreatorUserId, (byCreator.get(meta.fromCreatorUserId) ?? 0) + t.tokens);
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
    return {
      userId: c.id,
      name: m?.stageName ?? c.name ?? c.username ?? 'Sin nombre',
      avatarUrl: m?.avatarUrl ?? c.image,
      slug: m?.kycStatus === 'APPROVED' ? m.slug : null,
      status,
      earnedCents: tokensToPayoutCents(byCreator.get(c.id) ?? 0),
      joinedAt: c.createdAt.toISOString(),
    };
  });

  const wallet = recruiter.user.wallet;
  const pendingTokens = wallet ? withdrawableTokens(wallet) : 0;
  // Lo que de verdad se le pago (ya sin la comision de retiro).
  const paid = await prisma.transaction.aggregate({
    where: { userId: recruiter.userId, type: 'PAYOUT' },
    _sum: { amountCents: true },
  });
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
    recruits,
    totals: {
      registered: recruits.length,
      verified: recruits.filter((r) => r.status === 'active').length,
      earnedCents: tokensToPayoutCents(earnedTokens),
      pendingCents: tokensToPayoutCents(pendingTokens),
      payNowCents: tokensToPayoutCents(splitPayoutFee(pendingTokens).netTokens),
      paidCents: paid._sum.amountCents ?? 0,
    },
  };
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
