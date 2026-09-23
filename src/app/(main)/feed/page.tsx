import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { ChevronRight, Sparkles } from 'lucide-react';

import { InfiniteFeed } from '@/components/feed/infinite-feed';
import { ANON_TASTE_COOKIE, decodeAnonTaste } from '@/lib/anon-taste';
import { getCurrentUser } from '@/lib/auth/guards';
import { getVisibilityContext } from '@/lib/geo';
import { getI18n } from '@/lib/i18n/server';
import { prisma } from '@/lib/prisma';
import { getForYouFeed } from '@/lib/recommend';

export const metadata: Metadata = { title: 'Feed' };
export const dynamic = 'force-dynamic';

/** Primera tanda; el resto llega sola al bajar (InfiniteFeed). */
const FIRST_PAGE = 10;

export default async function FeedPage() {
  const [{ t }, viewer, { filter: geoFilter }, jar] = await Promise.all([
    getI18n(),
    getCurrentUser(),
    getVisibilityContext(),
    cookies(),
  ]);
  // Desde cuando mira: lo que vea en esta sesion no cuenta como "ya visto"
  // mientras sigue bajando.
  const sessionStart = new Date();

  const [posts, account] = await Promise.all([
    getForYouFeed({
      viewerId: viewer?.id ?? null,
      geoFilter,
      take: FIRST_PAGE,
      sessionStart,
      anonTaste: viewer ? null : decodeAnonTaste(jar.get(ANON_TASTE_COOKIE)?.value),
    }),
    viewer
      ? prisma.user.findUnique({
          where: { id: viewer.id },
          select: { onboardedAt: true, interests: true, preferredGenders: true, lookingFor: true },
        })
      : null,
  ]);

  const personalized = Boolean(
    account &&
      (account.interests.length || account.preferredGenders.length || account.lookingFor.length),
  );

  return (
    <div className="container max-w-2xl py-6">
      {account && !account.onboardedAt && (
        <Link
          href="/bienvenida"
          className="group mb-5 flex items-center gap-3 rounded-2xl border border-primary/40 bg-gradient-to-r from-primary/15 to-champagne-gold/10 p-4"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Haz tu Descubrir a tu gusto</span>
            <span className="block text-xs text-muted-foreground">
              Responde 3 preguntas y te enseñamos lo que te gusta primero.
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
      {personalized && (
        <p className="mb-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Ordenado segun tus gustos ·
          <Link href="/bienvenida" className="font-medium text-primary hover:underline">
            Cambiar
          </Link>
        </p>
      )}

      {posts.length === 0 ? (
        <p className="rounded-xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
          {t('feed.emptyDiscover')}
        </p>
      ) : (
        <InfiniteFeed
          kind="discover"
          initialPosts={posts}
          isAuthenticated={Boolean(viewer)}
          sessionStart={sessionStart.getTime()}
        />
      )}
    </div>
  );
}
