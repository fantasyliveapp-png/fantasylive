import { NextResponse, type NextRequest } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /admin/distribuidores/recibo/[lote] -> abre el recibo que envió el distribuidor. Solo admin. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') return new NextResponse('Forbidden', { status: 403 });
  const { id } = await params;
  const order = await prisma.distributorOrder.findUnique({ where: { id }, select: { proofKey: true } });
  if (!order?.proofKey) return new NextResponse('Este lote no tiene recibo.', { status: 404 });
  const url = await resolveAssetUrl(order.proofKey, { isPublic: false });
  if (!url) return new NextResponse('No se pudo abrir el recibo.', { status: 500 });
  return NextResponse.redirect(url);
}
