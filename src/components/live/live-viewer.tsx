'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronUp,
  Coins,
  Eye,
  Gift,
  Heart,
  Loader2,
  Plus,
  RefreshCw,
  Share2,
  Video,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Gender } from '@prisma/client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  FloatingHearts,
  GiftBursts,
  GiftSpotlight,
  GoalBar,
  GoalCelebration,
  LiveChatComposer,
  LiveChatFeed,
  RailButton,
  StageButton,
  glass,
} from '@/components/live/live-chat';
import { LiveStage, StageNotice } from '@/components/live/live-stage';
import { useI18n } from '@/components/providers/i18n-provider';
import { useLiveQueue, useLiveWatchTime } from '@/hooks/use-live-feed';
import { useLiveRoom, type LiveGoal } from '@/hooks/use-live-room';
import { STREAM_GIFT_PRESETS } from '@/lib/constants';
import { creatorLabel } from '@/lib/gender-words';
import { getStreamViewersAction, joinStreamAction } from '@/server/actions/live';
import { toggleFollowAction } from '@/server/actions/follows';
import { sendGiftAction } from '@/server/actions/wallet';
import { cn, formatTokens, initials } from '@/lib/utils';

const VIEWER_POLL_MS = 15_000;
const SWIPE_HINT_KEY = 'fl-live-swipe-hint';
const SWIPE_HINT_MS = 4_000;

/**
 * Pantalla de espectador de un directo, en formato vertical tipo TikTok.
 *
 * Pide el token al servidor al montar (ahi es donde se comprueba el bloqueo
 * geografico, se registra la visita y se dispara el saludo automatico) y luego
 * solo suscribe: nunca pide la camara del espectador.
 */
export function LiveViewer({
  streamId,
  streamTitle,
  model,
  isFollowing,
  balance,
  viewerName,
  initialViewerCount,
  initialGoal,
  feed,
}: {
  streamId: string;
  streamTitle: string | null;
  model: {
    id: string;
    slug: string;
    stageName: string;
    avatarUrl: string | null;
    userId: string;
    isOnline: boolean;
    gender: Gender;
  };
  isFollowing: boolean;
  balance: number;
  viewerName: string;
  initialViewerCount: number;
  initialGoal: LiveGoal | null;
  /** Orden personalizado de directos para deslizar (lib/live-rank.ts). */
  feed: string[];
}) {
  const router = useRouter();
  const { t } = useI18n();

  const [credentials, setCredentials] = useState<{
    token: string | null;
    url: string;
  } | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(initialViewerCount);
  const [localBalance, setLocalBalance] = useState(balance);
  const [giftOpen, setGiftOpen] = useState(false);
  const [following, setFollowing] = useState(isFollowing);
  const [swipeHint, setSwipeHint] = useState(false);
  const [isSending, startSend] = useTransition();
  const [isFollowPending, startFollow] = useTransition();

  // Token de sala: una sola vez por directo.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await joinStreamAction(streamId);
      if (cancelled) return;
      if (result.ok && result.data) {
        setCredentials({ token: result.data.token, url: result.data.url });
        setViewerCount(result.data.viewerCount);
      } else {
        setJoinError(result.error ?? t('common.somethingWentWrong'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [streamId, t]);

  const room = useLiveRoom({
    token: credentials?.token ?? null,
    url: credentials?.url ?? '',
    publishCamera: false,
    displayName: viewerName,
    hostIdentity: model.userId,
    initialGoal,
  });

  // Se puede escribir en cuanto se esta dentro de la sala, aunque el video
  // aun no haya llegado: el chat no depende de la emision.
  const canChat = room.status === 'playing' || room.status === 'waiting-video';

  const { nextSlug, prevSlug } = useLiveQueue(model.slug, feed);
  useLiveWatchTime(streamId, room.status === 'playing');

  // Contador de espectadores: se refresca contra LiveKit, que es la unica
  // fuente fiable, sin abrir otra conexion permanente.
  useEffect(() => {
    const timer = setInterval(async () => {
      const result = await getStreamViewersAction(streamId);
      if (result.ok && result.data) {
        setViewerCount(result.data.viewerCount);
        if (result.data.status === 'ENDED') router.refresh();
      }
    }, VIEWER_POLL_MS);
    return () => clearInterval(timer);
  }, [router, streamId]);

  // La pista de "desliza" se ensena una sola vez por navegador.
  useEffect(() => {
    if (!nextSlug) return;
    try {
      if (localStorage.getItem(SWIPE_HINT_KEY)) return;
      localStorage.setItem(SWIPE_HINT_KEY, '1');
    } catch {
      return;
    }
    setSwipeHint(true);
    const timer = setTimeout(() => setSwipeHint(false), SWIPE_HINT_MS);
    return () => clearTimeout(timer);
  }, [nextSlug]);

  function sendGift(tokens: number, emoji?: string) {
    if (tokens > localBalance) {
      toast.error(t('common.insufficientTokens'));
      return;
    }
    startSend(async () => {
      const result = await sendGiftAction({
        receiverId: model.userId,
        tokens,
        streamId,
        emoji,
      });
      if (result.ok) {
        setLocalBalance(result.balance ?? localBalance - tokens);
        // La hoja se queda abierta para poder repetir y hacer combo; el
        // anuncio en la sala lo hace el servidor al cobrarlo.
      } else {
        toast.error(result.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  function follow() {
    startFollow(async () => {
      const result = await toggleFollowAction(model.id, model.slug);
      if (result.ok) setFollowing(Boolean(result.following));
      else toast.error(result.error ?? t('common.somethingWentWrong'));
    });
  }

  async function share() {
    const url = `${window.location.origin}/live/${model.slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: model.stageName, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success(t('live.linkCopied'));
    } catch {
      // Cancelar el menu de compartir no es un error.
    }
  }

  return (
    <LiveStage
      videoRef={room.videoRef}
      audioRef={room.audioRef}
      immersive
      onDoubleTap={canChat ? room.sendLike : undefined}
      onNext={nextSlug ? () => router.push(`/live/${nextSlug}`) : undefined}
      onPrev={prevSlug ? () => router.push(`/live/${prevSlug}`) : undefined}
      nextLabel={t('live.nextLive')}
      prevLabel={t('live.prevLive')}
    >
      {/* Cabecera: creadora, seguir, espectadores y salir */}
      <div className="absolute inset-x-0 top-0 flex items-start gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className={cn('flex min-w-0 items-center gap-2 rounded-full p-1', glass)}>
          <Link href={`/models/${model.slug}`} className="flex min-w-0 items-center gap-2">
            {/* Anillo de "en directo" girando alrededor de la foto. */}
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
              <span className="absolute inset-0 animate-spin-slow rounded-full bg-[conic-gradient(from_0deg,#C0273C,#C9A876,#ff6fa3,#C0273C)]" />
              <Avatar className="relative h-[34px] w-[34px] border-2 border-black">
                <AvatarImage src={model.avatarUrl ?? undefined} />
                <AvatarFallback>{initials(model.stageName)}</AvatarFallback>
              </Avatar>
            </span>
            <div className="min-w-0 pr-1 leading-tight">
              <p className="max-w-[8rem] truncate text-sm font-bold text-white">
                {model.stageName}
              </p>
              <p className="flex items-center gap-1 text-[11px] text-white/70">
                <Heart className="h-3 w-3 fill-current" />
                {formatTokens(room.likeCount)}
              </p>
            </div>
          </Link>
          {!following && (
            <button
              type="button"
              onClick={follow}
              disabled={isFollowPending}
              aria-label={t('live.follow')}
              className="flex h-8 items-center gap-1 rounded-full bg-fantazy-red px-3 text-xs font-bold text-white transition active:scale-95 disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={3} />
              {t('live.follow')}
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div
            className={cn(
              'flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold tabular-nums text-white',
              glass,
            )}
          >
            <Eye className="h-3.5 w-3.5" />
            {formatTokens(viewerCount)}
          </div>
          <Link
            href="/live"
            aria-label={t('common.close')}
            className={cn('flex h-8 w-8 items-center justify-center rounded-full text-white', glass)}
          >
            <X className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* EN DIRECTO + titulo + meta */}
      <div className="absolute inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.5rem)] space-y-2 px-3">
        <div className="pointer-events-none flex items-center gap-2">
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-fantazy-red px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="live-dot !h-1.5 !w-1.5 bg-white" />
            {t('common.live')}
          </span>
          {streamTitle && (
            <span className="truncate text-xs font-medium text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.7)]">
              {streamTitle}
            </span>
          )}
        </div>
        {room.goal && (
          <GoalBar goal={room.goal} onClick={() => setGiftOpen(true)} />
        )}
      </div>

      <GiftBursts
        messages={room.messages}
        className={cn(
          room.goal
            ? 'top-[calc(max(0.75rem,env(safe-area-inset-top))+9.5rem)]'
            : 'top-[calc(max(0.75rem,env(safe-area-inset-top))+6rem)]',
        )}
      />
      <GiftSpotlight messages={room.messages} />
      <GoalCelebration goal={room.goal} messages={room.messages} />
      <FloatingHearts hearts={room.hearts} />

      {/* Estados: nunca se deja la pantalla en negro sin explicacion. */}
      {joinError && (
        <StageNotice>
          <p className="text-sm text-white">{joinError}</p>
          <Link href="/live">
            <Button variant="outline" size="sm">
              {t('live.title')}
            </Button>
          </Link>
        </StageNotice>
      )}
      {!joinError && (room.status === 'idle' || room.status === 'connecting') && (
        <StageNotice>
          <Loader2 className="h-6 w-6 animate-spin text-white" />
          <p className="text-sm text-white/80">{t('live.preparing')}</p>
        </StageNotice>
      )}
      {!joinError && room.status === 'waiting-video' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Video className="h-7 w-7 text-white/70" />
          <p className="max-w-xs text-sm text-white/80">{t('live.waitingForVideo')}</p>
        </div>
      )}
      {!joinError && room.status === 'error' && (
        <StageNotice>
          <p className="text-sm text-white">{room.error ?? t('common.somethingWentWrong')}</p>
          <Button variant="outline" size="sm" onClick={room.connect}>
            <RefreshCw className="h-4 w-4" />
            {t('common.retry')}
          </Button>
        </StageNotice>
      )}
      {!joinError && room.status === 'ended' && (
        <StageNotice>
          <p className="text-sm text-white">{t('live.ended')}</p>
          <div className="flex gap-2">
            {nextSlug && (
              <Button variant="brand" size="sm" onClick={() => router.push(`/live/${nextSlug}`)}>
                {t('live.nextLive')}
              </Button>
            )}
            <Link href="/live">
              <Button variant="outline" size="sm">
                {t('live.title')}
              </Button>
            </Link>
          </div>
        </StageNotice>
      )}

      {/* Columna derecha: me gusta y compartir */}
      <div className="absolute bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.25rem)] right-3 flex flex-col items-center gap-4">
        <RailButton
          onClick={room.sendLike}
          label={t('live.like')}
          caption={formatTokens(room.likeCount)}
        >
          <Heart className="h-6 w-6 fill-[#ff2d55] text-[#ff2d55]" />
        </RailButton>
        <RailButton onClick={share} label={t('live.share')} caption={t('live.share')}>
          <Share2 className="h-5 w-5" />
        </RailButton>
      </div>

      {/* Pista de deslizar (solo la primera vez) */}
      {swipeHint && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[38%] flex flex-col items-center gap-1 text-white">
          <ChevronUp className="h-8 w-8 animate-swipe-hint" />
          <p className={cn('rounded-full px-3 py-1 text-xs font-medium', glass)}>
            {t('live.swipeHint')}
          </p>
        </div>
      )}

      {/* Chat y barra inferior */}
      <div className="absolute inset-x-0 bottom-0 space-y-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <LiveChatFeed
          messages={room.messages}
          hostLabel={creatorLabel(model.gender)}
          className="max-h-[30dvh] w-[calc(100%-4.5rem)] lg:max-h-64"
        />

        <LiveChatComposer
          onSend={room.sendChat}
          disabled={!canChat}
          placeholder={t('live.chatPlaceholder')}
        >
          <StageButton
            onClick={() => setGiftOpen(true)}
            label={t('live.sendGift')}
            className="bg-gradient-to-br from-fantazy-red to-champagne-gold ring-0"
          >
            <Gift className="h-5 w-5" />
          </StageButton>
        </LiveChatComposer>
      </div>

      {/* Hoja de regalos */}
      {giftOpen && (
        <>
          <button
            type="button"
            aria-label={t('common.close')}
            className="absolute inset-0 z-20 bg-black/20"
            onClick={() => setGiftOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 z-30 animate-in slide-in-from-bottom rounded-t-[28px] bg-[#111]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 ring-1 ring-white/10 backdrop-blur-xl duration-200">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <div className="mb-3 flex items-center justify-between">
              <p className="font-heading text-lg uppercase tracking-wide text-white">
                {t('live.gifts')}
              </p>
              <span className="flex items-center gap-1.5 rounded-full bg-champagne-gold/15 px-3 py-1 text-sm font-semibold text-champagne-gold">
                <Coins className="h-4 w-4" />
                {formatTokens(localBalance)}
              </span>
            </div>

            {room.goal && room.goal.progress < room.goal.target && (
              <GoalBar goal={room.goal} className="mb-3 w-full bg-white/5" />
            )}

            <div className="grid grid-cols-5 gap-2">
              {STREAM_GIFT_PRESETS.map((preset) => (
                <button
                  key={preset.tokens}
                  type="button"
                  disabled={isSending || preset.tokens > localBalance}
                  onClick={() => sendGift(preset.tokens, preset.emoji)}
                  className="group flex flex-col items-center gap-1 rounded-2xl py-3 transition hover:bg-white/5 active:scale-95 disabled:opacity-35"
                >
                  <span
                    className="text-4xl leading-none transition group-hover:scale-110 group-active:scale-90"
                    aria-hidden
                  >
                    {preset.emoji}
                  </span>
                  <span className="text-[11px] text-white/80">{preset.label}</span>
                  <span className="flex items-center gap-0.5 text-[11px] font-semibold text-champagne-gold">
                    <Coins className="h-3 w-3" />
                    {preset.tokens}
                  </span>
                </button>
              ))}
            </div>

            <Link href="/wallet" className="mt-3 block">
              <Button variant="brand" className="w-full">
                {t('common.buyTokens')}
              </Button>
            </Link>
          </div>
        </>
      )}
    </LiveStage>
  );
}
