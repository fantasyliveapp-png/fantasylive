'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronUp,
  Clapperboard,
  Tag,
  Coins,
  Eye,
  Gift,
  Heart,
  Loader2,
  Minimize2,
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
  glass,
} from '@/components/live/live-chat';
import { StartPrivateCallButton } from '@/components/calls/start-private-call-button';
import { formatRateNumber } from '@/lib/rates';
import { MessageButton } from '@/components/messages/message-button';
import {
  CreatorCard,
  ExclusiveGallery,
  LiveExclusiveSheet,
  LiveWidget,
  LivePaywallNotice,
  LivePollCard,
  PausedOverlay,
  PinnedMessage,
  TipMenuList,
  TipMenuPanel,
} from '@/components/live/live-extras';
import { LiveStage, StageNotice } from '@/components/live/live-stage';
import { useI18n } from '@/components/providers/i18n-provider';
import { useLiveQueue, useLiveWatchTime } from '@/hooks/use-live-feed';
import { useLiveRoom, type LiveGoal } from '@/hooks/use-live-room';
import { STREAM_GIFT_PRESETS } from '@/lib/constants';
import { creatorLabel } from '@/lib/gender-words';
import { DEFAULT_WIDGET_LAYOUT, type LivePaywall, type LiveWidgetId, type TipMenuItem } from '@/lib/live-state';
import type { ActivePromo } from '@/lib/token-promos';
import { getStreamViewersAction, joinStreamAction } from '@/server/actions/live';
import {
  buyLiveExclusiveAction,
  buyLiveTicketAction,
  getLiveExclusiveMediaAction,
  getLiveMenuExclusivesAction,
  voteLivePollAction,
  type LiveMenuExclusive,
} from '@/server/actions/live-controls';
import { toggleFollowAction } from '@/server/actions/follows';
import { buyTipMenuItemAction, sendGiftAction } from '@/server/actions/wallet';
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
  creator,
  promo,
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
  /** Promocion de tokens del equipo en curso (boton en el dock). */
  promo: ActivePromo | null;
  /** Para su ficha (al tocar su foto). */
  creator: {
    coverUrl: string | null;
    headline: string | null;
    bio: string | null;
    followersCount: number;
    country: string | null;
    /** null si no acepta mensajes. */
    messaging: { priceTokens: number; hasConversation: boolean } | null;
    /** null si no hace videollamadas privadas. */
    call: { rateCentitokens: number; minMinutes: number } | null;
  };
}) {
  const router = useRouter();
  const { t } = useI18n();

  const [credentials, setCredentials] = useState<{
    token: string | null;
    url: string;
  } | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<LivePaywall | null>(null);
  // Cambia para volver a pedir el token (tras pagar la entrada).
  const [joinKey, setJoinKey] = useState(0);
  const [hiddenPollId, setHiddenPollId] = useState<string | null>(null);
  const [isBuying, startBuy] = useTransition();
  const [isVoting, startVote] = useTransition();
  const [viewerCount, setViewerCount] = useState(initialViewerCount);
  const [localBalance, setLocalBalance] = useState(balance);
  const [giftOpen, setGiftOpen] = useState(false);
  const [following, setFollowing] = useState(isFollowing);
  const [swipeHint, setSwipeHint] = useState(false);
  const [isSending, startSend] = useTransition();
  const [isFollowPending, startFollow] = useTransition();
  const [cinema, setCinema] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ from: string; body: string } | null>(null);
  // Contenido exclusivo del menu: que trae, si ya lo tiene y que sugerirle.
  const [exclusives, setExclusives] = useState<Record<string, LiveMenuExclusive>>({});
  const [openExclusive, setOpenExclusive] = useState<string | null>(null);
  const [gallery, setGallery] = useState<{ loading: boolean; items: { id: string; url: string | null; mimeType: string }[] } | null>(null);
  const [isBuyingExclusive, startBuyExclusive] = useTransition();

  const room = useLiveRoom({
    token: credentials?.token ?? null,
    url: credentials?.url ?? '',
    publishCamera: false,
    displayName: viewerName,
    hostIdentity: model.userId,
    initialGoal,
    // La creadora ha pasado el directo a suscriptores / de pago.
    onAccessLost: (next) => {
      setCredentials(null);
      setPaywall(next);
    },
    onKicked: () => {
      setCredentials(null);
      setJoinError('Te han sacado de este directo.');
    },
  });

  // Token de sala: una vez por directo (y otra tras pagar la entrada).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await joinStreamAction(streamId);
      if (cancelled) return;
      if (result.ok && result.data) {
        setPaywall(null);
        if (result.data.state) room.setLiveState(result.data.state);
        room.setPoll(result.data.poll);
        room.setMyVote(result.data.myVote);
        room.setMuted(result.data.muted);
        setCredentials({ token: result.data.token, url: result.data.url });
        setViewerCount(result.data.viewerCount);
      } else if (result.paywall) {
        setPaywall(result.paywall);
      } else {
        setJoinError(result.error ?? t('common.somethingWentWrong'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // room.* son setters estables del hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId, t, joinKey]);

  function buyTicket() {
    startBuy(async () => {
      const r = await buyLiveTicketAction(streamId);
      if (!r.ok) {
        toast.error(r.error ?? t('common.somethingWentWrong'));
        return;
      }
      if (r.data && r.data.balance >= 0) setLocalBalance(r.data.balance);
      toast.success(r.message ?? '');
      setJoinKey((k) => k + 1);
    });
  }

  function vote(option: number) {
    const poll = room.poll;
    if (!poll) return;
    startVote(async () => {
      const r = await voteLivePollAction(poll.id, option);
      if (r.ok && r.data) {
        room.setMyVote(option);
        room.setPoll(r.data);
      } else toast.error(r.error ?? t('common.somethingWentWrong'));
    });
  }

  function pickTipItem(itemId: string, tokens: number) {
    if (tokens > localBalance) {
      toast.error(t('common.insufficientTokens'));
      return;
    }
    startSend(async () => {
      const r = await buyTipMenuItemAction(streamId, itemId);
      if (r.ok) setLocalBalance(r.balance ?? localBalance - tokens);
      else toast.error(r.error ?? t('common.somethingWentWrong'));
    });
  }

  // Cada vez que cambia el menu (o se entra) se recalcula que tiene este fan.
  const menuKey = room.liveState.tipMenu.map((i) => `${i.id}:${i.postId ?? ''}`).join('|');
  useEffect(() => {
    if (!credentials || !room.liveState.tipMenu.some((i) => i.postId)) return;
    let cancelled = false;
    void getLiveMenuExclusivesAction(streamId).then((r) => {
      if (!cancelled && r.ok && r.data) setExclusives(r.data);
    });
    return () => {
      cancelled = true;
    };
    // menuKey resume el menu; credentials, que ya se esta dentro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuKey, credentials, streamId]);

  const ownedExclusives = new Set(
    Object.entries(exclusives)
      .filter(([, v]) => v.info.owned)
      .map(([k]) => k),
  );

  function pickMenuItem(item: TipMenuItem) {
    if (item.postId) {
      setGiftOpen(false);
      setOpenExclusive(item.id);
      return;
    }
    pickTipItem(item.id, item.tokens);
  }

  function buyExclusive(postId: string) {
    startBuyExclusive(async () => {
      const r = await buyLiveExclusiveAction(streamId, postId);
      if (!r.ok) {
        toast.error(r.error ?? t('common.somethingWentWrong'));
        return;
      }
      if (r.data?.balance != null) setLocalBalance(r.data.balance);
      toast.success(r.message ?? '');
      const fresh = await getLiveMenuExclusivesAction(streamId);
      if (fresh.ok && fresh.data) setExclusives(fresh.data);
    });
  }

  async function viewExclusive(postId: string) {
    setGallery({ loading: true, items: [] });
    const r = await getLiveExclusiveMediaAction(postId);
    if (r.ok && r.data) setGallery({ loading: false, items: r.data });
    else {
      setGallery(null);
      toast.error(r.error ?? t('common.somethingWentWrong'));
    }
  }

  const title = room.liveState.title ?? streamTitle;

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

  // La pista de "desliza" se enseña una sola vez por navegador.
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

  const layout = room.liveState.layout;
  const posOf = (id: LiveWidgetId) => layout[id] ?? DEFAULT_WIDGET_LAYOUT[id];
  const showPoll = room.poll && room.poll.id !== hiddenPollId;

  return (
    <LiveStage
      videoRef={room.videoRef}
      audioRef={room.audioRef}
      immersive
      mirror={room.liveState.mirrored}
      onDoubleTap={canChat ? room.sendLike : undefined}
      onNext={nextSlug ? () => router.push(`/live/${nextSlug}`) : undefined}
      onPrev={prevSlug ? () => router.push(`/live/${prevSlug}`) : undefined}
      nextLabel={t('live.nextLive')}
      prevLabel={t('live.prevLive')}
    >
      {/* Pausa: primero, para que la cabecera y el chat queden por encima. */}
      {room.liveState.paused && room.status === 'playing' && <PausedOverlay />}

      {cinema ? (
        /* Modo cine: solo la imagen, con una salida discreta. */
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <span className="flex items-center gap-1.5 rounded-full bg-fantazy-red/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="live-dot !h-1.5 !w-1.5 bg-white" />
            {t('common.live')}
          </span>
          <button
            type="button"
            onClick={() => setCinema(false)}
            className={cn('flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-white', glass)}
          >
            <Minimize2 className="h-3.5 w-3.5" /> Salir del modo cine
          </button>
        </div>
      ) : (
        <>
          {/* Cabecera: todo en una linea y a la misma altura */}
          <div className="absolute inset-x-0 top-0 space-y-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="flex h-11 items-center gap-2">
              <div className={cn('flex h-11 min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-1', glass)}>
                <button
                  type="button"
                  onClick={() => setCardOpen(true)}
                  aria-label={`Ver ficha de ${model.stageName}`}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  {/* Anillo de "en directo" girando alrededor de la foto. */}
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                    <span className="absolute inset-0 animate-spin-slow rounded-full bg-[conic-gradient(from_0deg,#C0273C,#C9A876,#ff6fa3,#C0273C)]" />
                    <Avatar className="relative h-[31px] w-[31px] border-2 border-black">
                      <AvatarImage src={model.avatarUrl ?? undefined} />
                      <AvatarFallback>{initials(model.stageName)}</AvatarFallback>
                    </Avatar>
                  </span>
                  <span className="min-w-0 pr-1 leading-tight">
                    <span className="block max-w-[8rem] truncate text-sm font-bold text-white">{model.stageName}</span>
                    <span className="flex items-center gap-1 text-[11px] text-white/70">
                      <Heart className="h-3 w-3 fill-current" />
                      {formatTokens(room.likeCount)}
                    </span>
                  </span>
                </button>
                {!following && (
                  <button
                    type="button"
                    onClick={follow}
                    disabled={isFollowPending}
                    aria-label={t('live.follow')}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fantazy-red to-champagne-gold text-white transition active:scale-95 disabled:opacity-60"
                    title={t('live.follow')}
                  >
                    <Plus className="h-4 w-4" strokeWidth={3} />
                  </button>
                )}
              </div>

              <div className="ml-auto flex h-11 items-center gap-2">
                <span className={cn('flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold tabular-nums text-white', glass)}>
                  <Eye className="h-3.5 w-3.5" />
                  {formatTokens(viewerCount)}
                </span>
                <Link
                  href="/live"
                  aria-label={t('common.close')}
                  className={cn('flex h-9 w-9 items-center justify-center rounded-full text-white', glass)}
                >
                  <X className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="pointer-events-none flex h-6 items-center gap-2">
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-fantazy-red px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                <span className="live-dot !h-1.5 !w-1.5 bg-white" />
                {t('common.live')}
              </span>
              {title && (
                <span className="truncate text-xs font-medium text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.7)]">
                  {title}
                </span>
              )}
            </div>
          </div>

          {/* Paneles, donde los ha colocado la creadora */}
          {room.goal && (
            <LiveWidget pos={posOf('goal')} label="la meta" className="w-60 max-w-[70%]">
              <GoalBar goal={room.goal} onClick={() => setGiftOpen(true)} className="w-full" />
            </LiveWidget>
          )}
          {showPoll && (
            <LiveWidget pos={posOf('poll')} label="la encuesta" className="w-64 max-w-[72%]">
              <LivePollCard
                poll={room.poll!}
                myVote={room.myVote}
                onVote={vote}
                voting={isVoting}
                onDismiss={() => setHiddenPollId(room.poll!.id)}
              />
            </LiveWidget>
          )}
          {room.liveState.pinned && (
            <LiveWidget pos={posOf('pinned')} label="el mensaje fijado" className="w-72 max-w-[78%]">
              <PinnedMessage text={room.liveState.pinned} />
            </LiveWidget>
          )}
          {room.liveState.tipMenuOnScreen && room.liveState.tipMenu.length > 0 && (
            <LiveWidget pos={posOf('tipmenu')} label="los Especiales" className="w-52 max-w-[60%]">
              <TipMenuPanel
                items={room.liveState.tipMenu}
                balance={localBalance}
                disabled={isSending}
                owned={ownedExclusives}
                onPick={pickMenuItem}
              />
            </LiveWidget>
          )}

          <GiftBursts messages={room.messages} className="top-[calc(max(0.75rem,env(safe-area-inset-top))+5.5rem)]" />
        </>
      )}

      <GiftSpotlight messages={room.messages} />
      <GoalCelebration goal={room.goal} messages={room.messages} />
      <FloatingHearts hearts={room.hearts} />

      {paywall && (
        <LivePaywallNotice
          paywall={paywall}
          modelName={model.stageName}
          balance={localBalance}
          buying={isBuying}
          onBuy={buyTicket}
        />
      )}

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
      {!joinError && !paywall && (room.status === 'idle' || room.status === 'connecting') && (
        <StageNotice>
          <Loader2 className="h-6 w-6 animate-spin text-white" />
          <p className="text-sm text-white/80">{t('live.preparing')}</p>
        </StageNotice>
      )}
      {!joinError && room.status === 'waiting-video' && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] flex flex-col items-center gap-3 p-6 text-center">
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
      {!joinError && !paywall && room.status === 'ended' && (
        <StageNotice>
          <p className="text-sm text-white">
            {room.liveState.wentPrivate ? `${model.stageName} se ha ido a un privado 1 a 1.` : t('live.ended')}
          </p>
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

      {/* Pista de deslizar (solo la primera vez) */}
      {swipeHint && !cinema && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[38%] flex flex-col items-center gap-1 text-white">
          <ChevronUp className="h-8 w-8 animate-swipe-hint" />
          <p className={cn('rounded-full px-3 py-1 text-xs font-medium', glass)}>{t('live.swipeHint')}</p>
        </div>
      )}

      {/* Parte de abajo: chat y columna de acciones alineados en una rejilla */}
      {!cinema && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] space-y-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* Privado 1 a 1: solo si al empezar dijo que acepta (o lo activo). */}
          {creator.call && room.liveState.acceptsPrivate && room.status !== 'ended' && !paywall && (
            <div className="pointer-events-auto">
              <StartPrivateCallButton
                slug={model.slug}
                stageName={model.stageName}
                isOnline
                rateCentitokens={creator.call.rateCentitokens}
                minMinutes={creator.call.minMinutes}
                isAuthenticated
                size="sm"
                className="w-auto rounded-full shadow-lg"
                label={`Privado 1 a 1 · ${formatRateNumber(creator.call.rateCentitokens)}/min`}
              />
            </div>
          )}
          <LiveChatFeed
            messages={room.messages}
            hostLabel={creatorLabel(model.gender)}
            className="pointer-events-auto max-h-[30dvh] w-[88%] lg:max-h-64"
            myName={viewerName}
            onReply={
              canChat && !room.muted
                ? (m) => setReplyTo({ from: m.from, body: m.body })
                : undefined
            }
          />

          {/* Dock: escribir y todas las acciones en una sola barra */}
          <LiveChatComposer
            dock
            className="pointer-events-auto"
            onSend={async (text) => {
              const reason = room.chatBlockReason(text);
              if (reason) {
                toast.error(reason);
                return false;
              }
              const sent = await room.sendChat(text, replyTo ?? undefined);
              if (sent) setReplyTo(null);
              return sent;
            }}
            disabled={!canChat || room.muted}
            placeholder={room.muted ? 'Estas silenciado en este directo' : t('live.chatPlaceholder')}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          >
            <div className="flex shrink-0 items-center gap-1">
              <DockButton onClick={room.sendLike} label={t('live.like')} badge={room.likeCount > 0 ? formatTokens(room.likeCount) : undefined}>
                <Heart className="h-5 w-5 fill-[#ff2d55] text-[#ff2d55]" />
              </DockButton>
              <DockButton onClick={share} label={t('live.share')}>
                <Share2 className="h-[18px] w-[18px]" />
              </DockButton>
              <DockButton onClick={() => setCinema(true)} label="Modo cine">
                <Clapperboard className="h-[18px] w-[18px]" />
              </DockButton>
              {promo && (
                <DockButton
                  onClick={() => router.push('/wallet')}
                  label={`${promo.title}: tokens hasta un ${promo.percentOff}% más baratos`}
                  badge={`−${promo.percentOff}%`}
                  gold
                >
                  <Tag className="h-[18px] w-[18px]" />
                </DockButton>
              )}
              <button
                type="button"
                onClick={() => setGiftOpen(true)}
                aria-label={t('live.sendGift')}
                title={t('live.sendGift')}
                className="ml-0.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-fantazy-red to-champagne-gold text-white shadow-[0_0_16px_rgb(192_39_60/0.45)] transition active:scale-95"
              >
                <Gift className="h-5 w-5" />
              </button>
            </div>
          </LiveChatComposer>
        </div>
      )}

      {/* Ficha de un contenido exclusivo del menu */}
      {openExclusive && exclusives[openExclusive] && (
        <LiveExclusiveSheet
          info={exclusives[openExclusive]!.info}
          suggestion={exclusives[openExclusive]!.suggestion}
          balance={localBalance}
          buying={isBuyingExclusive}
          onBuy={buyExclusive}
          onView={(postId) => void viewExclusive(postId)}
          onClose={() => setOpenExclusive(null)}
        />
      )}
      {openExclusive && !exclusives[openExclusive] && (
        <StageNotice>
          <Loader2 className="h-6 w-6 animate-spin text-white" />
          <button type="button" className="text-xs text-white/60" onClick={() => setOpenExclusive(null)}>
            Cerrar
          </button>
        </StageNotice>
      )}
      {gallery && <ExclusiveGallery items={gallery.items} loading={gallery.loading} onClose={() => setGallery(null)} />}

      {/* Ficha de la creadora */}
      {cardOpen && (
        <CreatorCard
          model={{
            slug: model.slug,
            stageName: model.stageName,
            avatarUrl: model.avatarUrl,
            coverUrl: creator.coverUrl,
            headline: creator.headline,
            bio: creator.bio,
            followersCount: creator.followersCount,
            country: creator.country,
          }}
          onClose={() => setCardOpen(false)}
          actions={
            <div className="grid gap-2 [&_button]:w-full">
              {!following && (
                <Button variant="outline" onClick={follow} disabled={isFollowPending}>
                  <Plus className="h-4 w-4" /> {t('live.follow')}
                </Button>
              )}
              {creator.messaging && (
                <MessageButton
                  modelId={model.id}
                  slug={model.slug}
                  priceTokens={creator.messaging.priceTokens}
                  hasConversation={creator.messaging.hasConversation}
                  isAuthenticated
                />
              )}
              {creator.call && room.liveState.acceptsPrivate && (
                <StartPrivateCallButton
                  slug={model.slug}
                  stageName={model.stageName}
                  isOnline
                  rateCentitokens={creator.call.rateCentitokens}
                  minMinutes={creator.call.minMinutes}
                  isAuthenticated
                  size="default"
                />
              )}
            </div>
          }
        />
      )}

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
            {/* Tu saldo, lo primero que se ve antes de regalar */}
            <div className="mb-4 flex items-center gap-3 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-champagne-gold/15">
                <Coins className="h-5 w-5 text-champagne-gold" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wider text-white/50">Tu saldo</p>
                <p className="font-heading text-2xl leading-none text-white">
                  {formatTokens(localBalance)} <span className="text-sm text-white/60">tokens</span>
                </p>
              </div>
              <Link
                href="/wallet"
                className="flex h-9 items-center gap-1 rounded-full bg-gradient-to-r from-fantazy-red to-champagne-gold px-3 text-xs font-bold text-white"
              >
                <Plus className="h-3.5 w-3.5" /> Recargar
                {promo && <span className="ml-0.5 rounded-full bg-black/30 px-1.5">−{promo.percentOff}%</span>}
              </Link>
            </div>

            {room.goal && room.goal.progress < room.goal.target && (
              <GoalBar goal={room.goal} className="mb-3 w-full bg-white/5" />
            )}

            {room.liveState.tipMenu.length > 0 && (
              <div className="mb-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-white/50">Especiales</p>
                <TipMenuList
                  items={room.liveState.tipMenu}
                  balance={localBalance}
                  disabled={isSending}
                  owned={ownedExclusives}
                  onPick={pickMenuItem}
                />
                <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-white/50">Regalos</p>
              </div>
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

            {promo && (
              <Link
                href="/wallet"
                className="mt-3 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-fantazy-red/25 to-champagne-gold/20 px-3 py-2.5 text-sm text-white ring-1 ring-champagne-gold/30"
              >
                <Tag className="h-4 w-4 text-champagne-gold" />
                <span className="min-w-0 flex-1 truncate">
                  <b>{promo.title}:</b> tokens con un {promo.percentOff}% de descuento
                </span>
                <span className="text-xs font-semibold text-champagne-gold">Ver</span>
              </Link>
            )}
          </div>
        </>
      )}
    </LiveStage>
  );
}

/** Boton del dock inferior del espectador; `badge`: contador pequeno. */
function DockButton({
  onClick,
  label,
  badge,
  gold,
  children,
}: {
  onClick: () => void;
  label: string;
  badge?: string;
  /** Oferta: icono y etiqueta en dorado. */
  gold?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'relative flex h-11 w-10 items-center justify-center rounded-2xl transition hover:bg-white/10 active:scale-90',
        gold ? 'text-champagne-gold' : 'text-white',
      )}
    >
      {children}
      {badge && (
        <span
          className={cn(
            'absolute -top-1 right-0 min-w-4 rounded-full px-1 text-center text-[9px] font-bold leading-4 ring-1',
            gold
              ? 'bg-gradient-to-r from-fantazy-red to-champagne-gold text-white ring-black/30'
              : 'bg-black/80 text-white ring-white/15',
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
