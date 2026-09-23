'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BarChart3,
  Camera,
  Clock,
  Crown,
  Layers,
  Lock,
  Play,
  Plus,
} from 'lucide-react';

import { PostCard } from '@/components/feed/post-card';
import { Button } from '@/components/ui/button';
import type { FeedPost } from '@/lib/posts';
import { formatTokens } from '@/lib/utils';

/**
 * Publicaciones del perfil, como en Instagram: el perfil muestra una
 * cuadricula de 3 columnas y, al tocar una, se abre la pantalla
 * "Publicaciones" con todas en scroll (como el feed), empezando por la
 * elegida. La flecha atras (o el gesto atras del movil) vuelve a la cuadricula.
 */
export function ProfilePostGrid({
  posts,
  isAuthenticated,
  isOwner,
  stageName,
  initialOpenId,
}: {
  posts: FeedPost[];
  isAuthenticated: boolean;
  isOwner: boolean;
  stageName: string;
  /** ?post=<id> (p. ej. desde un aviso): abre directamente esa publicacion. */
  initialOpenId?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(() =>
    initialOpenId && posts.some((p) => p.id === initialOpenId) ? initialOpenId : null,
  );

  // Si se recargo con la pantalla "Publicaciones" abierta, su marca sigue en
  // el historial: se limpia para que la proxima apertura apile la suya.
  useEffect(() => {
    if (window.history.state?.profilePosts) {
      window.history.replaceState({ ...window.history.state, profilePosts: false }, '');
    }
  }, []);

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-foreground/80">
          <Camera className="h-6 w-6" />
        </span>
        <p className="font-heading text-lg uppercase tracking-wide">
          {isOwner ? 'Comparte tu primera publicacion' : 'Aun no hay publicaciones'}
        </p>
        {isOwner && (
          <>
            <p className="max-w-xs text-sm text-muted-foreground">
              Lo que publiques aparece aqui y en el feed de tus seguidores.
            </p>
            <Link href="/dashboard/model/posts?nuevo=1">
              <Button variant="brand" size="sm">
                <Plus className="h-4 w-4" />
                Nueva publicacion
              </Button>
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-xl sm:gap-1">
        {isOwner && (
          <Link
            href="/dashboard/model/posts?nuevo=1"
            className="group flex aspect-[4/5] flex-col items-center justify-center gap-2 bg-muted/40 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-current">
              <Plus className="h-5 w-5" />
            </span>
            <span className="text-[11px] font-medium">Nueva</span>
          </Link>
        )}
        {posts.map((post) => (
          <PostTile key={post.id} post={post} onOpen={() => setOpenId(post.id)} />
        ))}
      </div>

      {openId && (
        <PostsScroller
          posts={posts}
          startId={openId}
          stageName={stageName}
          isAuthenticated={isAuthenticated}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

/**
 * Pantalla "Publicaciones": todas las de la creadora en scroll normal, como el
 * feed, empezando por la que se toco en la cuadricula.
 */
function PostsScroller({
  posts,
  startId,
  stageName,
  isAuthenticated,
  onClose,
}: {
  posts: FeedPost[];
  startId: string;
  stageName: string;
  isAuthenticated: boolean;
  onClose: () => void;
}) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    // Empezar en la publicacion tocada.
    refs.current.get(startId)?.scrollIntoView({ block: 'start' });

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // El gesto/boton "atras" del movil cierra esta pantalla en vez de salir
    // del perfil: se apila una entrada en el historial al abrir.
    // (Una sola vez: en desarrollo React monta los efectos dos veces.)
    if (!window.history.state?.profilePosts) {
      window.history.pushState({ profilePosts: true }, '');
    }
    const onPop = () => closeRef.current();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.history.back();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
  }, [startId]);

  return (
    <div
      className="fixed inset-0 !m-0 z-[60] overflow-y-auto overscroll-contain bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={`Publicaciones de ${stageName}`}
    >
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-border/60 bg-background/90 px-2 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="rounded-full p-2 hover:bg-muted"
          aria-label="Volver al perfil"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 leading-tight">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {stageName}
          </p>
          <p className="font-semibold">Publicaciones</p>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-5 px-3 py-4 pb-24">
        {posts.map((post) => (
          <div
            key={post.id}
            ref={(el) => {
              if (el) refs.current.set(post.id, el);
              else refs.current.delete(post.id);
            }}
            // Deja sitio a la cabecera fija al saltar a una publicacion.
            className="scroll-mt-16"
          >
            <PostCard post={post} isAuthenticated={isAuthenticated} />
          </div>
        ))}
      </div>
    </div>
  );
}

function PostTile({ post, onOpen }: { post: FeedPost; onOpen: () => void }) {
  const first = post.assets[0];
  const locked = !post.isUnlocked;
  const isVideo = first?.mimeType.startsWith('video/');

  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={post.watermark ? (e) => e.preventDefault() : undefined}
      className="group relative aspect-[4/5] overflow-hidden bg-muted"
      aria-label="Ver publicacion"
    >
      {!first ? (
        // Solo texto: el propio texto es la miniatura.
        <span className="flex h-full w-full items-center bg-gradient-to-br from-primary/30 via-card to-champagne-gold/20 p-3 text-left">
          <span className="line-clamp-5 text-[11px] leading-snug sm:text-xs">
            {post.body ?? post.poll?.question}
          </span>
        </span>
      ) : locked ? (
        first.previewUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={first.previewUrl}
            alt=""
            aria-hidden
            className="h-full w-full scale-110 object-cover"
          />
        ) : (
          <span className="block h-full w-full bg-gradient-to-br from-primary/20 via-muted to-muted" />
        )
      ) : isVideo ? (
        <video
          src={first.url ?? undefined}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={first.url ?? undefined}
          alt=""
          loading="lazy"
          draggable={!post.watermark}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      )}

      {post.scheduledFor && (
        <span className="absolute left-1.5 top-1.5 z-10 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
          <Clock className="h-3 w-3" />
          Programada
        </span>
      )}

      {locked && first && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/35">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60">
            {post.visibility === 'SUBSCRIBERS' ? (
              <Crown className="h-4 w-4 text-white" />
            ) : (
              <Lock className="h-4 w-4 text-white" />
            )}
          </span>
          {post.visibility === 'LOCKED' && (
            <span className="rounded-full bg-token px-2 py-0.5 text-[10px] font-bold text-black">
              {formatTokens(post.priceTokens)}
            </span>
          )}
        </span>
      )}

      <span className="pointer-events-none absolute right-1.5 top-1.5 text-white drop-shadow">
        {post.assets.length > 1 ? (
          <Layers className="h-4 w-4" />
        ) : isVideo ? (
          <Play className="h-4 w-4 fill-current" />
        ) : post.poll ? (
          <BarChart3 className="h-4 w-4" />
        ) : null}
      </span>
    </button>
  );
}
