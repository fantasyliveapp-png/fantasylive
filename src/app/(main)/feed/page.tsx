import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Sparkles } from 'lucide-react';

import { PostCard } from '@/components/feed/post-card';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth/guards';
import { getVisibilityContext } from '@/lib/geo';
import { getI18n } from '@/lib/i18n/server';
import { prisma } from '@/lib/prisma';
import { getForYouFeed } from '@/lib/recommend';

export const metadata: Metadata = { title: 'Feed' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string; t?: string }>;
}) {
  const { pagina, t: startParam } = await searchParams;
  const page = Math.max(0, Math.min(500, Number.parseInt(pagina ?? '0', 10) || 0));
  // Cuando empezo a mirar: lo que vea en esta sesion no se le "castiga" en
  // las paginas siguientes, asi el orden no se mueve mientras baja.
  const startMs = Number(startParam);
  const sessionStart =
    page > 0 && Number.isFinite(startMs) && startMs > Date.now() - 6 * 3600_000
      ? new Date(startMs)
      : new Date();
  const [{ t }, viewer, { filter: geoFilter }] = await Promise.all([
    getI18n(),
    getCurrentUser(),
    getVisibilityContext(),
  ]);

  // Ordenado segun sus gustos (preguntas de bienvenida), si los tiene.
  const [posts, account] = await Promise.all([
    getForYouFeed({
      viewerId: viewer?.id ?? null,
      geoFilter,
      page,
      take: PAGE_SIZE,
      sessionStart,
    }),
    viewer
      ? prisma.user.findUnique({
          where: { id: viewer.id },
          select: { onboardedAt: true, interests: true, preferredGenders: true, lookingFor: true },
        })
      : null,
  ]);

  const nextPage = posts.length === PAGE_SIZE ? page + 1 : null;
  const personalized = Boolean(
    account &&
      (account.interests.length || account.preferredGenders.length || account.lookingFor.length),
  );

  return (
    <div className="container max-w-2xl py-6">
      {account && !account.onboardedAt && page === 0 && (
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
      {personalized && page === 0 && (
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

      {nextPage !== null && (
        <div className="mt-6 text-center">
          {/* Paginacion en la URL: se puede compartir y no depende de
              estado de cliente ni de scroll infinito. */}
          <Link href={`/feed?pagina=${nextPage}&t=${sessionStart.getTime()}`}>
            <Button variant="outline">{t('common.seeMore')}</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
