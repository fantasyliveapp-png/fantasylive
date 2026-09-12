import type { Metadata } from 'next';
import Link from 'next/link';

import { FeedTabs } from '@/components/feed/feed-tabs';
import { PostCard } from '@/components/feed/post-card';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/guards';
import { getVisibilityContext } from '@/lib/geo';
import { getI18n } from '@/lib/i18n/server';
import { getFollowingFeed } from '@/lib/posts';

export const metadata: Metadata = { title: 'Siguiendo' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function FollowingFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  // El feed de seguidos no existe sin sesion: requireUser redirige al login.
  const user = await requireUser();
  const [{ t }, { filter: geoFilter }] = await Promise.all([
    getI18n(),
    getVisibilityContext(),
  ]);

  const posts = await getFollowingFeed({
    viewerId: user.id,
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
        <div className="rounded-xl border border-border/60 bg-card/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {t('feed.emptyFollowing')}
          </p>
          <Link href="/feed">
            <Button variant="brand" className="mt-4">
              {t('feed.discover')}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} isAuthenticated />
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="mt-6 text-center">
          <Link href={`/feed/siguiendo?cursor=${nextCursor}`}>
            <Button variant="outline">{t('common.seeMore')}</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
