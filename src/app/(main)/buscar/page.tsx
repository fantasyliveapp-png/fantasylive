import type { Metadata } from 'next';

import { SearchView } from '@/components/search/search-view';
import { getVisibilityContext } from '@/lib/geo';
import { searchCreators, searchSuggestions } from '@/lib/search';

export const metadata: Metadata = { title: 'Buscar' };
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const { filter } = await getVisibilityContext();

  const [initialResult, suggestions] = await Promise.all([
    q.trim() ? searchCreators(q, filter) : Promise.resolve(null),
    searchSuggestions(filter),
  ]);

  return (
    <div className="container max-w-2xl pb-10">
      <SearchView
        initialQuery={q.trim()}
        initialResult={initialResult}
        suggestions={suggestions}
      />
    </div>
  );
}
