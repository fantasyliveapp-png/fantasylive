import type { Metadata } from 'next';
import Link from 'next/link';

import { FeedTabs } from '@/components/feed/feed-tabs';
import { PostCard } from '@/components/feed/post-card';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth/guards';
import { getVisibilityContext } from '@/lib/geo';
import { getI18n } from '@/lib/i18n/server';
import { getDiscoverFeed } from '@/lib/posts';

export const metadata: Metadata = { title: 'Feed' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const [{ t }, viewer, { filter: geoFilter }] = await Promise.all([
    getI18n(),
    getCurrentUser(),
    getVisibilityContext(),
  ]);

  const posts = await getDiscoverFeed({
    viewerId: viewer?.id ?? null,
    geoFilter,
    take: PAGE_SIZE,
    cursor: cursor ?? null,
  });

  const nextCursor =
    posts.length === PAGE_SIZE ? posts[posts.length - 1]!.id : null;

  return (
    <div className="container max-w-2xl py-6">
      <FeedTabs />

      {posts.length === 0 ? (
        <p className="rounded-xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
          {t('feed.emptyDiscover')}
        </p>
      ) : (
        <div className="space-y-5">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              isAuthenticated={Boolean(viewer)}
            />
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="mt-6 text-center">
          {/* Paginacion por cursor en la URL: se puede compartir y no
              depende de estado de cliente ni de scroll infinito. */}
          <Link href={`/feed?cursor=${nextCursor}`}>
            <Button variant="outline">{t('common.seeMore')}</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
