'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Coins,
  Eye,
  Gift,
  Loader2,
  Radio,
  RefreshCw,
  Send,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/components/providers/i18n-provider';
import { useLiveRoom } from '@/hooks/use-live-room';
import { STREAM_GIFT_PRESETS } from '@/lib/constants';
import { getStreamViewersAction, joinStreamAction } from '@/server/actions/live';
import { sendGiftAction } from '@/server/actions/wallet';
import { cn, formatTokens, initials } from '@/lib/utils';

const VIEWER_POLL_MS = 15_000;

/**
 * Pantalla de espectador de un directo.
 *
 * Pide el token al servidor al montar (ahi es donde se comprueba el bloqueo
 * geografico, se registra la visita y se dispara el saludo automatico) y luego
 * solo suscribe: nunca pide la camara del espectador.
 */
export function LiveViewer({
  streamId,
  model,
  balance,
  viewerName,
  initialViewerCount,
}: {
  streamId: string;
  model: {
    slug: string;
    stageName: string;
    avatarUrl: string | null;
    userId: string;
    isOnline: boolean;
  };
  balance: number;
  viewerName: string;
  initialViewerCount: number;
}) {
  const router = useRouter();
  const { t } = useI18n();

  const [credentials, setCredentials] = useState<{
    token: string | null;
    url: string;
  } | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(initialViewerCount);
  const [chatDraft, setChatDraft] = useState('');
  const [localBalance, setLocalBalance] = useState(balance);
  const [giftOpen, setGiftOpen] = useState(false);
  const [isSending, startSend] = useTransition();
  const chatEndRef = useRef<HTMLDivElement | null>(null);

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
  });

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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room.messages.length]);

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
        setGiftOpen(false);
        toast.success(t('live.giftSent', { tokens }));
        // El regalo se anuncia en el chat de la sala para que se vea en vivo.
        void room.sendChat(`${emoji ?? '🎁'} ${tokens} tokens`);
      } else {
        toast.error(result.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  function submitChat() {
    const text = chatDraft.trim();
    if (!text) return;
    void room.sendChat(text);
    setChatDraft('');
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      {/* Video */}
      <div className="space-y-3">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-black">
          <video
            ref={room.videoRef}
            autoPlay
            playsInline
            controls={false}
            className="h-full w-full object-contain"
          />
          <audio ref={room.audioRef} autoPlay />

          {/* Estados: nunca se deja la pantalla en negro sin explicacion. */}
          {joinError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
              <p className="text-sm text-white">{joinError}</p>
              <Link href="/live">
                <Button variant="outline" size="sm">
                  {t('live.title')}
                </Button>
              </Link>
            </div>
          )}

          {!joinError && room.status === 'connecting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
              <p className="text-sm text-white/80">{t('live.preparing')}</p>
            </div>
          )}

          {!joinError && room.status === 'waiting-video' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 p-6 text-center">
              <Video className="h-7 w-7 text-white/70" />
              <p className="max-w-sm text-sm text-white/80">
                {t('live.waitingForVideo')}
              </p>
            </div>
          )}

          {!joinError && room.status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
              <p className="text-sm text-white">
                {room.error ?? t('common.somethingWentWrong')}
              </p>
              <Button variant="outline" size="sm" onClick={room.connect}>
                <RefreshCw className="h-4 w-4" />
                {t('common.retry')}
              </Button>
            </div>
          )}

          {!joinError && room.status === 'ended' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
              <p className="text-sm text-white">{t('live.ended')}</p>
              <Link href="/live">
                <Button variant="brand" size="sm">
                  {t('live.title')}
                </Button>
              </Link>
            </div>
          )}

          {room.status === 'playing' && (
            <div className="absolute left-3 top-3 flex items-center gap-2">
              <Badge variant="live" className="gap-1.5">
                <span className="live-dot !h-2 !w-2 bg-white" />
                {t('common.live')}
              </Badge>
              <div className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur">
                <Eye className="h-3 w-3" />
                {viewerCount}
              </div>
            </div>
          )}
        </div>

        {/* Creadora y acciones */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card p-4">
          <Link href={`/models/${model.slug}`} className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={model.avatarUrl ?? undefined} />
              <AvatarFallback>{initials(model.stageName)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold hover:underline">{model.stageName}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Radio className="h-3 w-3" />
                {t('live.viewers', { count: viewerCount })}
              </p>
            </div>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <Badge variant="token" className="h-9 gap-1.5 px-3 text-sm">
              <Coins className="h-4 w-4" />
              {formatTokens(localBalance)}
            </Badge>
            <Button
              variant="brand"
              onClick={() => setGiftOpen((open) => !open)}
              disabled={isSending}
            >
              <Gift className="h-4 w-4" />
              {t('live.sendGift')}
            </Button>
          </div>
        </div>

        {giftOpen && (
          <div className="flex flex-wrap gap-2 rounded-xl border border-border/60 bg-card p-4">
            {STREAM_GIFT_PRESETS.map((preset) => (
              <Button
                key={preset.tokens}
                variant="outline"
                size="sm"
                disabled={isSending || preset.tokens > localBalance}
                onClick={() => sendGift(preset.tokens, preset.emoji)}
                className="gap-1.5"
              >
                <span aria-hidden>{preset.emoji}</span>
                {preset.tokens}
              </Button>
            ))}
            <Link href="/wallet" className="ml-auto">
              <Button variant="ghost" size="sm">
                {t('common.buyTokens')}
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Chat */}
      <aside className="flex max-h-[70vh] flex-col rounded-2xl border border-border/60 bg-card">
        <header className="border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold">{t('live.chat')}</p>
        </header>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {room.messages.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('common.empty')}</p>
          )}
          {room.messages.map((message) => (
            <p
              key={message.id}
              className={cn(
                'break-words text-sm',
                message.isMine && 'text-primary',
              )}
            >
              <span className="font-medium">{message.from}: </span>
              {message.body}
            </p>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="flex gap-2 border-t border-border/60 p-3">
          <Input
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitChat();
              }
            }}
            placeholder={t('live.chatPlaceholder')}
            maxLength={280}
            disabled={room.status !== 'playing' && room.status !== 'waiting-video'}
          />
          <Button
            variant="brand"
            size="icon"
            onClick={submitChat}
            disabled={!chatDraft.trim()}
            aria-label={t('common.send')}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </aside>
    </div>
  );
}
