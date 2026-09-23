import { NextResponse, type NextRequest } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { isPayoutEncryptionReady, safeCompare } from '@/lib/crypto';
import { isLiveKitConfigured } from '@/lib/livekit';
import { prisma } from '@/lib/prisma';
import { isStorageConfigured } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Respuesta publica minima (200 / 503) pensada para el balanceador y la
 * monitorizacion. El detalle del entorno (conteos, mensajes de error de la
 * base de datos, que integraciones estan configuradas) solo se entrega a un
 * ADMIN autenticado o a quien presente HEALTH_CHECK_TOKEN, porque delata
 * infraestructura y sirve de reconocimiento a un atacante.
 */
export async function GET(request: NextRequest) {
  let databaseOk = false;
  let databaseError: string | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseOk = true;
  } catch (error) {
    databaseError = error instanceof Error ? error.message : 'error';
  }

  const status = databaseOk ? 200 : 503;

  if (!(await isDetailAllowed(request))) {
    return NextResponse.json(
      { status: databaseOk ? 'ok' : 'degraded' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const [users, models, packages] = databaseOk
    ? await Promise.all([
        prisma.user.count(),
        prisma.modelProfile.count(),
        prisma.tokenPackage.count(),
      ])
    : [0, 0, 0];

  return NextResponse.json(
    {
      status: databaseOk ? 'ok' : 'degraded',
      app: config.app.name,
      env: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      database: databaseOk
        ? { status: 'ok', users, models, tokenPackages: packages }
        : { status: 'error', message: databaseError },
      livekit: { configured: isLiveKitConfigured() },
      storage: {
        configured: isStorageConfigured(),
        bucket: config.storage.bucket,
      },
      payments: { provider: config.payments.provider },
      payouts: { encryptionConfigured: isPayoutEncryptionReady() },
      geo: { trustProxyHeaders: config.geo.trustProxyHeaders },
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Detalle solo para admins autenticados o para el token de monitorizacion. */
async function isDetailAllowed(request: NextRequest): Promise<boolean> {
  const expected = process.env.HEALTH_CHECK_TOKEN;
  const provided = request.headers.get('x-health-token');
  if (expected && provided && safeCompare(provided, expected)) return true;

  try {
    const user = await getCurrentUser();
    return user?.role === 'ADMIN';
  } catch {
    return false;
  }
}
