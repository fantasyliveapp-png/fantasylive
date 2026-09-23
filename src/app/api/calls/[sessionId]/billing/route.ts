import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import { processBillingTick } from '@/lib/calls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/calls/:sessionId/billing
 *
 * Tick de cobro por minuto. El cliente lo invoca periodicamente pero el importe
 * lo calcula el servidor a partir de sus propios timestamps, de modo que
 * acelerar o falsear las peticiones no altera lo que se cobra.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;

  try {
    const result = await processBillingTick(sessionId, user.id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error';
    const status =
      message === 'FORBIDDEN' ? 403 : message === 'SESSION_NOT_FOUND' ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
