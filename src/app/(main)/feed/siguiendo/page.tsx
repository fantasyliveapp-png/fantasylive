import type { Metadata } from 'next';
import Link from 'next/link';

import { InfiniteFeed } from '@/components/feed/infinite-feed';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/guards';
import { getVisibilityContext } from '@/lib/geo';
import { getI18n } from '@/lib/i18n/server';
import { getFollowingFeed } from '@/lib/posts';

export const metadata: Metadata = { title: 'Siguiendo' };
export const dynamic = 'force-dynamic';

const FIRST_PAGE = 10;

export default async function FollowingFeedPage() {
  // El feed de seguidos no existe sin sesion: requireUser redirige al login.
  const user = await requireUser();
  const [{ t }, { filter: geoFilter }] = await Promise.all([
    getI18n(),
    getVisibilityContext(),
  ]);

  const posts = await getFollowingFeed({
    viewerId: user.id,
    geoFilter,
    take: FIRST_PAGE,
    cursor: null,
  });

  return (
    <div className="container max-w-2xl py-6">
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
        <InfiniteFeed kind="following" initialPosts={posts} isAuthenticated />
      )}
    </div>
  );
}
