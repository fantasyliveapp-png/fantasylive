import 'server-only';

import { config } from '@/lib/config';
import { appLink, emailEnabled, formatEmailDate, formatUsd, sendTemplate } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { EARNING_TYPES } from '@/lib/tokens';

/**
 * RESUMEN SEMANAL DE CREADORAS (plantilla 14), los lunes.
 *
 * Ultimos 7 dias: ganancias (total, suscripciones, propinas), suscriptores
 * nuevos, activos y cancelaciones, horas en directo y pico de espectadores.
 * Solo a creadoras verificadas que tuvieron algo de actividad (un resumen a
 * ceros cada semana acaba en spam). Una vez por semana: si se lanza dos veces
 * la misma semana, la segunda no envia nada.
 */

const LAST_RUN_KEY = 'weekly_summary_last_week';

/** "2026-W41": identifica la semana (ISO) para no repetir. */
function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const tokensLabel = (tokens: number) =>
  `${tokens.toLocaleString('es')} tk (≈ ${formatUsd(tokens * config.economy.modelPayoutCentsPerToken)})`;

export async function sendWeeklySummaries(opts: { force?: boolean } = {}) {
  const now = new Date();
  const week = isoWeek(now);
  // Sin correo configurado no se envia nada ni se da la semana por hecha.
  if (!emailEnabled()) return { week, sent: 0, skipped: 0, alreadyDone: false, noEmail: true };
  if (!opts.force) {
    const last = await prisma.platformSetting.findUnique({ where: { key: LAST_RUN_KEY } });
    if (last?.value === week) return { week, sent: 0, skipped: 0, alreadyDone: true, noEmail: false };
  }
  const since = new Date(now.getTime() - 7 * 86_400_000);

  const creators = await prisma.modelProfile.findMany({
    where: { kycStatus: 'APPROVED', user: { status: 'ACTIVE' } },
    select: { id: true, userId: true, stageName: true, user: { select: { email: true } } },
  });

  let sent = 0;
  let skipped = 0;
  for (const c of creators) {
    const [earn, newSubs, cancels, active, streams] = await Promise.all([
      prisma.transaction.groupBy({
        by: ['type'],
        where: { userId: c.userId, type: { in: EARNING_TYPES }, createdAt: { gte: since } },
        _sum: { tokens: true },
      }),
      prisma.subscription.count({ where: { modelId: c.id, startedAt: { gte: since } } }),
      prisma.subscription.count({ where: { modelId: c.id, cancelledAt: { gte: since } } }),
      prisma.subscription.count({ where: { modelId: c.id, status: 'ACTIVE', currentPeriodEnd: { gt: now } } }),
      prisma.liveStream.findMany({
        where: { modelId: c.id, startedAt: { gte: since } },
        select: { startedAt: true, endedAt: true, viewerPeak: true },
      }),
    ]);
    const sum = (types?: string[]) =>
      earn.filter((e) => !types || types.includes(e.type)).reduce((n, e) => n + (e._sum.tokens ?? 0), 0);
    const total = sum();
    const liveMs = streams.reduce((n, s) => n + ((s.endedAt ?? now).getTime() - s.startedAt!.getTime()), 0);
    const liveHours = Math.round((liveMs / 3_600_000) * 10) / 10;

    if (total === 0 && newSubs === 0 && liveHours === 0) {
      skipped++;
      continue;
    }

    const ok = await sendTemplate('14-creador-resumen-semanal', c.user.email, `Tu semana en Fantazy Live: ${total.toLocaleString('es')} tokens`, {
      creatorName: c.stageName,
      weekStart: formatEmailDate(since),
      weekEnd: formatEmailDate(now),
      weekEarnings: `${total.toLocaleString('es')} tk`,
      newSubscribers: newSubs,
      liveHours: liveHours.toLocaleString('es'),
      subscriptionEarnings: tokensLabel(sum(['SUBSCRIPTION_EARNING'])),
      tipEarnings: tokensLabel(sum(['TIP_EARNING'])),
      peakViewers: streams.reduce((m, s) => Math.max(m, s.viewerPeak), 0),
      activeSubscribers: active,
      cancellations: cancels,
      actionUrl: appLink('/dashboard/model'),
    });
    if (ok) sent++;
  }

  await prisma.platformSetting.upsert({
    where: { key: LAST_RUN_KEY },
    create: { key: LAST_RUN_KEY, value: week, description: 'Ultima semana en que se envio el resumen semanal' },
    update: { value: week },
  });
  return { week, sent, skipped, alreadyDone: false, noEmail: false };
}
