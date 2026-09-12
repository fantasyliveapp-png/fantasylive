'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Copy,
  Eye,
  Gift,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  Radio,
  RefreshCw,
  Square,
  Video,
  VideoOff,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
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
import { useI18n } from '@/components/providers/i18n-provider';
import { useLiveRoom } from '@/hooks/use-live-room';
import {
  endStreamAction,
  getStreamViewersAction,
  markStreamLiveAction,
  regenerateStreamKeyAction,
  startStreamAction,
} from '@/server/actions/live';
import { formatTokens } from '@/lib/utils';

const VIEWER_POLL_MS = 10_000;

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
  existing,
  totals,
}: {
  kycApproved: boolean;
  obsConfigured: boolean;
  slug: string;
  stageName: string;
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
    onVideoStarted: () => {
      if (!active || markedRef.current) return;
      markedRef.current = true;
      void markStreamLiveAction(active.streamId);
    },
  });

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const result = await getStreamViewersAction(active.streamId);
      if (result.ok && result.data) setViewerCount(result.data.viewerCount);
    }, VIEWER_POLL_MS);
    return () => clearInterval(timer);
  }, [active]);

  function start() {
    startTransition(async () => {
      const result = await startStreamAction({ title: title || undefined, source });
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('common.somethingWentWrong'));
        return;
      }
      markedRef.current = false;
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
    startTransition(async () => {
      const result = await endStreamAction(streamId);
      room.disconnect();
      setActive(null);
      markedRef.current = false;
      if (result.ok) {
        toast.success(result.message ?? '');
        router.refresh();
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

      {!active ? (
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

          {/* Monitor */}
          <div className="space-y-3">
            <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-black">
              <video
                ref={room.videoRef}
                autoPlay
                playsInline
                muted={active.source === 'BROWSER'}
                className="h-full w-full object-contain"
              />
              <audio ref={room.audioRef} autoPlay />

              {room.status === 'connecting' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
                  <Loader2 className="h-6 w-6 animate-spin text-white" />
                  <p className="text-sm text-white/80">{t('live.preparing')}</p>
                </div>
              )}

              {room.status === 'waiting-video' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 p-6 text-center">
                  <Monitor className="h-7 w-7 text-white/70" />
                  <p className="max-w-sm text-sm text-white/80">
                    {t('live.waitingForVideo')}
                  </p>
                </div>
              )}

              {room.status === 'error' && (
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

            <div className="flex flex-wrap items-center gap-2">
              {active.source === 'BROWSER' && (
                <>
                  <Button variant="outline" size="icon" onClick={room.toggleMic}>
                    {room.isMicEnabled ? (
                      <Mic className="h-4 w-4" />
                    ) : (
                      <MicOff className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={room.toggleCamera}
                  >
                    {room.isCameraEnabled ? (
                      <Video className="h-4 w-4" />
                    ) : (
                      <VideoOff className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </>
              )}

              <Link href={`/live/${slug}`} target="_blank">
                <Button variant="ghost" size="sm">
                  Ver como espectador
                </Button>
              </Link>

              <Button
                variant="destructive"
                className="ml-auto"
                onClick={() => stop(active.streamId)}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                {t('live.endStream')}
              </Button>
            </div>
          </div>
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
