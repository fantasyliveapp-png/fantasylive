import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { EARNING_TYPES, tokensToPayoutCents } from '@/lib/tokens';

/**
 * INFORMES PARA CONTABILIDAD: numeros por mes y lo que se debe hoy.
 *
 * - Ventas: dinero real que entro (compras de tokens).
 * - Para creadoras: lo que ganaron por ventas (en USD al valor de retiro).
 * - Referidos: lo que ganaron embajadoras y reclutadores.
 * - Comision: lo que se queda la plataforma de cada venta.
 * - Retiros pagados: dinero que ya salio hacia creadoras.
 */

export interface MonthRow {
  /** 'YYYY-MM' */
  month: string;
  salesCents: number;
  tokensSold: number;
  purchases: number;
  creatorEarnedCents: number;
  referralCents: number;
  commissionCents: number;
  payoutsPaidCents: number;
  payoutFeesCents: number;
}

const CREATOR_TYPES = EARNING_TYPES.filter((t) => t !== 'REFERRAL_EARNING');

export async function getMonthlyFinance(months = 12): Promise<MonthRow[]> {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCMonth(since.getUTCMonth() - (months - 1));

  const [sales, earnings, fees, payouts] = await Promise.all([
    prisma.$queryRaw<{ m: string; cents: bigint | null; tokens: bigint | null; n: bigint }[]>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS m,
             SUM("amountCents") AS cents, SUM(tokens) AS tokens, COUNT(*) AS n
      FROM transactions
      WHERE type = 'TOKEN_PURCHASE' AND status = 'COMPLETED' AND "createdAt" >= ${since}
      GROUP BY 1`,
    prisma.$queryRaw<{ m: string; kind: string; tokens: bigint | null }[]>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS m,
             CASE WHEN type = 'REFERRAL_EARNING' THEN 'ref' ELSE 'creator' END AS kind,
             SUM(tokens) AS tokens
      FROM transactions
      WHERE type::text IN (${Prisma.join([...CREATOR_TYPES, 'REFERRAL_EARNING'])})
        AND status = 'COMPLETED' AND "createdAt" >= ${since}
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ m: string; fee: bigint | null }[]>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS m, SUM("platformFeeTokens") AS fee
      FROM transactions
      WHERE "createdAt" >= ${since}
      GROUP BY 1`,
    prisma.$queryRaw<{ m: string; cents: bigint | null; fee: bigint | null }[]>`
      SELECT to_char(date_trunc('month', "paidAt"), 'YYYY-MM') AS m,
             SUM("amountCents") AS cents, SUM("feeTokens") AS fee
      FROM payout_requests
      WHERE status = 'PAID' AND "paidAt" >= ${since}
      GROUP BY 1`,
  ]);

  const rows = new Map<string, MonthRow>();
  for (let i = 0; i < months; i++) {
    const d = new Date(since);
    d.setUTCMonth(since.getUTCMonth() + i);
    const month = d.toISOString().slice(0, 7);
    rows.set(month, {
      month,
      salesCents: 0,
      tokensSold: 0,
      purchases: 0,
      creatorEarnedCents: 0,
      referralCents: 0,
      commissionCents: 0,
      payoutsPaidCents: 0,
      payoutFeesCents: 0,
    });
  }
  for (const r of sales) {
    const row = rows.get(r.m);
    if (!row) continue;
    row.salesCents = Number(r.cents ?? 0);
    row.tokensSold = Number(r.tokens ?? 0);
    row.purchases = Number(r.n);
  }
  for (const r of earnings) {
    const row = rows.get(r.m);
    if (!row) continue;
    const cents = tokensToPayoutCents(Number(r.tokens ?? 0));
    if (r.kind === 'ref') row.referralCents += cents;
    else row.creatorEarnedCents += cents;
  }
  for (const r of fees) {
    const row = rows.get(r.m);
    if (row) row.commissionCents = tokensToPayoutCents(Number(r.fee ?? 0));
  }
  for (const r of payouts) {
    const row = rows.get(r.m);
    if (!row) continue;
    row.payoutsPaidCents = Number(r.cents ?? 0);
    row.payoutFeesCents = tokensToPayoutCents(Number(r.fee ?? 0));
  }
  return [...rows.values()].reverse();
}

/** Lo que la plataforma debe HOY. */
export async function getLiabilities() {
  const [wallets, openPayouts] = await Promise.all([
    prisma.$queryRaw<{ earned: bigint | null; unspent: bigint | null }[]>`
      SELECT SUM(LEAST("pendingEarnings", balance)) AS earned,
             SUM(GREATEST(balance - "pendingEarnings", 0)) AS unspent
      FROM wallets`,
    prisma.payoutRequest.aggregate({
      where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
      _sum: { amountCents: true },
      _count: true,
    }),
  ]);
  const w = wallets[0];
  return {
    /** Ganado por creadoras/referidos y aun sin pedir retiro. */
    earnedNotWithdrawnCents: tokensToPayoutCents(Number(w?.earned ?? 0)),
    /** Retiros pedidos y aun sin pagar. */
    payoutsPendingCents: openPayouts._sum.amountCents ?? 0,
    payoutsPendingCount: openPayouts._count,
    /** Tokens comprados por fans y aun sin gastar. */
    unspentTokens: Number(w?.unspent ?? 0),
  };
}

/** CSV con cada movimiento de un mes, para el contador. */
export async function monthTransactionsCsv(month: string): Promise<string> {
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);

  const txs = await prisma.transaction.findMany({
    where: { createdAt: { gte: from, lt: to } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      createdAt: true,
      type: true,
      status: true,
      tokens: true,
      amountCents: true,
      currency: true,
      platformFeeTokens: true,
      provider: true,
      providerRef: true,
      description: true,
      user: { select: { email: true, username: true } },
    },
  });

  const header = [
    'fecha',
    'id',
    'tipo',
    'estado',
    'usuario',
    'email',
    'tokens',
    'importe',
    'moneda',
    'comision_tokens',
    'pasarela',
    'referencia',
    'descripcion',
  ];
  const lines = txs.map((t) =>
    [
      t.createdAt.toISOString(),
      t.id,
      t.type,
      t.status,
      t.user.username ?? '',
      t.user.email,
      t.tokens,
      t.amountCents != null ? (t.amountCents / 100).toFixed(2) : '',
      t.currency ?? '',
      t.platformFeeTokens,
      t.provider,
      t.providerRef ?? '',
      t.description ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

export function monthlyCsv(rows: MonthRow[]): string {
  const header = [
    'mes',
    'ventas_usd',
    'compras',
    'tokens_vendidos',
    'ganado_creadoras_usd',
    'referidos_usd',
    'comision_usd',
    'retiros_pagados_usd',
    'comision_retiros_usd',
  ];
  const money = (c: number) => (c / 100).toFixed(2);
  return [
    header.join(','),
    ...rows.map((r) =>
      [
        r.month,
        money(r.salesCents),
        r.purchases,
        r.tokensSold,
        money(r.creatorEarnedCents),
        money(r.referralCents),
        money(r.commissionCents),
        money(r.payoutsPaidCents),
        money(r.payoutFeesCents),
      ].join(','),
    ),
  ].join('\n');
}

function csvCell(v: string | number): string {
  const s = String(v);
  // Evita que Excel ejecute formulas metidas en un texto (=, +, -, @).
  const safe = /^[=+\-@]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
