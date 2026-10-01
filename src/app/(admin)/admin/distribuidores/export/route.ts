import { NextResponse, type NextRequest } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import {
  parsePeriod,
  PERIODS,
  SALE_LIST_INCLUDE,
  SALE_STATUS_LABEL,
  salesWhere,
  toCsv,
} from '@/lib/distributor-dashboard';
import { paymentMethodLabel } from '@/lib/distributor-shared';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /admin/distribuidores/export?tipo=ventas&periodo=30&dist=&pais=&metodo=&estado=
 * GET /admin/distribuidores/export?tipo=lotes&dist=&estado=
 * CSV de las ventas a fans o de los lotes, con los mismos filtros del panel. Solo admin.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') return new NextResponse('Forbidden', { status: 403 });
  const q = Object.fromEntries(req.nextUrl.searchParams.entries());

  let csv: string;
  let name: string;
  if (q.tipo === 'lotes') {
    const estado = ['PENDING', 'PAID', 'CANCELLED'].includes(q.estado ?? '') ? (q.estado as 'PENDING' | 'PAID' | 'CANCELLED') : undefined;
    const rows = await prisma.distributorOrder.findMany({
      where: { ...(estado ? { status: estado } : {}), ...(q.dist ? { distributorId: q.dist } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20_000,
      include: { distributor: { select: { legalName: true, country: true } } },
    });
    csv = toCsv([
      ['fecha', 'lote', 'distribuidor', 'pais', 'tokens', 'descuento_%', 'importe_usd', 'metodo', 'referencia', 'recibo', 'estado', 'motivo_rechazo', 'confirmado'],
      ...rows.map((o) => [
        o.createdAt.toISOString(),
        o.id,
        o.distributor.legalName,
        o.distributor.country,
        o.tokens,
        o.discountPercent,
        (o.amountCents / 100).toFixed(2),
        o.paymentMethod,
        o.paymentRef,
        o.proofKey ? 'si' : 'no',
        o.status,
        o.rejectReason,
        o.paidAt?.toISOString(),
      ]),
    ]);
    name = 'distribuidores-lotes.csv';
  } else {
    const since = q.periodo === 'todo' ? null : new Date(Date.now() - PERIODS[parsePeriod(q.periodo)] * 24 * 3600_000);
    const rows = await prisma.distributorSale.findMany({
      where: salesWhere(q, since),
      orderBy: { createdAt: 'desc' },
      take: 20_000,
      include: SALE_LIST_INCLUDE,
    });
    csv = toCsv([
      ['fecha', 'pedido', 'distribuidor', 'fan', 'pais', 'metodo', 'tokens', 'importe', 'moneda', 'precio_100tk', 'ref_pago', 'comprobante', 'estado', 'pagado', 'completado', 'motivo_cancelacion', 'disputa', 'valoracion'],
      ...rows.map((s) => [
          s.createdAt.toISOString(),
          s.id,
          s.distributor.legalName,
          s.fan.username ?? s.fan.id,
          s.account.country,
          paymentMethodLabel(s.account.method),
          s.tokens,
          (s.amount / 100).toFixed(2),
          s.currency,
          // centesimas por 100 tokens -> unidades: amount / tokens
          (s.amount / s.tokens).toFixed(2),
          s.paymentRef,
          s.paymentProofKey ? 'si' : 'no',
          SALE_STATUS_LABEL[s.status],
          s.paidAt?.toISOString(),
          s.completedAt?.toISOString(),
          s.cancelReason,
          s.disputeReason,
          s.rating === 1 ? 'buena' : s.rating === -1 ? 'mala' : '',
        ]),
    ]);
    name = 'distribuidores-ventas.csv';
  }

  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
