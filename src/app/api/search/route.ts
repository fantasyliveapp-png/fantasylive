import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';

import { ANON_TASTE_COOKIE, decodeAnonTaste } from '@/lib/anon-taste';
import { getCurrentUser } from '@/lib/auth/guards';
import { getVisibilityContext } from '@/lib/geo';
import { getAffinityContext } from '@/lib/personal-search';
import { searchCreators } from '@/lib/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=texto
 *
 * Resultados mientras se escribe en el buscador. Publico (como el catalogo),
 * con el mismo filtro de pais y verificacion, y ordenado tambien por los
 * gustos de quien busca (con cuenta o, sin ella, su cookie de gustos).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const [{ filter }, viewer, jar] = await Promise.all([
    getVisibilityContext(),
    getCurrentUser(),
    cookies(),
  ]);
  const affinity = await getAffinityContext({
    viewerId: viewer?.id ?? null,
    ownModelId: viewer?.modelProfileId ?? null,
    anonTaste: viewer ? null : decodeAnonTaste(jar.get(ANON_TASTE_COOKIE)?.value),
  });
  const result = await searchCreators(q, filter, affinity);
  return NextResponse.json(result);
}
