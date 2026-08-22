import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { isLiveKitConfigured } from '@/lib/livekit';
import { isStorageConfigured } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/health - diagnostico rapido del entorno (local y Vercel). */
export async function GET() {
  const checks: Record<string, unknown> = {
    app: config.app.name,
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    const [users, models, packages] = await Promise.all([
      prisma.user.count(),
      prisma.modelProfile.count(),
      prisma.tokenPackage.count(),
    ]);
    checks.database = { status: 'ok', users, models, tokenPackages: packages };
  } catch (error) {
    checks.database = {
      status: 'error',
      message: error instanceof Error ? error.message : 'error',
      hint: 'Levanta Postgres con `npm run db:up` y ejecuta `npm run db:migrate`.',
    };
  }

  checks.livekit = {
    configured: isLiveKitConfigured(),
    hint: isLiveKitConfigured()
      ? undefined
      : 'Sin LiveKit la llamada funciona en modo demo (camara local).',
  };

  checks.storage = {
    configured: isStorageConfigured(),
    bucket: config.storage.bucket,
  };

  checks.payments = { provider: config.payments.provider };

  const healthy = (checks.database as any)?.status === 'ok';

  return NextResponse.json(checks, { status: healthy ? 200 : 503 });
}
