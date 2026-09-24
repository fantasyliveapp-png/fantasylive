import 'server-only';

import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { FOUNDER_SPOTS } from '@/lib/referrals';
import { tokensToPayoutCents, withdrawableTokens } from '@/lib/tokens';

/**
 * Datos del resumen del admin: lo que hay que hacer hoy, como va el negocio
 * (esta semana contra la anterior) y la actividad reciente.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Contadores de lo pendiente (menu lateral y bandeja del resumen). */
export async function getAdminCounts() {
  const [kyc, reports, payouts, recruiterWallets, live] = await Promise.all([
    prisma.kycVerification.count({ where: { status: 'PENDING' } }),
    prisma.report.count({
      where: { status: { in: ['OPEN', 'UNDER_REVIEW', 'ESCALATED'] } },
    }),
    prisma.payoutRequest.count({
      where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
    }),
    prisma.recruiter.findMany({
      where: { active: true },
      select: {
        user: {
          select: {
            wallet: { select: { balance: true, pendingEarnings: true } },
          },
        },
      },
    }),
    prisma.liveStream.count({ where: { status: 'LIVE' } }),
  ]);
  const recruitersToPay = recruiterWallets.filter(
    (r) => r.user.wallet && withdrawableTokens(r.user.wallet) >= config.economy.minPayoutTokens,
  ).length;
  return { kyc, reports, payouts, recruitersToPay, live };
}

export type DayPoint = { day: string; revenueCents: number; signups: number };

export type Kpi = { value: number; previous: number };

export async function getAdminOverview() {
  const now = Date.now();
  const d7 = new Date(now - 7 * DAY);
  const d14 = new Date(now - 14 * DAY);
  const d30 = new Date(now - 30 * DAY);

  const purchase = {
    type: 'TOKEN_PURCHASE' as const,
    status: 'COMPLETED' as const,
  };

  const [
    counts,
    oldestKyc,
    payoutSum,
    revenueNow,
    revenuePrev,
    feeNow,
    feePrev,
    fansNow,
    fansPrev,
    creatorsNow,
    creatorsPrev,
    totalUsers,
    totalCreators,
    verifiedCreators,
    founders,
    onlineCreators,
    liveNow,
    activeCalls,
    revenueDays,
    signupDays,
    topEarners,
    recentAudit,
  ] = await Promise.all([
    getAdminCounts(),
    prisma.kycVerification.findFirst({
      where: { status: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      select: { submittedAt: true },
    }),
    prisma.payoutRequest.aggregate({
      where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
      _sum: { amountCents: true },
    }),
    prisma.transaction.aggregate({
      where: { ...purchase, createdAt: { gte: d7 } },
      _sum: { amountCents: true },
    }),
    prisma.transaction.aggregate({
      where: { ...purchase, createdAt: { gte: d14, lt: d7 } },
      _sum: { amountCents: true },
    }),
    prisma.transaction.aggregate({
      where: { createdAt: { gte: d7 } },
      _sum: { platformFeeTokens: true },
    }),
    prisma.transaction.aggregate({
      where: { createdAt: { gte: d14, lt: d7 } },
      _sum: { platformFeeTokens: true },
    }),
    prisma.user.count({ where: { createdAt: { gte: d7 } } }),
    prisma.user.count({ where: { createdAt: { gte: d14, lt: d7 } } }),
    prisma.modelProfile.count({ where: { createdAt: { gte: d7 } } }),
    prisma.modelProfile.count({ where: { createdAt: { gte: d14, lt: d7 } } }),
    prisma.user.count(),
    prisma.modelProfile.count(),
    prisma.modelProfile.count({ where: { kycStatus: 'APPROVED' } }),
    prisma.modelProfile.count({ where: { founderNumber: { not: null } } }),
    prisma.modelProfile.count({ where: { isOnline: true } }),
    prisma.liveStream.count({ where: { status: 'LIVE' } }),
    prisma.callSession.count({ where: { status: 'ACTIVE' } }),
    prisma.$queryRaw<{ day: string; cents: bigint | null }[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, SUM("amountCents") AS cents
      FROM transactions
      WHERE type = 'TOKEN_PURCHASE' AND status = 'COMPLETED' AND "createdAt" >= ${d30}
      GROUP BY 1`,
    prisma.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, COUNT(*) AS n
      FROM users
      WHERE "createdAt" >= ${d30}
      GROUP BY 1`,
    // Quien mas ha ganado en los ultimos 30 dias (no el historico).
    prisma.transaction.groupBy({
      by: ['userId'],
      where: {
        type: { in: ['CALL_EARNING', 'CONTENT_EARNING', 'TIP_EARNING'] },
        createdAt: { gte: d30 },
      },
      _sum: { tokens: true },
      orderBy: { _sum: { tokens: 'desc' } },
      take: 6,
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { actor: { select: { name: true, username: true } } },
    }),
  ]);

  const revenueMap = new Map(revenueDays.map((r) => [r.day, Number(r.cents ?? 0)]));
  const signupMap = new Map(signupDays.map((r) => [r.day, Number(r.n)]));
  const series: DayPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now - i * DAY).toISOString().slice(0, 10);
    series.push({
      day,
      revenueCents: revenueMap.get(day) ?? 0,
      signups: signupMap.get(day) ?? 0,
    });
  }

  const earnerProfiles = await prisma.user.findMany({
    where: { id: { in: topEarners.map((t) => t.userId) } },
    select: {
      id: true,
      name: true,
      modelProfile: {
        select: {
          stageName: true,
          slug: true,
          avatarUrl: true,
          isOnline: true,
        },
      },
    },
  });
  const byId = new Map(earnerProfiles.map((u) => [u.id, u]));
  const top = topEarners.map((t) => {
    const u = byId.get(t.userId);
    return {
      userId: t.userId,
      name: u?.modelProfile?.stageName ?? u?.name ?? 'Sin nombre',
      slug: u?.modelProfile?.slug ?? null,
      avatarUrl: u?.modelProfile?.avatarUrl ?? null,
      isOnline: u?.modelProfile?.isOnline ?? false,
      earnedCents: tokensToPayoutCents(t._sum.tokens ?? 0),
    };
  });

  return {
    counts,
    oldestKycAt: oldestKyc?.submittedAt ?? null,
    payoutsPendingCents: payoutSum._sum.amountCents ?? 0,
    kpis: {
      revenue: {
        value: revenueNow._sum.amountCents ?? 0,
        previous: revenuePrev._sum.amountCents ?? 0,
      },
      commission: {
        value: tokensToPayoutCents(feeNow._sum.platformFeeTokens ?? 0),
        previous: tokensToPayoutCents(feePrev._sum.platformFeeTokens ?? 0),
      },
      fans: { value: fansNow, previous: fansPrev },
      creators: { value: creatorsNow, previous: creatorsPrev },
    } satisfies Record<string, Kpi>,
    totals: { users: totalUsers, creators: totalCreators, verifiedCreators },
    founders: { taken: founders, spots: FOUNDER_SPOTS },
    live: { onlineCreators, liveNow, activeCalls },
    series,
    top,
    recentAudit: recentAudit.map((a) => ({
      id: a.id,
      action: a.action,
      actor: a.actor?.name ?? a.actor?.username ?? 'Sistema',
      createdAt: a.createdAt,
    })),
  };
}

/** El codigo interno de cada accion, dicho en cristiano. */
const AUDIT_LABELS: Record<string, string> = {
  KYC_APPROVED: 'Aprobo una verificacion',
  KYC_REJECTED: 'Rechazo una verificacion',
  KYC_SUBMITTED: 'Nueva verificacion enviada',
  USER_SUSPEND: 'Suspendio una cuenta',
  USER_SUSPENDED: 'Suspendio una cuenta',
  USER_BAN: 'Baneo una cuenta',
  USER_BANNED: 'Baneo una cuenta',
  USER_REINSTATE: 'Reactivo una cuenta',
  USER_PROMOTE_VIP: 'Hizo VIP a un usuario',
  USER_DEMOTE_VIP: 'Quito el VIP a un usuario',
  PAYOUT_REQUESTED: 'Nueva solicitud de retiro',
  PAYOUT_APPROVED: 'Aprobo un retiro',
  PAYOUT_PAID: 'Marco un retiro como pagado',
  PAYOUT_REJECTED: 'Rechazo un retiro',
  PAYOUT_DESTINATION_REVEALED: 'Vio los datos de pago de un retiro',
  ADMIN_CREDIT: 'Anadio tokens a un monedero',
  ADMIN_DEBIT: 'Quito tokens de un monedero',
  MODEL_PROFILE_CREATED: 'Nueva creadora registrada',
  BLOCKED_COUNTRIES_UPDATED: 'Una creadora cambio sus paises bloqueados',
  RECRUITER_CREATED: 'Creo un reclutador',
  RECRUITER_UPDATED: 'Cambio las condiciones de un reclutador',
  RECRUITER_PAID: 'Anoto un pago a un reclutador',
  SEED_EXECUTED: 'Datos de prueba cargados',
  POST_REMOVED: 'Retiro una publicacion',
  POST_RESTORED: 'Restauro una publicacion',
  COMMENT_DELETED: 'Borro un comentario',
  LIVE_ENDED_BY_ADMIN: 'Corto un directo',
  CHAT_VIEWED: 'Abrio un chat privado',
};

export function auditLabel(action: string) {
  if (AUDIT_LABELS[action]) return AUDIT_LABELS[action];
  if (action.startsWith('REPORT_')) return 'Actualizo un reporte';
  if (action.startsWith('PAYOUT_')) return 'Actualizo un retiro';
  return action.toLowerCase().replace(/_/g, ' ');
}
