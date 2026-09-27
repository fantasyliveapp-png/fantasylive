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
  Trophy,
  Mic,
  MicOff,
  Monitor,
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
  startStreamAction,
  type StreamSummary,
} from '@/server/actions/live';
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
}: {
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
  const [source, setSource] = useState<Source>(
    existing?.source ?? (obsConfigured ? 'OBS_RTMP' : 'BROWSER'),
  );
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
      const result = await startStreamAction({
        title: title || undefined,
        source,
        goal: goalIsValid(goalDraft)
          ? { label: goalDraft.label.trim(), tokens: Number(goalDraft.tokens) }
          : undefined,
      });
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('common.somethingWentWrong'));
        return;
      }
      markedRef.current = false;
      setSummary(null);
      room.setGoal(result.data.goal);
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
        <Card>
          <CardHeader>
            <CardTitle>{t('live.startStream')}</CardTitle>
            <CardDescription>
              Apareceras en la portada y en /live mientras emitas. Los
              espectadores pueden enviarte regalos en tokens.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="streamTitle">{t('live.streamTitle')}</Label>
              <Input
                id="streamTitle"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Charlamos un rato..."
                maxLength={120}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSource('BROWSER')}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  source === 'BROWSER'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <Video className="h-5 w-5 text-primary" />
                <p className="mt-2 text-sm font-medium">
                  {t('live.sourceBrowser')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lo mas rapido: das permiso de camara y ya estas emitiendo.
                </p>
              </button>

              <button
                type="button"
                onClick={() => obsConfigured && setSource('OBS_RTMP')}
                disabled={!obsConfigured}
                className={`rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  source === 'OBS_RTMP'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <Monitor className="h-5 w-5 text-primary" />
                <p className="mt-2 text-sm font-medium">{t('live.sourceObs')}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {obsConfigured
                    ? 'Escenas, overlays y mejor calidad. Te damos servidor y clave.'
                    : t('live.obsNotConfigured')}
                </p>
              </button>
            </div>

            <div className="space-y-2 rounded-xl border border-champagne-gold/25 bg-champagne-gold/5 p-4">
              <Label className="flex items-center gap-1.5">
                <Trophy className="h-4 w-4 text-champagne-gold" />
                {t('live.goalOptional')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('live.goalHelp')}</p>
              <GoalFields
                label={goalDraft.label}
                tokens={goalDraft.tokens}
                onChange={setGoalDraft}
              />
            </div>

            <Button variant="brand" onClick={start} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Radio className="h-4 w-4" />
              )}
              {t('live.goLive')}
            </Button>
          </CardContent>
        </Card>
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
            mirror={active.source === 'BROWSER'}
            immersive={active.source === 'BROWSER'}
          >
            {/* Cabecera: directo, tiempo, audiencia, ganancias y terminar */}
            <div className="absolute inset-x-0 top-0 flex items-start gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1.5 rounded-full bg-fantazy-red px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                    <span className="live-dot !h-1.5 !w-1.5 bg-white" />
                    {t('common.live')}
                  </span>
                  <span className={cn('rounded-full px-2.5 py-1 font-mono text-[11px] text-white', glass)}>
                    {formatElapsed(now - (startedAt ?? now))}
                  </span>
                  <span className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white', glass)}>
                    <Eye className="h-3.5 w-3.5" />
                    {viewerCount}
                  </span>
                  <span className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white', glass)}>
                    <Heart className="h-3.5 w-3.5 fill-[#ff2d55] text-[#ff2d55]" />
                    {formatTokens(room.likeCount)}
                  </span>
                </div>
                {room.goal && (
                  <GoalBar goal={room.goal} onClick={() => openGoalSheet()} />
                )}
              </div>

              <div className="ml-auto flex shrink-0 flex-col items-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t('live.endConfirm'))) stop(active.streamId);
                  }}
                  disabled={isPending}
                  aria-label={t('live.endStream')}
                  className={cn('flex h-8 w-8 items-center justify-center rounded-full text-white disabled:opacity-60', glass)}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Power className="h-4 w-4" />
                  )}
                </button>
                <span
                  className="flex items-center gap-1 rounded-full bg-gradient-to-r from-fantazy-red to-champagne-gold px-2.5 py-1 text-xs font-bold tabular-nums text-white shadow-lg"
                  title={t('live.streamGifts', {
                    count: room.giftTotals.count,
                    tokens: formatTokens(room.giftTotals.tokens),
                  })}
                >
                  <Coins className="h-3.5 w-3.5" />
                  {formatTokens(room.giftTotals.tokens)}
                </span>
              </div>
            </div>

            {/* Columna derecha: herramientas de la creadora */}
            <div className="absolute bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.25rem)] right-3 flex flex-col items-center gap-4">
              <RailButton
                onClick={() => openGoalSheet()}
                label={room.goal ? t('live.editGoal') : t('live.setGoal')}
                caption={t('live.goal')}
                className={cn(!room.goal && 'bg-champagne-gold/80 text-black ring-0')}
              >
                <Target className="h-5 w-5" />
              </RailButton>
              {active.source === 'BROWSER' && (
                <>
                  <RailButton onClick={room.toggleMic} label="Microfono" caption="Mic">
                    {room.isMicEnabled ? (
                      <Mic className="h-5 w-5" />
                    ) : (
                      <MicOff className="h-5 w-5 text-[#ff2d55]" />
                    )}
                  </RailButton>
                  <RailButton onClick={room.toggleCamera} label="Camara" caption="Cam">
                    {room.isCameraEnabled ? (
                      <Video className="h-5 w-5" />
                    ) : (
                      <VideoOff className="h-5 w-5 text-[#ff2d55]" />
                    )}
                  </RailButton>
                </>
              )}
              <Link
                href={`/live/${slug}`}
                target="_blank"
                aria-label={t('live.viewAsFan')}
                title={t('live.viewAsFan')}
                className={cn('hidden h-11 w-11 items-center justify-center rounded-full text-white lg:flex', glass)}
              >
                <ExternalLink className="h-5 w-5" />
              </Link>
            </div>

            <GiftBursts
              messages={room.messages}
              className={cn(
                room.goal
                  ? 'top-[calc(max(0.75rem,env(safe-area-inset-top))+7rem)]'
                  : 'top-[calc(max(0.75rem,env(safe-area-inset-top))+3.5rem)]',
              )}
            />
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
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Monitor className="h-7 w-7 text-white/70" />
                <p className="max-w-xs text-sm text-white/80">
                  {t('live.waitingForVideo')}
                </p>
              </div>
            )}
            {room.status === 'error' && (
              <StageNotice>
                <p className="text-sm text-white">
                  {room.error ?? t('common.somethingWentWrong')}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={room.connect}>
                    <RefreshCw className="h-4 w-4" />
                    {t('common.retry')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => stop(active.streamId)}
                    disabled={isPending}
                  >
                    {t('live.endStream')}
                  </Button>
                </div>
              </StageNotice>
            )}

            {/* Chat: la creadora lee y responde sin salir de su imagen */}
            <div className="absolute inset-x-0 bottom-0 space-y-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <LiveChatFeed
                messages={room.messages}
                hostLabel={creatorLabel(gender)}
                className="max-h-[30dvh] w-[calc(100%-4.5rem)] lg:max-h-64"
              />
              <LiveChatComposer
                onSend={room.sendChat}
                disabled={!canChat}
                placeholder={t('live.chatHostPlaceholder')}
              />
            </div>

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
