import type { NextRequest } from 'next/server';

import { refRedirect } from '@/lib/referral-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Enlace de una creadora para sus fans: /r/<su-slug>
 *
 * Guarda 30 dias quien le invito (cookie) y lleva a su perfil. Si se
 * registra, sus gastos con ella le dejan mas a la creadora (referidos).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return refRedirect(req, slug, (s) => `/models/${s}`);
}
