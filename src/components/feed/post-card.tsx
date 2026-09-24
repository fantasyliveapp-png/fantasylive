'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Coins,
  Crown,
  Heart,
  Loader2,
  Lock,
  MessageCircle,
  Radio,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PostOwnerMenu } from '@/components/feed/post-owner-menu';
import { useJoinPrompt } from '@/components/providers/join-prompt';
import { PostPoll } from '@/components/feed/post-poll';
import { SafetyMenu } from '@/components/social/safety-menu';
import { useI18n } from '@/components/providers/i18n-provider';
import {
  addPostCommentAction,
  getPostCommentsAction,
  hidePostAction,
  togglePostLikeAction,
  unlockPostAction,
} from '@/server/actions/posts';
import type { FeedPost } from '@/lib/posts';
import { markCompleted, useViewTracking } from '@/lib/impressions-client';
import { postAspectRatio } from '@/lib/post-formats';
import { cn, formatTokens, initials, relativeTime } from '@/lib/utils';

interface CommentRow {
  id: string;
  body: string;
  createdAt: string;
  author: string;
  image: string | null;
  profileHref: string | null;
  isMine: boolean;
}

export function PostCard({
  post,
  isAuthenticated,
  preview = false,
}: {
  post: FeedPost;
  isAuthenticated: boolean;
  /** Vista previa del publicador: se ve igual que en el feed pero no hace nada. */
  preview?: boolean;
}) {
  const router = useRouter();
  const joinPrompt = useJoinPrompt();
  const { t } = useI18n();

  const [liked, setLiked] = useState(post.isLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [isPending, startTransition] = useTransition();
  const [isUnlocking, startUnlock] = useTransition();
  const [hidden, setHidden] = useState(false);
  // Tiempo que la tiene en pantalla: lo usa el Descubrir (sin cuenta tambien,
  // para personalizar su feed) y el panel de alcance de la creadora.
  const articleRef = useViewTracking(post.id, !preview && !post.isOwner);

  function notInterested(undo = false) {
    setHidden(!undo);
    void hidePostAction(post.id, undo).then((r) => {
      if (!r.ok) {
        setHidden(undo);
        toast.error(r.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  // Sin cuenta se puede mirar; para hacer algo, el aviso "Unete gratis".
  const requiresLogin = (reason = 'para hacer esto') => {
    if (preview) return true;
    if (isAuthenticated) return false;
    joinPrompt(reason);
    return true;
  };

  function toggleLike() {
    if (requiresLogin('para dar me gusta')) return;

    // Optimista: el corazon responde al instante y se corrige si el servidor
    // dice otra cosa. Un "me gusta" que tarda 300 ms en pintarse se siente roto.
    const previous = { liked, likeCount };
    setLiked(!liked);
    setLikeCount((n) => (liked ? Math.max(0, n - 1) : n + 1));

    startTransition(async () => {
      const result = await togglePostLikeAction(post.id);
      if (!result.ok || !result.data) {
        setLiked(previous.liked);
        setLikeCount(previous.likeCount);
        return;
      }
      setLiked(result.data.liked);
      setLikeCount(result.data.likeCount);
    });
  }

  function unlock() {
    if (requiresLogin('para desbloquear esta publicacion')) return;

    startUnlock(async () => {
      const result = await unlockPostAction(post.id);
      if (result.ok) {
        toast.success(result.message ?? t('feed.unlockedNow'));
        router.refresh();
      } else {
        toast.error(result.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  function loadComments() {
    if (preview) return;
    if (comments) {
      setComments(null);
      return;
    }
    startTransition(async () => {
      const result = await getPostCommentsAction(post.id);
      setComments(result.data ?? []);
    });
  }

  function submitComment() {
    if (requiresLogin('para comentar')) return;
    const body = commentDraft.trim();
    if (!body) return;

    startTransition(async () => {
      const result = await addPostCommentAction({ postId: post.id, body });
      if (!result.ok) {
        toast.error(result.error ?? t('common.somethingWentWrong'));
        return;
      }
      setCommentDraft('');
      setCommentCount((n) => n + 1);
      const refreshed = await getPostCommentsAction(post.id);
      setComments(refreshed.data ?? []);
    });
  }

  if (hidden) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 p-4 text-sm">
        <EyeOff className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Publicacion oculta</span>
          <span className="block text-xs text-muted-foreground">
            Veras menos cosas como esta.
          </span>
        </span>
        <Button variant="outline" size="sm" onClick={() => notInterested(true)}>
          Deshacer
        </Button>
      </div>
    );
  }

  const isLocked = !post.isUnlocked;
  const isSubscriberGate = isLocked && post.visibility === 'SUBSCRIBERS';
  const aspectRatio = postAspectRatio(post.assets);

  return (
    <article
      ref={articleRef}
      className="overflow-hidden rounded-2xl border border-border/60 bg-card"
      // En la vista previa un enlace sacaria a la creadora del borrador.
      onClickCapture={
        preview
          ? (e) => {
              if ((e.target as HTMLElement).closest('a')) e.preventDefault();
            }
          : undefined
      }
    >
      {/* Cabecera */}
      <header className="flex items-center gap-3 p-4">
        <Link href={`/models/${post.model.slug}`} className="shrink-0">
          <Avatar className="h-10 w-10">
            <AvatarImage src={post.model.avatarUrl ?? undefined} />
            <AvatarFallback>{initials(post.model.stageName)}</AvatarFallback>
          </Avatar>
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/models/${post.model.slug}`}
              className="truncate font-semibold hover:underline"
            >
              {post.model.stageName}
            </Link>
            {post.model.isAi && (
              <Badge variant="muted" className="gap-1 px-1.5 py-0 text-[10px]">
                <Bot className="h-3 w-3" />
                IA
              </Badge>
            )}
            {post.model.isLive && (
              <Link href={`/live/${post.model.slug}`}>
                <Badge variant="live" className="gap-1 px-1.5 py-0 text-[10px]">
                  <Radio className="h-3 w-3" />
                  {t('common.live')}
                </Badge>
              </Link>
            )}
          </div>
          {post.scheduledFor ? (
            <p className="flex items-center gap-1 text-xs font-medium text-primary">
              <Clock className="h-3 w-3" />
              Programada ·{' '}
              {new Date(post.scheduledFor).toLocaleString('es', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {relativeTime(new Date(post.createdAt))}
            </p>
          )}
        </div>

        {!post.isOwner && !preview && isAuthenticated && post.model.userId && (
          <SafetyMenu
            targetUserId={post.model.userId}
            targetName={post.model.stageName}
            context={`post:${post.id}`}
            reportLabel="Denunciar publicacion"
            isAuthenticated={isAuthenticated}
            onNotInterested={() => notInterested()}
          />
        )}

        {post.isOwner && !preview && <PostOwnerMenu post={post} />}
      </header>

      {/* Texto */}
      {post.body && (
        <p className="whitespace-pre-wrap px-4 pb-3 text-sm leading-relaxed">
          {post.body}
        </p>
      )}

      {/* Archivos */}
      {post.assets.length > 0 && (
        <PostMediaCarousel count={post.assets.length} aspectRatio={aspectRatio}>
          {post.assets.map((asset) => (
            <div
              key={asset.id}
              className={cn(
                'relative w-full shrink-0 snap-center overflow-hidden bg-muted',
                // Contenido de pago: sin menu "guardar imagen" ni arrastrar.
                post.watermark && 'select-none [-webkit-touch-callout:none]',
              )}
              style={{ aspectRatio }}
              onContextMenu={post.watermark ? (e) => e.preventDefault() : undefined}
            >
              {/*
                Bloqueado: se muestra SOLO la miniatura difuminada. El original
                no esta en el DOM, asi que no hay nada que recuperar desde el
                inspector; la escala compensa el borde blando del difuminado.
              */}
              {isLocked ? (
                <>
                  {asset.previewUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={asset.previewUrl}
                      alt=""
                      aria-hidden
                      className="h-full w-full scale-110 object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-primary/20 via-muted to-muted" />
                  )}

                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 p-4 text-center backdrop-blur-[2px]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60">
                      <Lock className="h-5 w-5 text-white" />
                    </div>

                    {isSubscriberGate ? (
                      <>
                        <p className="text-sm font-medium text-white">
                          {t('feed.subscribersOnly')}
                        </p>
                        {preview ? (
                          <Button variant="brand" size="sm" tabIndex={-1}>
                            <Crown className="h-4 w-4" />
                            {t('feed.subscribeToSee')}
                          </Button>
                        ) : (
                          <Link href={`/models/${post.model.slug}`}>
                            <Button variant="brand" size="sm">
                              <Crown className="h-4 w-4" />
                              {t('feed.subscribeToSee')}
                            </Button>
                          </Link>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-white">
                          {t('feed.lockedHint', { tokens: post.priceTokens })}
                        </p>
                        <Button
                          variant="brand"
                          size="sm"
                          onClick={unlock}
                          disabled={isUnlocking}
                        >
                          {isUnlocking ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Coins className="h-4 w-4" />
                          )}
                          {t('common.unlock')} · {formatTokens(post.priceTokens)}
                        </Button>
                      </>
                    )}
                  </div>
                </>
              ) : asset.mimeType.startsWith('video/') ? (
                <>
                  <video
                    src={asset.url ?? undefined}
                    controls
                    playsInline
                    onTimeUpdate={
                      preview || post.isOwner
                        ? undefined
                        : (e) => {
                            const v = e.currentTarget;
                            if (v.duration && v.currentTime / v.duration >= 0.9) {
                              markCompleted(post.id);
                            }
                          }
                    }
                    controlsList={post.watermark ? 'nodownload noremoteplayback' : undefined}
                    disablePictureInPicture={Boolean(post.watermark)}
                    className="h-full w-full object-cover"
                  />
                  {post.watermark && <VideoWatermark label={post.watermark} />}
                </>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={asset.url ?? undefined}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  draggable={!post.watermark}
                />
              )}
            </div>
          ))}
        </PostMediaCarousel>
      )}

      {/* Encuesta */}
      {post.poll && (
        <div className={cn(post.assets.length > 0 && 'pt-3')}>
          <PostPoll
            poll={post.poll}
            preview={preview}
            showResults={post.isOwner}
            canVote={isAuthenticated && !post.isOwner && !isLocked}
            lockedHint={
              isLocked
                ? isSubscriberGate
                  ? 'Suscribete para votar'
                  : 'Desbloquea para votar'
                : undefined
            }
            onRequireLogin={preview ? undefined : () => requiresLogin('para votar')}
          />
        </div>
      )}

      {/* Acciones */}
      <footer className="flex items-center gap-1 px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLike}
          className={cn('gap-1.5', liked && 'text-rose-400')}
        >
          <Heart className={cn('h-4 w-4', liked && 'fill-current')} />
          {likeCount > 0 ? likeCount : t('feed.like')}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={loadComments}
          className="gap-1.5"
        >
          <MessageCircle className="h-4 w-4" />
          {commentCount > 0 ? commentCount : t('feed.comment')}
        </Button>

        <span className="ml-auto flex items-center gap-3 pr-2 text-xs text-muted-foreground">
          {post.visibility === 'LOCKED' && post.unlockCount > 0 && (
            <span>{t('feed.unlockCount', { count: post.unlockCount })}</span>
          )}
          {/* Alcance: solo lo ve la duena. */}
          {post.views !== null && !post.scheduledFor && (
            <span className="flex items-center gap-1" title="Personas que la han visto">
              <Eye className="h-3.5 w-3.5" />
              {post.views}
            </span>
          )}
        </span>
      </footer>

      {/* Comentarios */}
      {comments && (
        <div className="space-y-3 border-t border-border/60 p-4">
          {comments.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('feed.noComments')}
            </p>
          )}

          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-2.5">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={comment.image ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {initials(comment.author)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 rounded-lg bg-muted/50 px-3 py-2">
                {comment.profileHref ? (
                  <Link
                    href={comment.profileHref}
                    className="text-xs font-medium hover:underline"
                  >
                    {comment.author}
                  </Link>
                ) : (
                  <p className="text-xs font-medium">{comment.author}</p>
                )}
                <p className="mt-0.5 break-words text-sm">{comment.body}</p>
              </div>
            </div>
          ))}

          <div className="flex gap-2">
            <Input
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitComment();
                }
              }}
              placeholder={t('feed.writeComment')}
              maxLength={500}
            />
            <Button
              variant="brand"
              size="icon"
              onClick={submitComment}
              disabled={isPending || !commentDraft.trim()}
              aria-label={t('common.send')}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * Carrusel de los archivos de una publicacion.
 *
 * Con varias fotos se desliza en horizontal (scroll-snap nativo, asi el gesto
 * del movil funciona sin librerias) en vez de apilarlas en rejilla: todas se
 * ven al tamano del formato elegido, igual que en la vista previa.
 */
export function PostMediaCarousel({
  count,
  aspectRatio,
  children,
}: {
  count: number;
  aspectRatio: number;
  children: React.ReactNode;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);

  function go(to: number) {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: to * el.clientWidth, behavior: 'smooth' });
  }

  return (
    <div className="group relative bg-muted/30" style={{ aspectRatio }}>
      <div
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>

      {count > 1 && (
        <>
          <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
            {index + 1}/{count}
          </span>

          {index > 0 && (
            <button
              type="button"
              onClick={() => go(index - 1)}
              className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 sm:block"
              aria-label="Anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {index < count - 1 && (
            <button
              type="button"
              onClick={() => go(index + 1)}
              className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 sm:block"
              aria-label="Siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1">
            {Array.from({ length: count }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 rounded-full bg-white transition-all',
                  i === index ? 'w-4 opacity-100' : 'w-1.5 opacity-50',
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Marca de agua de un video de pago: el @usuario de quien lo mira flotando
 * sobre el video (que cambia de sitio cada pocos segundos, para que no se
 * pueda tapar con un recorte fijo en una grabacion de pantalla).
 */
function VideoWatermark({ label }: { label: string }) {
  const [spot, setSpot] = useState(0);
  const spots = [
    'left-3 top-3',
    'right-3 top-1/3',
    'left-1/4 bottom-16',
    'right-3 bottom-24',
    'left-3 top-1/2',
  ];

  useEffect(() => {
    const timer = window.setInterval(() => setSpot((i) => (i + 1) % spots.length), 7000);
    return () => window.clearInterval(timer);
  }, [spots.length]);

  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute select-none rounded bg-black/25 px-1.5 py-0.5 text-[11px] font-bold text-white/60 transition-all duration-1000',
        spots[spot],
      )}
    >
      {label}
    </span>
  );
}
