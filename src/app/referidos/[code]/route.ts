import type { NextRequest } from 'next/server';

import { recruiterRedirect } from '@/lib/referral-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Enlace de referidos de un reclutador: /referidos/<code>. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  return recruiterRedirect(req, code);
}
