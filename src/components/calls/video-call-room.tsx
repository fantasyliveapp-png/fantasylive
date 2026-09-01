'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Coins,
  Flag,
  Gift,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  MessageCircle,
  SkipForward,
  Timer,
  Video as VideoIcon,
  VideoOff,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import type { CallType } from '@prisma/client';

import { GiftPanel } from '@/components/calls/gift-panel';
import { ReportDialog } from '@/components/calls/report-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCallBilling } from '@/hooks/use-call-billing';
import { useVideoRoom } from '@/hooks/use-video-room';
import {
  endCallAction,
  getCallTokenAction,
  skipAndRequeueAction,
} from '@/server/actions/calls';
import { formatDuration, formatTokens, initials } from '@/lib/utils';

export interface CallPartner {
  id: string;
  name: string | null;
  image: string | null;
  country: string | null;
  stageName?: string | null;
  slug?: string | null;
}

interface VideoCallRoomProps {
  sessionId: string;
  callType: CallType;
  ratePerMinute: number;
  isPayer: boolean;
  initialBalance: number;
  partner: CallPartner | null;
  /** Permite el boton "siguiente" (solo en modos aleatorios) */
  allowSkip: boolean;
}

export function VideoCallRoom({
  sessionId,
  callType,
  ratePerMinute,
  isPayer,
  initialBalance,
  partner,
  allowSkip,
}: VideoCallRoomProps) {
  const router = useRouter();

  const [tokenData, setTokenData] = useState<{
    token: string | null;
    url: string;
    configured: boolean;
    billingIntervalSeconds: number;
  } | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  /** Motivo por el que termino la llamada; abre el panel final. */
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [showGifts, setShowGifts] = useState(false);
  const [showReport, setShowReport] = useState(false);

  // 1. Token de acceso al media server
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getCallTokenAction(sessionId);
      if (cancelled) return;

      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo abrir la llamada');
        router.push('/');
        return;
      }
      setTokenData(result.data as any);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, sessionId]);

  // 2. Sala de video
  const room = useVideoRoom({
    token: tokenData?.token ?? null,
    url: tokenData?.url ?? '',
    demoMode: tokenData ? !tokenData.configured : false,
    autoConnect: Boolean(tokenData),
  });

  const isLive = room.status === 'connected' || room.status === 'partner-joined';

  // No se expulsa al usuario de golpe: se corta el video y se abre el panel
  // final, desde donde puede seguir la conversacion por chat o recargar saldo.
  const handleTerminate = useCallback((reason: string) => {
    setEndedReason(reason);
  }, []);

  const handleLowBalance = useCallback((mins: number) => {
    toast.warning(
      mins <= 0
        ? 'Sin saldo: la llamada terminara en breve.'
        : `Te quedan unos ${mins} minutos de saldo.`,
    );
  }, []);

  // 3. Cobro por minuto
  const billing = useCallBilling({
    sessionId,
    ratePerMinute: isPayer ? ratePerMinute : 0,
    intervalSeconds: tokenData?.billingIntervalSeconds ?? 15,
    active: isLive && Boolean(tokenData),
    initialBalance,
    onTerminate: handleTerminate,
    onLowBalance: handleLowBalance,
  });

  // Libera camara y micro en cuanto la llamada termina, sin esperar a que la
  // persona pulse nada en el panel final.
  useEffect(() => {
    if (endedReason) room.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endedReason]);

  async function hangUp() {
    setIsEnding(true);
    room.disconnect();
    await endCallAction(sessionId, 'USER_HANGUP');
    setIsEnding(false);
    setEndedReason('USER_HANGUP');
  }

  async function skipToNext() {
    setIsEnding(true);
    room.disconnect();

    const result = await skipAndRequeueAction({
      sessionId,
      mode: callType === 'VIP_RANDOM' ? 'VIP' : 'RANDOM',
    });

    if (result.ok) {
      const data = result.data as any;
      if (data?.status === 'matched') {
        router.push(`/call/${data.sessionId}`);
        router.refresh();
        return;
      }
      router.push(callType === 'VIP_RANDOM' ? '/vip' : '/random');
    } else {
      toast.error(result.error ?? 'No se pudo continuar');
      router.push('/');
    }
  }

  const partnerName =
    partner?.stageName ?? partner?.name ?? 'Conectando...';

  return (
    <div className="relative flex h-[100dvh] flex-col bg-black">
      {/* VIDEO REMOTO */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={room.remoteVideoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />
        <audio ref={room.remoteAudioRef} autoPlay />

        {/* Estados de conexion */}
        {room.status !== 'partner-joined' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-zinc-900 to-black">
            {room.status === 'error' ? (
              <>
                <AlertTriangle className="h-10 w-10 text-destructive" />
                <p className="max-w-sm px-6 text-center text-sm text-white/80">
                  {room.error}
                </p>
                <Button variant="outline" onClick={() => room.connect()}>
                  Reintentar
                </Button>
              </>
            ) : (
              <>
                <div className="relative">
                  <Avatar className="h-24 w-24 border-2 border-white/20">
                    {partner?.image && (
                      <AvatarImage src={partner.image} alt={partnerName} />
                    )}
                    <AvatarFallback className="bg-zinc-800 text-xl text-white">
                      {initials(partnerName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="absolute -inset-2 rounded-full border-2 border-primary/40 animate-pulse-ring" />
                </div>

                <p className="text-lg font-medium text-white">{partnerName}</p>

                <p className="flex items-center gap-2 text-sm text-white/60">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {room.status === 'requesting-media'
                    ? 'Pidiendo acceso a camara y microfono...'
                    : room.status === 'connecting'
                      ? 'Conectando...'
                      : room.status === 'partner-left'
                        ? 'La otra persona ha salido'
                        : 'Esperando a que se una...'}
                </p>

                {tokenData && !tokenData.configured && (
                  <Badge variant="warning" className="mt-2">
                    Modo demo: LiveKit no configurado
                  </Badge>
                )}
              </>
            )}
          </div>
        )}

        {/* HUD SUPERIOR */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent p-4">
          <div className="flex items-center gap-2">
            <Badge variant="live" className="gap-1.5">
              <span className="live-dot !h-2 !w-2 bg-white" />
              {formatDuration(billing.elapsedSeconds)}
            </Badge>

            {/* Prueba gratuita: cuenta atras visible desde el primer segundo,
                para que nadie se lleve la sorpresa del corte. */}
            {billing.freeSecondsRemaining !== null && (
              <Badge
                variant={billing.freeSecondsRemaining <= 60 ? 'destructive' : 'muted'}
                className="gap-1 bg-black/50 backdrop-blur"
              >
                <Timer className="h-3.5 w-3.5" />
                Gratis: {formatDuration(billing.freeSecondsRemaining)}
              </Badge>
            )}

            {partner && (
              <Badge variant="muted" className="bg-black/50 backdrop-blur">
                {partnerName}
                {partner.country ? ` · ${partner.country}` : ''}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isPayer && ratePerMinute > 0 && (
              <>
                <Badge variant="token" className="gap-1">
                  <Coins className="h-3.5 w-3.5" />
                  {formatTokens(billing.balance)}
                </Badge>
                <Badge
                  variant={billing.remainingMinutes <= 3 ? 'destructive' : 'muted'}
                  className="bg-black/50 backdrop-blur"
                >
                  -{ratePerMinute}/min · ~{billing.remainingMinutes} min
                </Badge>
              </>
            )}
            <Badge
              variant={room.quality === 'poor' ? 'destructive' : 'muted'}
              className="hidden bg-black/50 backdrop-blur sm:flex"
            >
              {room.quality === 'poor' ? (
                <WifiOff className="h-3 w-3" />
              ) : (
                <Wifi className="h-3 w-3" />
              )}
              {!isLive
                ? 'Conectando'
                : room.quality === 'excellent'
                  ? 'Excelente'
                  : room.quality === 'good'
                    ? 'Buena'
                    : room.quality === 'poor'
                      ? 'Inestable'
                      : 'Conectada'}
            </Badge>
          </div>
        </div>

        {/* VIDEO LOCAL (PiP) */}
        <div className="absolute bottom-28 right-4 h-40 w-28 overflow-hidden rounded-xl border-2 border-white/20 bg-zinc-900 shadow-2xl sm:h-48 sm:w-36">
          <video
            ref={room.localVideoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full scale-x-[-1] object-cover"
          />
          {!room.isCameraEnabled && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
              <VideoOff className="h-6 w-6 text-white/40" />
            </div>
          )}
        </div>

        {/* Panel de regalos */}
        {showGifts && partner && (
          <div className="absolute bottom-28 left-4 z-10">
            <GiftPanel
              receiverId={partner.id}
              sessionId={sessionId}
              balance={billing.balance}
              onClose={() => setShowGifts(false)}
              onSent={() => void billing.sendTick()}
            />
          </div>
        )}
      </div>

      {/* CONTROLES */}
      <div className="flex items-center justify-center gap-3 bg-black px-4 py-5">
        <Button
          variant={room.isMicEnabled ? 'secondary' : 'destructive'}
          size="icon-lg"
          onClick={room.toggleMic}
          title={room.isMicEnabled ? 'Silenciar' : 'Activar micro'}
        >
          {room.isMicEnabled ? (
            <Mic className="h-5 w-5" />
          ) : (
            <MicOff className="h-5 w-5" />
          )}
        </Button>

        <Button
          variant={room.isCameraEnabled ? 'secondary' : 'destructive'}
          size="icon-lg"
          onClick={room.toggleCamera}
          title={room.isCameraEnabled ? 'Apagar camara' : 'Encender camara'}
        >
          {room.isCameraEnabled ? (
            <VideoIcon className="h-5 w-5" />
          ) : (
            <VideoOff className="h-5 w-5" />
          )}
        </Button>

        <Button
          variant="destructive"
          size="icon-lg"
          onClick={hangUp}
          disabled={isEnding}
          title="Colgar"
        >
          {isEnding ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <PhoneOff className="h-5 w-5" />
          )}
        </Button>

        {partner && (
          <Button
            variant="token"
            size="icon-lg"
            onClick={() => setShowGifts((v) => !v)}
            title="Enviar regalo"
          >
            <Gift className="h-5 w-5" />
          </Button>
        )}

        {allowSkip && (
          <Button
            variant="brand"
            size="icon-lg"
            onClick={skipToNext}
            disabled={isEnding}
            title="Siguiente persona"
          >
            <SkipForward className="h-5 w-5" />
          </Button>
        )}

        {partner && (
          <Button
            variant="ghost"
            size="icon-lg"
            className="text-white/50 hover:text-white"
            onClick={() => setShowReport(true)}
            title="Reportar"
          >
            <Flag className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* PANEL FINAL: la llamada ha terminado */}
      {endedReason && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/90 p-6 backdrop-blur">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              {endedReason === 'FREE_LIMIT_REACHED' ? (
                <Timer className="h-7 w-7 text-primary" />
              ) : endedReason === 'INSUFFICIENT_TOKENS' ? (
                <Coins className="h-7 w-7 text-token" />
              ) : (
                <PhoneOff className="h-7 w-7 text-white/70" />
              )}
            </div>

            <h2 className="text-xl font-bold text-white">
              {endedReason === 'FREE_LIMIT_REACHED'
                ? 'Se acabo la prueba gratis'
                : endedReason === 'INSUFFICIENT_TOKENS'
                  ? 'Te has quedado sin tokens'
                  : 'Llamada finalizada'}
            </h2>

            <p className="mt-2 text-sm text-white/60">
              {endedReason === 'FREE_LIMIT_REACHED'
                ? `Has hablado ${formatDuration(billing.elapsedSeconds)}. Podeis seguir la conversacion por chat.`
                : endedReason === 'INSUFFICIENT_TOKENS'
                  ? 'Recarga para volver a llamar, o seguid hablando por chat.'
                  : `Duracion: ${formatDuration(billing.elapsedSeconds)}${
                      billing.tokensSpent > 0
                        ? ` · ${formatTokens(billing.tokensSpent)} tokens`
                        : ''
                    }`}
            </p>

            <div className="mt-6 flex flex-col gap-2">
              {/* Seguir por chat: solo tiene sentido con creadoras, que son
                  quienes tienen conversacion en la plataforma. */}
              {partner?.slug && (
                <Link href={`/dashboard/messages/${partner.slug}`}>
                  <Button variant="brand" className="w-full">
                    <MessageCircle className="h-4 w-4" />
                    Seguir hablando por chat
                  </Button>
                </Link>
              )}

              {endedReason === 'INSUFFICIENT_TOKENS' && (
                <Link href="/wallet?reason=insufficient">
                  <Button variant="token" className="w-full">
                    <Coins className="h-4 w-4" />
                    Recargar tokens
                  </Button>
                </Link>
              )}

              {allowSkip && (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={isEnding}
                  onClick={skipToNext}
                >
                  <SkipForward className="h-4 w-4" />
                  Conocer a otra persona
                </Button>
              )}

              <Button
                variant="ghost"
                className="w-full text-white/60"
                onClick={() => router.push('/')}
              >
                Volver al inicio
              </Button>
            </div>
          </div>
        </div>
      )}

      {partner && (
        <ReportDialog
          open={showReport}
          onOpenChange={setShowReport}
          reportedId={partner.id}
          sessionId={sessionId}
          reportedName={partnerName}
        />
      )}
    </div>
  );
}
