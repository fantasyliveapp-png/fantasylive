import { NextResponse, type NextRequest } from 'next/server';

import { getVisibilityContext } from '@/lib/geo';
import { searchCreators } from '@/lib/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=texto
 *
 * Resultados mientras se escribe en el buscador. Publico (como el catalogo),
 * con el mismo filtro de pais y verificacion.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const { filter } = await getVisibilityContext();
  const result = await searchCreators(q, filter);
  return NextResponse.json(result);
}
