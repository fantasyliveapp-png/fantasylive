import type { NextRequest } from 'next/server';

import { refRedirect } from '@/lib/referral-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Enlace de un creador para invitar a otros creadores:
 * /r/<su-slug>/creador -> registro como creador, recordando quien invito.
 * La direccion antigua /r/<slug>/creadora redirige aqui (next.config.mjs).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return refRedirect(req, slug, () => '/register?role=model');
}
