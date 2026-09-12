'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bot,
  Coins,
  Crown,
  Heart,
  Loader2,
  Lock,
  MessageCircle,
  Radio,
  Send,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/components/providers/i18n-provider';
import {
  addPostCommentAction,
  deletePostAction,
  getPostCommentsAction,
  togglePostLikeAction,
  unlockPostAction,
} from '@/server/actions/posts';
import type { FeedPost } from '@/lib/posts';
import { cn, formatTokens, initials, relativeTime } from '@/lib/utils';

interface CommentRow {
  id: string;
  body: string;
  createdAt: string;
  author: string;
  image: string | null;
  isMine: boolean;
}

export function PostCard({
  post,
  isAuthenticated,
}: {
  post: FeedPost;
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();

  const [liked, setLiked] = useState(post.isLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [isPending, startTransition] = useTransition();
  const [isUnlocking, startUnlock] = useTransition();

  const requiresLogin = () => {
    if (isAuthenticated) return false;
    toast.error(t('common.loginRequired'));
    router.push('/login');
    return true;
  };

  function toggleLike() {
    if (requiresLogin()) return;

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
    if (requiresLogin()) return;

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
    if (requiresLogin()) return;
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

  function remove() {
    startTransition(async () => {
      const result = await deletePostAction(post.id);
      if (result.ok) {
        toast.success(result.message ?? '');
        router.refresh();
      } else {
        toast.error(result.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  const isLocked = !post.isUnlocked;
  const isSubscriberGate = isLocked && post.visibility === 'SUBSCRIBERS';

  return (
    <article className="overflow-hidden rounded-2xl border border-border/60 bg-card">
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
          <p className="text-xs text-muted-foreground">
            {relativeTime(new Date(post.createdAt))}
          </p>
        </div>

        {post.isOwner && (
          <Button
            variant="ghost"
            size="icon"
            onClick={remove}
            disabled={isPending}
            aria-label="Eliminar publicacion"
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
      </header>

      {/* Texto */}
      {post.body && (
        <p className="whitespace-pre-wrap px-4 pb-3 text-sm leading-relaxed">
          {post.body}
        </p>
      )}

      {/* Archivos */}
      {post.assets.length > 0 && (
        <div
          className={cn(
            'grid gap-1 bg-muted/30',
            post.assets.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
          )}
        >
          {post.assets.map((asset) => (
            <div
              key={asset.id}
              className="relative aspect-[4/5] overflow-hidden bg-muted"
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
                        <Link href={`/models/${post.model.slug}`}>
                          <Button variant="brand" size="sm">
                            <Crown className="h-4 w-4" />
                            {t('feed.subscribeToSee')}
                          </Button>
                        </Link>
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
                <video
                  src={asset.url ?? undefined}
                  controls
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={asset.url ?? undefined}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              )}
            </div>
          ))}
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

        {post.visibility === 'LOCKED' && post.unlockCount > 0 && (
          <span className="ml-auto pr-2 text-xs text-muted-foreground">
            {t('feed.unlockCount', { count: post.unlockCount })}
          </span>
        )}
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
                <p className="text-xs font-medium">{comment.author}</p>
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
