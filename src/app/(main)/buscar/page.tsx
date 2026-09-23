import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { SearchView } from '@/components/search/search-view';
import { ANON_TASTE_COOKIE, decodeAnonTaste } from '@/lib/anon-taste';
import { getCurrentUser } from '@/lib/auth/guards';
import { getVisibilityContext } from '@/lib/geo';
import { getAffinityContext, getExploreMosaic } from '@/lib/personal-search';
import { searchCreators } from '@/lib/search';

export const metadata: Metadata = { title: 'Buscar' };
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const [{ filter }, viewer, jar] = await Promise.all([
    getVisibilityContext(),
    getCurrentUser(),
    cookies(),
  ]);
  const anonTaste = viewer ? null : decodeAnonTaste(jar.get(ANON_TASTE_COOKIE)?.value);
  const affinity = await getAffinityContext({
    viewerId: viewer?.id ?? null,
    ownModelId: viewer?.modelProfileId ?? null,
    anonTaste,
  });

  const [initialResult, mosaic] = await Promise.all([
    q.trim() ? searchCreators(q, filter, affinity) : Promise.resolve(null),
    getExploreMosaic({ ctx: affinity, viewerId: viewer?.id ?? null, anonTaste, geoFilter: filter }),
  ]);

  return (
    <div className="container max-w-3xl pb-10">
      <SearchView
        initialQuery={q.trim()}
        initialResult={initialResult}
        mosaic={mosaic}
        isAuthenticated={Boolean(viewer)}
      />
    </div>
  );
}
