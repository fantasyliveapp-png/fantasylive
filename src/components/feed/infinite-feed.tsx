'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { PostCard } from '@/components/feed/post-card';
import type { FeedPost } from '@/lib/posts';
import { loadDiscoverAction, loadFollowingAction } from '@/server/actions/feed';

/**
 * Feed con SCROLL INFINITO: al acercarse al final pide la siguiente tanda
 * sola, sin boton de "ver mas". En el Descubrir se mandan los ids ya
 * mostrados para que no se repita nada aunque el orden se recalcule.
 */
export function InfiniteFeed({
  initialPosts,
  isAuthenticated,
  kind,
  sessionStart,
}: {
  initialPosts: FeedPost[];
  isAuthenticated: boolean;
  kind: 'discover' | 'following';
  /** ms: cuando empezo a mirar (solo Descubrir) */
  sessionStart?: number;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialPosts.length === 0);
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const busy = useRef(false);

  const loadMore = useCallback(async () => {
    if (busy.current || done) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const next =
        kind === 'discover'
          ? await loadDiscoverAction({
              exclude: posts.map((p) => p.id),
              sessionStart: sessionStart ?? Date.now(),
            })
          : await loadFollowingAction(posts[posts.length - 1]!.id);
      const seen = new Set(posts.map((p) => p.id));
      const fresh = next.filter((p) => !seen.has(p.id));
      if (fresh.length === 0) setDone(true);
      else setPosts((prev) => [...prev, ...fresh]);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [done, kind, posts, sessionStart]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || done || failed) return;
    // Empieza a cargar bastante antes de llegar al final: no se nota la espera.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMore();
      },
      { rootMargin: '1200px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, done, failed]);

  return (
    <>
      <div className="space-y-5">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} isAuthenticated={isAuthenticated} />
        ))}
      </div>

      <div ref={sentinel} className="flex justify-center py-8" aria-live="polite">
        {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
        {failed && (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="text-sm font-medium text-primary hover:underline"
          >
            No se pudo cargar. Reintentar
          </button>
        )}
        {done && posts.length > 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Ya lo has visto todo. Vuelve pronto para ver mas.
          </p>
        )}
      </div>
    </>
  );
}
