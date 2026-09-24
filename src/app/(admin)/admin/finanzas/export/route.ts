import { NextResponse, type NextRequest } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import { getMonthlyFinance, monthlyCsv, monthTransactionsCsv } from '@/lib/finance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /admin/finanzas/export            -> resumen de los ultimos 12 meses
 * GET /admin/finanzas/export?mes=2026-09 -> cada movimiento de ese mes
 * CSV para el contador. Solo admin.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') return new NextResponse('Forbidden', { status: 403 });

  const mes = req.nextUrl.searchParams.get('mes');
  if (mes && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    return new NextResponse('Mes no valido', { status: 400 });
  }

  const csv = mes ? await monthTransactionsCsv(mes) : monthlyCsv(await getMonthlyFinance(12));
  const name = mes ? `fantasylive-movimientos-${mes}.csv` : 'fantasylive-resumen-mensual.csv';

  // BOM: para que Excel abra bien las tildes.
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
