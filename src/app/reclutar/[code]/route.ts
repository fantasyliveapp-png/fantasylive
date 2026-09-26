import type { NextRequest } from 'next/server';

import { recruiterRedirect } from '@/lib/referral-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Enlace de un reclutador para traer creadoras: /reclutar/<code>. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  return recruiterRedirect(req, code);
}
