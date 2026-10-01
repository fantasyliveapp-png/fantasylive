import 'server-only';

import type { Distributor } from '@prisma/client';

import { config } from '@/lib/config';
import { discountForTokens, lotMath } from '@/lib/distributor-shared';
import { FOUNDER_PLATFORM_PERCENT } from '@/lib/deals';
import { prisma } from '@/lib/prisma';
import { FAN_LINK_PLATFORM_PERCENT } from '@/lib/referrals';

/**
 * DISTRIBUIDORES OFICIALES
 *
 * Reglas para que el programa sea seguro (y encaje en la exencion de FinCEN
 * para saldo de "circuito cerrado"):
 *   - Los tokens solo sirven aqui, no se devuelven en dinero y un fan no se
 *     los puede pasar a otro: solo el distribuidor envia.
 *   - Cada fan recibe como mucho config.distributors.fanDailyTokens al dia.
 *   - Solo a fans verificados (+18), nunca a creadores, ni a paises con
 *     embargo de EE. UU.
 *   - El distribuidor compra por transferencia bancaria, nunca con tarjeta, y
 *     solo opera con identidad, revision OFAC y contrato al dia.
 *   - El precio mayorista nunca baja de lo que cuesta pagar esos tokens al
 *     creador en el peor caso: no se pierde dinero.
 */

/** Paises con embargo integral de EE. UU. (OFAC): ni distribuidores ni envios. */
export const SANCTIONED_COUNTRIES = new Set(['CU', 'IR', 'KP', 'SY']);

export const ORDER_LIMITS = { minTokens: 1000, maxTokens: 1_000_000 } as const;

/**
 * Lo minimo que debe pagar un distribuidor por token (centavos de USD): lo
 * que se le paga al creador en el peor caso (fan traido por ese creador, 70%;
 * o un Fundador, 60%). Por debajo se perderia dinero.
 */
export function minWholesaleCents() {
  const maxCreatorPercent = 100 - Math.min(FAN_LINK_PLATFORM_PERCENT, FOUNDER_PLATFORM_PERCENT);
  return Math.ceil((config.economy.modelPayoutCentsPerToken * maxCreatorPercent) / 100);
}

/** Precio de un lote en dolares: descuento progresivo segun el tamaño. */
export function quoteOrder(tokens: number) {
  const discountPercent = discountForTokens(tokens, config.distributors.discountPercent);
  return { discountPercent, ...lotMath(tokens, config.economy.tokenValueCents, discountPercent) };
}

/**
 * Descuento medio con el que compro su stock (ponderado por tokens de los
 * lotes pagados). Sirve para calcularle lo que gana en cada paquete.
 */
export async function averageDiscount(distributorId: string) {
  const r = await prisma.distributorOrder.aggregate({
    where: { distributorId, status: 'PAID' },
    _sum: { tokens: true, amountCents: true },
  });
  const retail = (r._sum.tokens ?? 0) * config.economy.tokenValueCents;
  if (!retail) return discountForTokens(ORDER_LIMITS.minTokens, config.distributors.discountPercent);
  // Se calcula con lo que pago de verdad (sirve tambien para lotes antiguos).
  return Math.max(0, Math.round((1 - (r._sum.amountCents ?? 0) / retail) * 1000) / 10);
}

/**
 * Comprobacion de seguridad: con el descuento maximo configurado, ¿se cubre lo que
 * se paga al creador en el peor caso? (Si no, el programa no deja operar.)
 */
export function discountIsSafe() {
  const costPerToken = (config.economy.tokenValueCents * (100 - config.distributors.discountPercent)) / 100;
  return costPerToken >= minWholesaleCents();
}

/**
 * Paises y metodos de un distribuidor: salen siempre de sus metodos de cobro
 * activos (mas su pais de alta). Se llama al guardar o quitar un metodo.
 */
export async function syncCoverage(distributorId: string) {
  const d = await prisma.distributor.findUnique({
    where: { id: distributorId },
    select: { country: true, accounts: { where: { active: true }, select: { country: true, method: true } } },
  });
  if (!d) return;
  await prisma.distributor.update({
    where: { id: distributorId },
    data: {
      countries: [...new Set([d.country, ...d.accounts.map((a) => a.country)])],
      paymentMethods: [...new Set(d.accounts.map((a) => a.method))],
    },
  });
}

export function isCompliant(d: Pick<Distributor, 'idVerifiedAt' | 'sanctionsCheckedAt' | 'contractSignedAt'>) {
  return Boolean(d.idVerifiedAt && d.sanctionsCheckedAt && d.contractSignedAt);
}

/** Puede vender y enviar ahora mismo (y por que no, si no). */
export function operatingBlock(
  d: Pick<Distributor, 'status' | 'country' | 'idVerifiedAt' | 'sanctionsCheckedAt' | 'contractSignedAt'>,
): string | null {
  if (!config.distributors.enabled) return 'El programa de distribuidores aún no está activo.';
  if (d.status !== 'ACTIVE') return 'Tu cuenta de distribuidor está en pausa. Habla con el equipo.';
  if (SANCTIONED_COUNTRIES.has(d.country)) return 'No se puede operar desde ese país.';
  if (!isCompliant(d)) return 'Faltan pasos de verificación (identidad, revisión de sanciones o contrato).';
  if (!discountIsSafe()) return 'El descuento de distribuidores está mal configurado. Avisa al equipo.';
  return null;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Tokens que ha recibido hoy este fan de cualquier distribuidor. */
export async function receivedToday(userId: string) {
  const r = await prisma.distributorTransfer.aggregate({
    where: { toUserId: userId, createdAt: { gte: startOfToday() } },
    _sum: { tokens: true },
  });
  return r._sum.tokens ?? 0;
}

export interface DistributorAlert {
  kind: 'fan_max' | 'multi_distributor' | 'new_account' | 'creator_concentration';
  text: string;
  href: string | null;
}

/**
 * Señales de posible lavado o abuso en los ultimos 30 dias. No bloquean nada:
 * son para que el equipo revise.
 */
export async function getDistributorAlerts(): Promise<DistributorAlert[]> {
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const cap = config.distributors.fanDailyTokens;
  const alerts: DistributorAlert[] = [];

  // 1. Fans que rozan el tope diario (>= 80%) 3 dias o mas.
  const nearCap = await prisma.$queryRaw<{ userId: string; username: string | null; days: bigint }[]>`
    SELECT t."toUserId" AS "userId", u.username, COUNT(*) AS days FROM (
      SELECT "toUserId", date_trunc('day', "createdAt") AS d, SUM(tokens) AS total
      FROM distributor_transfers WHERE "createdAt" >= ${since}
      GROUP BY 1, 2
    ) t JOIN users u ON u.id = t."toUserId"
    WHERE t.total >= ${Math.floor(cap * 0.8)}
    GROUP BY 1, 2 HAVING COUNT(*) >= 3`;
  for (const r of nearCap) {
    alerts.push({
      kind: 'fan_max',
      text: `@${r.username ?? r.userId} ha recibido casi el máximo diario ${Number(r.days)} días este mes.`,
      href: `/admin/users/${r.userId}`,
    });
  }

  // 2. Fans que reciben de dos o mas distribuidores.
  const multi = await prisma.$queryRaw<{ userId: string; username: string | null; n: bigint }[]>`
    SELECT t."toUserId" AS "userId", u.username, COUNT(DISTINCT t."distributorId") AS n
    FROM distributor_transfers t JOIN users u ON u.id = t."toUserId"
    WHERE t."createdAt" >= ${since}
    GROUP BY 1, 2 HAVING COUNT(DISTINCT t."distributorId") >= 2`;
  for (const r of multi) {
    alerts.push({
      kind: 'multi_distributor',
      text: `@${r.username ?? r.userId} recibe tokens de ${Number(r.n)} distribuidores distintos.`,
      href: `/admin/users/${r.userId}`,
    });
  }

  // 3. Cuentas de menos de 24 h que reciben mucho (>= 1000 tokens).
  const fresh = await prisma.$queryRaw<{ userId: string; username: string | null; total: bigint }[]>`
    SELECT t."toUserId" AS "userId", u.username, SUM(t.tokens) AS total
    FROM distributor_transfers t JOIN users u ON u.id = t."toUserId"
    WHERE t."createdAt" >= ${since} AND t."createdAt" < u."createdAt" + interval '24 hours'
    GROUP BY 1, 2 HAVING SUM(t.tokens) >= 1000`;
  for (const r of fresh) {
    alerts.push({
      kind: 'new_account',
      text: `@${r.username ?? r.userId} recibió ${Number(r.total)} tokens en su primer día de cuenta.`,
      href: `/admin/users/${r.userId}`,
    });
  }

  // 4. Creadores que cobran sobre todo de fans pagados por distribuidores
  //    (>= 1000 tokens y >= 50% de lo que ganaron este mes).
  const concentrated = await prisma.$queryRaw<
    { creatorId: string; name: string | null; fromDist: bigint; total: bigint }[]
  >`
    WITH fans AS (
      SELECT DISTINCT "toUserId" AS id FROM distributor_transfers WHERE "createdAt" >= ${since}
    ), sales AS (
      SELECT t."userId" AS "creatorId",
             (t.metadata->'sale'->>'payerId') AS payer,
             COALESCE((t.metadata->'sale'->>'grossTokens')::int, t.tokens) AS gross
      FROM transactions t
      WHERE t."createdAt" >= ${since} AND t.tokens > 0 AND t.metadata ? 'sale'
    )
    SELECT s."creatorId", u.name,
           SUM(CASE WHEN s.payer IN (SELECT id FROM fans) THEN s.gross ELSE 0 END) AS "fromDist",
           SUM(s.gross) AS total
    FROM sales s JOIN users u ON u.id = s."creatorId"
    GROUP BY 1, 2
    HAVING SUM(CASE WHEN s.payer IN (SELECT id FROM fans) THEN s.gross ELSE 0 END) >= 1000
       AND SUM(CASE WHEN s.payer IN (SELECT id FROM fans) THEN s.gross ELSE 0 END) * 2 >= SUM(s.gross)`;
  for (const r of concentrated) {
    alerts.push({
      kind: 'creator_concentration',
      text: `${r.name ?? 'Un creador'} gana el ${Math.round((Number(r.fromDist) / Math.max(1, Number(r.total))) * 100)}% de su dinero de fans pagados por distribuidores (${Number(r.fromDist)} tokens este mes).`,
      href: `/admin/users/${r.creatorId}`,
    });
  }

  return alerts;
}

/** Tokens de pedidos abiertos de un fan (reservados, aun sin entregar). */
export async function openTokensForFan(fanId: string) {
  const r = await prisma.distributorSale.aggregate({
    where: { fanId, status: { in: ['AWAITING_PAYMENT', 'PAID', 'DISPUTED'] } },
    _sum: { tokens: true },
  });
  return r._sum.tokens ?? 0;
}

/**
 * Pedidos que el fan no pago a tiempo: se cancelan y los tokens vuelven al
 * distribuidor. Se llama al abrir las paginas y acciones de compra.
 */
export async function expireSales() {
  const due = await prisma.distributorSale.findMany({
    where: { status: 'AWAITING_PAYMENT', expiresAt: { lt: new Date() } },
    select: { id: true },
    take: 100,
  });
  for (const { id } of due) {
    await prisma.$transaction(async (tx) => {
      const done = await tx.distributorSale.updateMany({
        where: { id, status: 'AWAITING_PAYMENT' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'No se pagó a tiempo' },
      });
      if (done.count === 0) return;
      const s = await tx.distributorSale.findUniqueOrThrow({ where: { id }, select: { distributorId: true, tokens: true } });
      await tx.distributor.update({ where: { id: s.distributorId }, data: { stockTokens: { increment: s.tokens } } });
    });
  }
}

/** Valoracion publica: ventas completadas y % de valoraciones buenas. */
export async function distributorStats(ids: string[]) {
  const rows = await prisma.distributorSale.groupBy({
    by: ['distributorId', 'rating'],
    where: { distributorId: { in: ids }, status: 'COMPLETED' },
    _count: true,
  });
  const out = new Map<string, { sales: number; positive: number | null }>();
  for (const id of ids) {
    const mine = rows.filter((r) => r.distributorId === id);
    const sales = mine.reduce((n, r) => n + r._count, 0);
    const good = mine.filter((r) => r.rating === 1).reduce((n, r) => n + r._count, 0);
    const rated = mine.filter((r) => r.rating != null).reduce((n, r) => n + r._count, 0);
    out.set(id, { sales, positive: rated ? Math.round((good / rated) * 100) : null });
  }
  return out;
}
