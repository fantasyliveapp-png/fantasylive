'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import Link from 'next/link';
import { CameraOff, Loader2, Monitor, Phone, Radio, Video, X } from 'lucide-react';

import { glass } from '@/components/live/live-chat';
import { LiveStage, StageNotice } from '@/components/live/live-stage';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Source = 'BROWSER' | 'OBS_RTMP';

/**
 * EMPEZAR UN DIRECTO, como en las apps de movil: te ves en la camara a
 * pantalla completa y encima solo lo imprescindible (titulo, si aceptas
 * privados 1 a 1 y el boton de empezar). La meta de tokens y lo demas se pone
 * ya dentro del directo, desde sus botones.
 *
 * OBS solo se ofrece en ordenador (desde el movil no se puede usar) y como
 * opcion secundaria.
 */
export function GoLiveSetup({
  title,
  onTitle,
  source,
  onSource,
  obsConfigured,
  acceptsPrivate,
  onAcceptsPrivate,
  privateRate,
  privateMinMinutes,
  onStart,
  pending,
  previewRef,
}: {
  title: string;
  onTitle: (v: string) => void;
  source: Source;
  onSource: (s: Source) => void;
  obsConfigured: boolean;
  acceptsPrivate: boolean | null;
  onAcceptsPrivate: (v: boolean) => void;
  privateRate: string;
  privateMinMinutes: number;
  onStart: () => void;
  pending: boolean;
  /** La vista previa de la camara, para soltarla justo antes de emitir. */
  previewRef: MutableRefObject<MediaStream | null>;
}) {
  const mobile = useIsMobile();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [camError, setCamError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Desde el movil no hay OBS.
  useEffect(() => {
    if (mobile && source === 'OBS_RTMP') onSource('BROWSER');
  }, [mobile, source, onSource]);

  // Vista previa de la camara (solo video: el micro lo pide ya el directo).
  useEffect(() => {
    if (source !== 'BROWSER') return;
    let cancelled = false;
    setCamError(false);
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        previewRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => !cancelled && setCamError(true));
    return () => {
      cancelled = true;
      previewRef.current?.getTracks().forEach((t) => t.stop());
      previewRef.current = null;
    };
  }, [source, attempt, previewRef]);

  const canObs = obsConfigured && !mobile;

  return (
    <LiveStage videoRef={videoRef} audioRef={audioRef} muted mirror={source === 'BROWSER'} immersive>
      {source === 'BROWSER' && camError && (
        <StageNotice>
          <CameraOff className="h-8 w-8 text-white/70" />
          <p className="max-w-xs text-sm text-white">
            Permite la cámara para verte antes de empezar.
          </p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            Reintentar
          </Button>
        </StageNotice>
      )}

      {source === 'OBS_RTMP' && (
        <StageNotice>
          <Monitor className="h-8 w-8 text-white/70" />
          <p className="max-w-xs text-sm text-white">
            Al empezar te damos el servidor y la clave para pegarlos en OBS. Tu directo sale
            cuando pulses &laquo;Iniciar transmisión&raquo; en OBS.
          </p>
        </StageNotice>
      )}

      {/* Arriba: salir y titulo */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/dashboard/model"
          aria-label="Salir"
          className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white', glass)}
        >
          <X className="h-5 w-5" />
        </Link>
        <input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          maxLength={120}
          placeholder="Añade un título a tu directo…"
          aria-label="Título del directo"
          className={cn(
            'h-10 min-w-0 flex-1 rounded-full px-4 text-sm text-white placeholder:text-white/60 outline-none',
            glass,
          )}
        />
      </div>

      {/* Abajo: privados 1 a 1 y empezar */}
      <div className="absolute inset-x-0 bottom-0 z-20 space-y-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className={cn('rounded-2xl p-3 text-white', glass)}>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Phone className="h-4 w-4" />
            ¿Recibir privados 1 a 1?
          </p>
          <p className="mt-0.5 text-xs text-white/70">
            Los espectadores podrán llamarte a {privateRate} (mínimo {privateMinMinutes} min). Si
            aceptas una, el directo termina.
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {[
              { value: true, label: 'Sí' },
              { value: false, label: 'No' },
            ].map((o) => (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => onAcceptsPrivate(o.value)}
                aria-pressed={acceptsPrivate === o.value}
                className={cn(
                  'h-9 rounded-full text-sm font-semibold transition-colors',
                  acceptsPrivate === o.value
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white hover:bg-white/20',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onStart}
          disabled={pending || acceptsPrivate === null || (source === 'BROWSER' && camError)}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary via-fantazy-red to-champagne-gold text-base font-bold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Radio className="h-5 w-5" />}
          Empezar directo
        </button>

        <p className="text-center text-[11px] text-white/60">
          {acceptsPrivate === null
            ? 'Elige si recibes privados para empezar.'
            : 'La meta de tokens y lo demás lo pones dentro del directo.'}
        </p>

        {/* OBS: solo en ordenador, como opcion secundaria */}
        {canObs && (
          <button
            type="button"
            onClick={() => onSource(source === 'OBS_RTMP' ? 'BROWSER' : 'OBS_RTMP')}
            className="mx-auto flex items-center gap-1.5 text-xs font-medium text-white/70 hover:text-white"
          >
            {source === 'OBS_RTMP' ? (
              <>
                <Video className="h-3.5 w-3.5" /> Usar la cámara del ordenador
              </>
            ) : (
              <>
                <Monitor className="h-3.5 w-3.5" /> ¿Usas OBS? Emitir con OBS
              </>
            )}
          </button>
        )}
      </div>
    </LiveStage>
  );
}

/** Movil o tablet (pantalla tactil y estrecha, o navegador de movil). */
function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () =>
      setMobile(
        /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) ||
          (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024),
      );
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}
