import type { NextRequest } from 'next/server';

import { refRedirect } from '@/lib/referral-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Enlace de una creadora para invitar a otras creadoras:
 * /r/<su-slug>/creadora -> registro como creadora, recordando quien invito.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return refRedirect(req, slug, () => '/register?role=model');
}
