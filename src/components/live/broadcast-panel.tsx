'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Coins,
  Copy,
  ExternalLink,
  Eye,
  Gift,
  Heart,
  Loader2,
  Power,
  Target,
  Mic,
  MicOff,
  Monitor,
  Phone,
  PhoneOff,
  SlidersHorizontal,
  Radio,
  RefreshCw,
  Square,
  UserPlus,
  Users,
  Video,
  VideoOff,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Gender } from '@prisma/client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FloatingHearts,
  GiftBursts,
  GiftSpotlight,
  GoalBar,
  GoalCelebration,
  LiveChatComposer,
  LiveChatFeed,
  RailButton,
  glass,
} from '@/components/live/live-chat';
import { LivePollCard, LiveWidget, PausedOverlay, PinnedMessage, TipMenuPanel } from '@/components/live/live-extras';
import { LiveMoreMenu, ViewerActionsSheet } from '@/components/live/live-more-menu';
import { GoLiveSetup } from '@/components/live/go-live-setup';
import { LiveStage, StageNotice } from '@/components/live/live-stage';
import { useI18n } from '@/components/providers/i18n-provider';
import { useLiveRoom } from '@/hooks/use-live-room';
import {
  endStreamAction,
  getStreamSummaryAction,
  getStreamViewersAction,
  markStreamLiveAction,
  regenerateStreamKeyAction,
  setStreamGoalAction,
  setStreamPrivateAction,
  startStreamAction,
  type StreamSummary,
} from '@/server/actions/live';
import { closeLivePollAction, hideLivePollAction, setWidgetLayoutAction } from '@/server/actions/live-controls';
import { DEFAULT_WIDGET_LAYOUT, type LiveWidgetId, type WidgetPos } from '@/lib/live-state';
import { creatorLabel } from '@/lib/gender-words';
import { cn, formatTokens, initials } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const VIEWER_POLL_MS = 10_000;

/** 65000 -> "01:05"; con horas, "1:02:03". */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

interface GoalDraft {
  label: string;
  tokens: string;
}

const GOAL_PRESETS = [100, 500, 1000, 5000];

function goalIsValid(draft: GoalDraft) {
  return draft.label.trim().length > 0 && Number(draft.tokens) >= 10;
}

/** Texto y cantidad de la meta, con atajos de cantidades tipicas. */
function GoalFields({
  label,
  tokens,
  onChange,
  dark,
}: {
  label: string;
  tokens: string;
  onChange: (draft: GoalDraft) => void;
  /** Sobre el video (hoja oscura) en vez de en el panel. */
  dark?: boolean;
}) {
  const { t } = useI18n();
  const field = dark
    ? 'border-white/10 bg-white/5 text-white placeholder:text-white/40'
    : undefined;
  return (
    <div className="space-y-2">
      <Input
        value={label}
        onChange={(e) => onChange({ label: e.target.value, tokens })}
        placeholder={t('live.goalLabelPlaceholder')}
        maxLength={60}
        className={field}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-32">
          <Coins className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-champagne-gold" />
          <Input
            type="number"
            inputMode="numeric"
            min={10}
            value={tokens}
            onChange={(e) => onChange({ label, tokens: e.target.value })}
            placeholder="500"
            className={cn('pl-9', field)}
          />
        </div>
        {GOAL_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange({ label, tokens: String(preset) })}
            className={cn(
              'h-8 rounded-full px-3 text-xs font-semibold transition',
              String(preset) === tokens
                ? 'bg-champagne-gold text-black'
                : dark
                  ? 'bg-white/10 text-white hover:bg-white/15'
                  : 'bg-muted text-foreground hover:bg-muted/70',
            )}
          >
            {formatTokens(preset)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Pantalla final: lo que ha dado de si el directo, en grande. */
function StreamSummaryView({
  summary,
  likes,
  onAgain,
}: {
  summary: StreamSummary | null;
  likes: number;
  onAgain: () => void;
}) {
  const { t } = useI18n();

  if (!summary) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </CardContent>
      </Card>
    );
  }

  const stats = [
    { label: t('live.duration'), value: formatElapsed(summary.durationSeconds * 1000), icon: Radio },
    { label: t('live.peakViewers'), value: formatTokens(summary.viewerPeak), icon: Eye },
    { label: t('live.likes'), value: formatTokens(likes), icon: Heart },
    { label: t('live.newFollowers'), value: `+${formatTokens(summary.newFollowers)}`, icon: UserPlus },
    { label: t('live.joins'), value: formatTokens(summary.totalJoins), icon: Users },
    { label: t('live.gifts'), value: formatTokens(summary.giftsCount), icon: Gift },
  ];

  return (
    <div className="mx-auto max-w-lg animate-in fade-in slide-in-from-bottom-4 overflow-hidden rounded-[28px] bg-gradient-to-b from-[#1b0a0f] via-[#111] to-[#111] ring-1 ring-white/10 duration-500">
      {/* Cifra principal */}
      <div className="relative px-6 pb-6 pt-8 text-center">
        <div className="absolute inset-x-0 top-0 mx-auto h-40 w-64 rounded-full bg-fantazy-red/25 blur-3xl" />
        <p className="relative text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
          {t('live.summaryTitle')}
        </p>
        <p className="relative mt-3 flex items-center justify-center gap-2 font-heading text-5xl text-champagne-gold">
          <Coins className="h-9 w-9" />
          {formatTokens(summary.tokensEarned)}
        </p>
        <p className="relative mt-1 text-sm text-white/70">{t('live.tokensEarned')}</p>
      </div>

      <div className="grid grid-cols-3 gap-px bg-white/5">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-[#111] px-3 py-4 text-center">
            <Icon className="mx-auto h-4 w-4 text-white/50" />
            <p className="mt-1.5 text-lg font-bold tabular-nums text-white">{value}</p>
            <p className="text-[11px] text-white/55">{label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-5 px-6 py-6">
        {summary.goal && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
              {t('live.goal')}
            </p>
            <GoalBar
              goal={summary.goal}
              className="w-full bg-white/5 ring-white/10 backdrop-blur-none"
            />
          </div>
        )}

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
            {t('live.topFans')}
          </p>
          {summary.topFans.length === 0 ? (
            <p className="text-sm text-white/60">{t('live.noFans')}</p>
          ) : (
            <ol className="space-y-2">
              {summary.topFans.map((fan, index) => (
                <li
                  key={`${fan.name}-${index}`}
                  className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2"
                >
                  <span className="w-5 text-center text-lg">
                    {['🥇', '🥈', '🥉'][index]}
                  </span>
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={fan.avatarUrl ?? undefined} />
                    <AvatarFallback>{initials(fan.name)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                    {fan.name}
                  </span>
                  <span className="flex items-center gap-1 text-sm font-bold text-champagne-gold">
                    <Coins className="h-3.5 w-3.5" />
                    {formatTokens(fan.tokens)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <Link href="/dashboard/model" className="flex-1">
            <Button variant="outline" className="w-full">
              {t('live.done')}
            </Button>
          </Link>
          <Button variant="brand" className="flex-1" onClick={onAgain}>
            <Radio className="h-4 w-4" />
            {t('live.goLiveAgain')}
          </Button>
        </div>
      </div>
    </div>
  );
}

type Source = 'BROWSER' | 'OBS_RTMP';

/** Ultimo modo de emision usado en este dispositivo (camara u OBS). */
const LAST_SOURCE_KEY = 'fl:live-source';

interface ActiveStream {
  streamId: string;
  token: string | null;
  url: string;
  rtmpUrl: string | null;
  streamKey: string | null;
  source: Source;
}

/**
 * Panel de emision de la creadora.
 *
 * Dos caminos: camara del navegador o OBS por RTMP. Con OBS su propia pestana
 * se conecta como espectadora de su directo (el video entra por el ingress),
 * asi puede comprobar que se esta viendo de verdad antes de que entre nadie.
 */
export function BroadcastPanel({
  kycApproved,
  obsConfigured,
  slug,
  stageName,
  userId,
  gender,
  existing,
  totals,
  privateRate,
  privateMinMinutes,
}: {
  /** Tarifa del privado 1 a 1, ya formateada ("9 tokens/min"). */
  privateRate: string;
  privateMinMinutes: number;
  kycApproved: boolean;
  obsConfigured: boolean;
  slug: string;
  stageName: string;
  /** Su identidad en la sala: marca sus mensajes como de quien emite. */
  userId: string;
  /** Para la etiqueta de sus mensajes ("Creadora" / "Creador"). */
  gender: Gender;
  /** Directo ya abierto al cargar la pagina (tras recargar el navegador). */
  existing: {
    streamId: string;
    source: Source;
    rtmpUrl: string | null;
    streamKey: string | null;
    status: string;
  } | null;
  totals: { giftsCount: number; tokensEarned: number } | null;
}) {
  const router = useRouter();
  const { t } = useI18n();

  const [title, setTitle] = useState('');
  /** Respuesta a "¿Quieres recibir privados 1 a 1?" (null = sin contestar). */
  const [acceptsPrivate, setAcceptsPrivate] = useState<boolean | null>(null);
  /** Vista previa de la camara en la pantalla de empezar. */
  const previewRef = useRef<MediaStream | null>(null);
  // Por defecto, la camara del movil/navegador. OBS solo si lo eligio la
  // ultima vez (se recuerda en este dispositivo) o si retoma un directo OBS.
  const [source, setSource] = useState<Source>(existing?.source ?? 'BROWSER');
  useEffect(() => {
    if (existing || !obsConfigured) return;
    try {
      if (localStorage.getItem(LAST_SOURCE_KEY) === 'OBS_RTMP') setSource('OBS_RTMP');
    } catch {
      // Sin almacenamiento: se queda la camara.
    }
  }, [existing, obsConfigured]);
  const [active, setActive] = useState<ActiveStream | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalDraft>({ label: '', tokens: '' });
  const [goalSheet, setGoalSheet] = useState(false);
  const [isGoalPending, startGoal] = useTransition();
  // Resumen tras terminar: data null mientras carga.
  const [summary, setSummary] = useState<{
    likes: number;
    data: StreamSummary | null;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [moreOpen, setMoreOpen] = useState(false);
  const [selectedAuthor, setSelectedAuthor] = useState<{ identity: string; name: string } | null>(null);
  const [replyTo, setReplyTo] = useState<{ from: string; body: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const markedRef = useRef(false);

  // Un directo abierto que sobrevivio a la recarga: se ofrece cerrarlo o,
  // si es OBS, seguir viendolo. No se reconecta la camara sola porque eso
  // volveria a pedir permisos sin que nadie lo haya pedido.
  const pendingExisting = existing && !active ? existing : null;

  const room = useLiveRoom({
    token: active?.token ?? null,
    url: active?.url ?? '',
    publishCamera: active?.source === 'BROWSER',
    displayName: stageName,
    hostIdentity: userId,
    onVideoStarted: () => {
      if (!active || markedRef.current) return;
      markedRef.current = true;
      void markStreamLiveAction(active.streamId);
    },
  });

  const canChat = room.status === 'playing' || room.status === 'waiting-video';

  const posOf = (id: LiveWidgetId) => room.liveState.layout[id] ?? DEFAULT_WIDGET_LAYOUT[id];

  /** Coloca un panel: se ve al momento y se guarda para los fans. */
  function moveWidget(id: LiveWidgetId, pos: WidgetPos) {
    if (!active) return;
    const next = { ...room.liveState.layout, [id]: pos };
    room.setLiveState((prev) => ({ ...prev, layout: next }));
    void setWidgetLayoutAction(active.streamId, next).then((r) => {
      if (!r.ok) toast.error(r.error ?? t('common.somethingWentWrong'));
    });
  }

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const result = await getStreamViewersAction(active.streamId);
      if (result.ok && result.data) setViewerCount(result.data.viewerCount);
    }, VIEWER_POLL_MS);
    return () => clearInterval(timer);
  }, [active]);

  // Reloj del directo, como el contador de tiempo de TikTok Live.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  function start() {
    startTransition(async () => {
      // Suelta la camara de la vista previa: la va a coger el directo.
      previewRef.current?.getTracks().forEach((t) => t.stop());
      previewRef.current = null;
      // La meta se pone ya dentro del directo (boton "Meta").
      const result = await startStreamAction({
        title: title || undefined,
        source,
        acceptsPrivate: acceptsPrivate === true,
      });
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('common.somethingWentWrong'));
        return;
      }
      try {
        localStorage.setItem(LAST_SOURCE_KEY, source);
      } catch {
        // Sin almacenamiento: no se recuerda, no pasa nada.
      }
      markedRef.current = false;
      setSummary(null);
      room.setGoal(result.data.goal);
      if (result.data.state) room.setLiveState(result.data.state);
      room.setPoll(null);
      setStartedAt(Date.now());
      setNow(Date.now());
      setActive({
        streamId: result.data.streamId,
        token: result.data.token,
        url: result.data.url,
        rtmpUrl: result.data.rtmpUrl,
        streamKey: result.data.streamKey,
        source: result.data.source,
      });
    });
  }

  function stop(streamId: string) {
    const likes = room.likeCount;
    const wasActive = Boolean(active);
    startTransition(async () => {
      const result = await endStreamAction(streamId);
      room.disconnect();
      setActive(null);
      setGoalSheet(false);
      setMoreOpen(false);
      setSelectedAuthor(null);
      markedRef.current = false;
      if (result.ok) {
        router.refresh();
        // Solo hay resumen de un directo que se ha visto emitir en esta
        // pestana; cerrar uno olvidado de otra sesion no lo necesita.
        if (!wasActive) {
          toast.success(result.message ?? '');
          return;
        }
        setSummary({ likes, data: null });
        const summaryResult = await getStreamSummaryAction(streamId);
        if (summaryResult.ok && summaryResult.data) {
          setSummary({ likes, data: summaryResult.data });
        } else {
          setSummary(null);
          toast.success(result.message ?? '');
        }
      } else {
        toast.error(result.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  function togglePrivate(next: boolean) {
    if (!active) return;
    room.setLiveState((prev) => ({ ...prev, acceptsPrivate: next }));
    startTransition(async () => {
      const r = await setStreamPrivateAction(active.streamId, next);
      if (r.ok) toast.success(r.message ?? '');
      else {
        room.setLiveState((prev) => ({ ...prev, acceptsPrivate: !next }));
        toast.error(r.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  function openGoalSheet() {
    setGoalDraft(
      room.goal
        ? { label: room.goal.label, tokens: String(room.goal.target) }
        : { label: '', tokens: '' },
    );
    setGoalSheet(true);
  }

  function saveGoal(draft: GoalDraft | null) {
    if (!active) return;
    startGoal(async () => {
      const result = await setStreamGoalAction(
        active.streamId,
        draft ? { label: draft.label.trim(), tokens: Number(draft.tokens) } : null,
      );
      if (result.ok && result.data) {
        room.setGoal(result.data.goal);
        setGoalSheet(false);
        toast.success(t('live.goalSaved'));
      } else {
        toast.error(result.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  function regenerate() {
    startTransition(async () => {
      const result = await regenerateStreamKeyAction();
      if (result.ok) {
        toast.success(result.message ?? '');
        router.refresh();
      } else {
        toast.error(result.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('live.copied'));
    } catch {
      toast.error('No se pudo copiar. Selecciona el texto a mano.');
    }
  }

  if (!kycApproved) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('live.startStream')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            {t('live.kycRequired')}
          </p>
          <Link href="/dashboard/model/kyc">
            <Button variant="brand">Enviar verificacion</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Directo en curso de una sesion anterior */}
      {pendingExisting && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="text-base">
              Tienes un directo abierto
            </CardTitle>
            <CardDescription>
              Se quedo en estado {pendingExisting.status}. Cierralo antes de
              empezar otro, o los espectadores se repartirian entre dos salas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => stop(pendingExisting.streamId)}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              {t('live.endStream')}
            </Button>
          </CardContent>
        </Card>
      )}

      {!active && summary ? (
        <StreamSummaryView
          summary={summary.data}
          likes={summary.likes}
          onAgain={() => setSummary(null)}
        />
      ) : !active ? (
        <GoLiveSetup
          title={title}
          onTitle={setTitle}
          source={source}
          onSource={setSource}
          obsConfigured={obsConfigured}
          acceptsPrivate={acceptsPrivate}
          onAcceptsPrivate={setAcceptsPrivate}
          privateRate={privateRate}
          privateMinMinutes={privateMinMinutes}
          onStart={start}
          pending={isPending}
          previewRef={previewRef}
        />
      ) : (
        <>
          {/* Credenciales de OBS */}
          {active.source === 'OBS_RTMP' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('live.obsTitle')}</CardTitle>
                <CardDescription>{t('live.obsHelp')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>{t('live.obsServer')}</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={active.rtmpUrl ?? ''} />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copy(active.rtmpUrl ?? '')}
                      aria-label={t('live.obsServer')}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>{t('live.obsKey')}</Label>
                  <div className="flex gap-2">
                    <Input readOnly type="password" value={active.streamKey ?? ''} />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copy(active.streamKey ?? '')}
                      aria-label={t('live.copyKey')}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={regenerate}
                      disabled={isPending}
                      aria-label={t('live.regenerateKey')}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    No compartas esta clave: quien la tenga puede emitir en tu
                    canal.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <LiveStage
            videoRef={room.videoRef}
            audioRef={room.audioRef}
            muted={active.source === 'BROWSER'}
            // Su vista previa: como un espejo con la camara frontal.
            mirror={active.source === 'BROWSER' && room.facingMode === 'user'}
            immersive={active.source === 'BROWSER'}
          >
            {room.liveState.paused && <PausedOverlay host />}

            {/* Cabecera: una sola linea, todo a la misma altura */}
            <div className="absolute inset-x-0 top-0 flex h-[calc(max(0.75rem,env(safe-area-inset-top))+2.25rem)] items-end gap-1.5 px-3">
              <span className="flex h-7 items-center gap-1.5 rounded-full bg-fantazy-red px-2.5 text-[10px] font-bold uppercase tracking-wider text-white">
                <span className="live-dot !h-1.5 !w-1.5 bg-white" />
                {t('common.live')}
              </span>
              <span className={cn('flex h-7 items-center rounded-full px-2.5 font-mono text-[11px] text-white', glass)}>
                {formatElapsed(now - (startedAt ?? now))}
              </span>
              <span className={cn('flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold tabular-nums text-white', glass)}>
                <Eye className="h-3.5 w-3.5" />
                {viewerCount}
              </span>
              <span className={cn('hidden h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold tabular-nums text-white min-[380px]:flex', glass)}>
                <Heart className="h-3.5 w-3.5 fill-[#ff2d55] text-[#ff2d55]" />
                {formatTokens(room.likeCount)}
              </span>

              <span
                className="ml-auto flex h-7 items-center gap-1 rounded-full bg-gradient-to-r from-fantazy-red to-champagne-gold px-2.5 text-xs font-bold tabular-nums text-white shadow-lg"
                title={t('live.streamGifts', {
                  count: room.giftTotals.count,
                  tokens: formatTokens(room.giftTotals.tokens),
                })}
              >
                <Coins className="h-3.5 w-3.5" />
                {formatTokens(room.giftTotals.tokens)}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('live.endConfirm'))) stop(active.streamId);
                }}
                disabled={isPending}
                aria-label={t('live.endStream')}
                className={cn('flex h-7 w-7 items-center justify-center rounded-full text-white disabled:opacity-60', glass)}
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
              </button>
            </div>

            {/* Paneles: los arrastra por el asa dorada y los fans los ven ahi */}
            {room.goal && (
              <LiveWidget pos={posOf('goal')} editable onMove={(p) => moveWidget('goal', p)} label="la meta" className="w-60 max-w-[70%]">
                <GoalBar goal={room.goal} onClick={() => openGoalSheet()} className="w-full" />
              </LiveWidget>
            )}
            {room.poll && (
              <LiveWidget pos={posOf('poll')} editable onMove={(p) => moveWidget('poll', p)} label="la encuesta" className="w-64 max-w-[72%]">
                <LivePollCard
                  poll={room.poll}
                  myVote={null}
                  host
                  onClose={() => {
                    const pollId = room.poll!.id;
                    void closeLivePollAction(active.streamId, pollId).then((r) => {
                      if (r.ok && r.data) room.setPoll(r.data);
                    });
                  }}
                  onDismiss={() => {
                    void hideLivePollAction(active.streamId).then((r) => {
                      if (r.ok) room.setPoll(null);
                    });
                  }}
                />
              </LiveWidget>
            )}
            {room.liveState.pinned && (
              <LiveWidget pos={posOf('pinned')} editable onMove={(p) => moveWidget('pinned', p)} label="el mensaje fijado" className="w-72 max-w-[78%]">
                <PinnedMessage text={room.liveState.pinned} />
              </LiveWidget>
            )}
            {room.liveState.tipMenuOnScreen && room.liveState.tipMenu.length > 0 && (
              <LiveWidget pos={posOf('tipmenu')} editable onMove={(p) => moveWidget('tipmenu', p)} label="tus Especiales" className="w-52 max-w-[60%]">
                <TipMenuPanel items={room.liveState.tipMenu} />
              </LiveWidget>
            )}

            <GiftBursts messages={room.messages} className="top-[calc(max(0.75rem,env(safe-area-inset-top))+3rem)]" />
            <GiftSpotlight messages={room.messages} />
            <GoalCelebration goal={room.goal} messages={room.messages} />
            <FloatingHearts hearts={room.hearts} />

            {(room.status === 'idle' || room.status === 'connecting') && (
              <StageNotice>
                <Loader2 className="h-6 w-6 animate-spin text-white" />
                <p className="text-sm text-white/80">{t('live.preparing')}</p>
              </StageNotice>
            )}
            {room.status === 'waiting-video' && (
              <div className="pointer-events-none absolute inset-x-0 top-[38%] flex flex-col items-center gap-3 p-6 text-center">
                <Monitor className="h-7 w-7 text-white/70" />
                <p className="max-w-xs text-sm text-white/80">{t('live.waitingForVideo')}</p>
              </div>
            )}
            {room.status === 'error' && (
              <StageNotice>
                <p className="text-sm text-white">{room.error ?? t('common.somethingWentWrong')}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={room.connect}>
                    <RefreshCw className="h-4 w-4" />
                    {t('common.retry')}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => stop(active.streamId)} disabled={isPending}>
                    {t('live.endStream')}
                  </Button>
                </div>
              </StageNotice>
            )}

            {/* Parte de abajo: chat y herramientas alineados en una rejilla */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] space-y-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="pointer-events-none flex items-end gap-3 [&>*]:pointer-events-auto">
                <LiveChatFeed
                  messages={room.messages}
                  hostLabel={creatorLabel(gender)}
                  className="max-h-[30dvh] min-w-0 flex-1 lg:max-h-64"
                  onSelectAuthor={setSelectedAuthor}
                  onReply={(m) => setReplyTo({ from: m.from, body: m.body })}
                  myName={stageName}
                />
                <div className="flex w-14 shrink-0 flex-col items-center gap-3">
                  {/* Panel de control: aro con los colores de la marca */}
                  <button type="button" onClick={() => setMoreOpen(true)} aria-label="Panel de control" className="group flex w-14 flex-col items-center gap-1">
                    <span className="rounded-2xl bg-gradient-to-br from-fantazy-red via-[#e0566b] to-champagne-gold p-[2px] shadow-[0_0_18px_rgb(201_168_118/0.35)] transition group-active:scale-95">
                      <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-black/70 text-white backdrop-blur">
                        <SlidersHorizontal className="h-5 w-5" />
                      </span>
                    </span>
                    <span className="text-[10px] font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]">Control</span>
                  </button>
                  <HostTile onClick={() => openGoalSheet()} label={room.goal ? t('live.editGoal') : t('live.setGoal')} caption={t('live.goal')} highlight={!room.goal}>
                    <Target className="h-5 w-5" />
                  </HostTile>
                  <HostTile
                    onClick={() => togglePrivate(!room.liveState.acceptsPrivate)}
                    label={room.liveState.acceptsPrivate ? 'Dejar de aceptar privados' : 'Aceptar privados 1 a 1'}
                    caption="1 a 1"
                    on={room.liveState.acceptsPrivate}
                  >
                    {room.liveState.acceptsPrivate ? <Phone className="h-5 w-5" /> : <PhoneOff className="h-5 w-5" />}
                  </HostTile>
                  {active.source === 'BROWSER' && (
                    <>
                      <HostTile onClick={room.toggleMic} label="Microfono" caption="Mic">
                        {room.isMicEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5 text-[#ff2d55]" />}
                      </HostTile>
                      <HostTile onClick={room.toggleCamera} label="Camara" caption="Cam">
                        {room.isCameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5 text-[#ff2d55]" />}
                      </HostTile>
                    </>
                  )}
                  <Link
                    href={`/live/${slug}`}
                    target="_blank"
                    aria-label={t('live.viewAsFan')}
                    title={t('live.viewAsFan')}
                    className={cn('hidden h-10 w-10 items-center justify-center rounded-2xl text-white lg:flex', glass)}
                  >
                    <ExternalLink className="h-5 w-5" />
                  </Link>
                </div>
              </div>
              <LiveChatComposer
                className="pointer-events-auto"
                onSend={async (text) => {
                  const sent = await room.sendChat(text, replyTo ?? undefined);
                  if (sent) setReplyTo(null);
                  return sent;
                }}
                disabled={!canChat}
                placeholder={t('live.chatHostPlaceholder')}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
              />
            </div>

            {moreOpen && (
              <LiveMoreMenu
                streamId={active.streamId}
                browserSource={active.source === 'BROWSER'}
                room={room}
                onClose={() => setMoreOpen(false)}
              />
            )}
            {selectedAuthor && (
              <ViewerActionsSheet
                streamId={active.streamId}
                author={selectedAuthor}
                onClose={() => setSelectedAuthor(null)}
                onReply={(name) => {
                  const last = [...room.messages].reverse().find((m) => m.identity === selectedAuthor.identity);
                  setReplyTo({ from: name, body: last?.body ?? '' });
                  setSelectedAuthor(null);
                }}
              />
            )}

            {/* Hoja para poner o cambiar la meta sin dejar de emitir */}
            {goalSheet && (
              <>
                <button
                  type="button"
                  aria-label={t('common.close')}
                  className="absolute inset-0 z-20 bg-black/20"
                  onClick={() => setGoalSheet(false)}
                />
                <div className="absolute inset-x-0 bottom-0 z-30 animate-in slide-in-from-bottom space-y-3 rounded-t-[28px] bg-[#111]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 ring-1 ring-white/10 backdrop-blur-xl duration-200">
                  <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
                  <p className="font-heading text-lg uppercase tracking-wide text-white">
                    {room.goal ? t('live.editGoal') : t('live.setGoal')}
                  </p>
                  <GoalFields
                    label={goalDraft.label}
                    tokens={goalDraft.tokens}
                    onChange={setGoalDraft}
                    dark
                  />
                  <div className="flex gap-2">
                    {room.goal && (
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => saveGoal(null)}
                        disabled={isGoalPending}
                      >
                        {t('live.removeGoal')}
                      </Button>
                    )}
                    <Button
                      variant="brand"
                      className="flex-1"
                      onClick={() => saveGoal(goalDraft)}
                      disabled={isGoalPending || !goalIsValid(goalDraft)}
                    >
                      {isGoalPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      {t('common.save')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </LiveStage>
        </>
      )}

      {totals && (totals.giftsCount > 0 || totals.tokensEarned > 0) && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-6 pt-6">
            <div className="flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">
                Regalos recibidos:
              </span>
              <span className="font-semibold">{totals.giftsCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Tokens ganados en directos:
              </span>
              <span className="font-semibold text-token">
                {formatTokens(totals.tokensEarned)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Herramienta de la columna derecha de la creadora (cuadrado suave). */
function HostTile({
  onClick,
  label,
  caption,
  highlight,
  on,
  children,
}: {
  onClick: () => void;
  label: string;
  caption: string;
  /** Destacada en dorado (p. ej. "pon una meta"). */
  highlight?: boolean;
  /** Interruptor encendido (verde). */
  on?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="group flex w-14 flex-col items-center gap-1">
      <span
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-2xl text-white transition group-active:scale-90',
          highlight ? 'bg-champagne-gold/85 text-black' : on ? 'bg-state-connected text-white' : glass,
        )}
      >
        {children}
      </span>
      <span className="text-[10px] font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]">{caption}</span>
    </button>
  );
}
