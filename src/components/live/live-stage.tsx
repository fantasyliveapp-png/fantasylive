'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { cn } from '@/lib/utils';

const SWIPE_MIN_PX = 70;
const WHEEL_MIN_DELTA = 40;
const LEAVE_MS = 220;

/**
 * Escenario de un directo en formato vertical, como TikTok.
 *
 * En el movil ocupa la pantalla entera por encima de la navegacion de la web
 * (immersive). En escritorio es una "pantalla de movil" 9:16 centrada. Todo lo
 * demas (chat, botones, regalos) se pinta encima como hijos.
 *
 * Con onNext/onPrev se puede pasar de directo deslizando hacia arriba o
 * abajo, con la rueda del raton o con las flechas del teclado.
 *
 * El video se recorta para llenar el marco cuando viene en vertical; si viene
 * apaisado (webcam de portatil, OBS) se muestra entero con bandas, porque
 * recortarlo dejaria a la creadora fuera de plano.
 */
export function LiveStage({
  videoRef,
  audioRef,
  muted,
  mirror,
  immersive,
  onDoubleTap,
  onNext,
  onPrev,
  nextLabel,
  prevLabel,
  children,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  audioRef: RefObject<HTMLAudioElement | null>;
  muted?: boolean;
  /** Espejo para la vista previa de la propia camara frontal. */
  mirror?: boolean;
  /** Pantalla completa en el movil. */
  immersive: boolean;
  onDoubleTap?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  nextLabel?: string;
  prevLabel?: string;
  children: ReactNode;
}) {
  const [landscape, setLandscape] = useState(false);
  const [leaving, setLeaving] = useState<'up' | 'down' | null>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const wheelLockRef = useRef(0);

  function measure(video: HTMLVideoElement) {
    if (video.videoWidth && video.videoHeight) {
      setLandscape(video.videoWidth > video.videoHeight);
    }
  }

  // Primero se va la pantalla actual y luego se navega: asi se siente como
  // un deslizamiento y no como un cambio de pagina.
  const go = useCallback(
    (direction: 'up' | 'down') => {
      const action = direction === 'up' ? onNext : onPrev;
      if (!action || leaving) return;
      setLeaving(direction);
      setTimeout(action, LEAVE_MS);
    },
    [leaving, onNext, onPrev],
  );

  useEffect(() => {
    if (!onNext && !onPrev) return;
    function onKey(e: KeyboardEvent) {
      // Mientras se escribe en el chat las flechas mueven el cursor.
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, [contenteditable="true"]')
      ) {
        return;
      }
      if (e.key === 'ArrowDown') go('up');
      if (e.key === 'ArrowUp') go('down');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onNext, onPrev]);

  return (
    <div
      className={cn(
        immersive &&
          'fixed inset-0 z-[70] bg-black lg:static lg:z-auto lg:bg-transparent',
        'lg:relative lg:flex lg:justify-center',
      )}
    >
      <div
        className={cn(
          'relative w-full overflow-hidden bg-black transition-[transform,opacity] ease-in',
          immersive ? 'h-[100dvh]' : 'h-[78dvh] rounded-3xl',
          'lg:aspect-[9/16] lg:h-[calc(100dvh-8rem)] lg:max-h-[860px] lg:min-h-[560px] lg:w-auto lg:rounded-[28px] lg:shadow-2xl lg:ring-1 lg:ring-white/10',
          !leaving && 'animate-in fade-in slide-in-from-bottom-6 duration-300',
          // duration-200 = LEAVE_MS (Tailwind necesita la clase literal).
          leaving === 'up' && '-translate-y-full opacity-0 duration-200',
          leaving === 'down' && 'translate-y-full opacity-0 duration-200',
        )}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          controls={false}
          onLoadedMetadata={(e) => measure(e.currentTarget)}
          onResize={(e) => measure(e.currentTarget)}
          className={cn(
            'absolute inset-0 h-full w-full',
            landscape ? 'object-contain' : 'object-cover',
            mirror && '-scale-x-100',
          )}
        />
        <audio ref={audioRef} autoPlay />

        {/* Capa de gestos: doble toque = me gusta, deslizar = otro directo.
            Va debajo de los botones para no robarles los toques. */}
        <div
          className="absolute inset-0 touch-manipulation"
          onDoubleClick={onDoubleTap}
          onTouchStart={(e) => {
            const touch = e.touches[0];
            if (touch) touchRef.current = { x: touch.clientX, y: touch.clientY };
          }}
          onTouchEnd={(e) => {
            const start = touchRef.current;
            const touch = e.changedTouches[0];
            touchRef.current = null;
            if (!start || !touch) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dy) < SWIPE_MIN_PX || Math.abs(dx) > Math.abs(dy)) return;
            go(dy < 0 ? 'up' : 'down');
          }}
          onWheel={(e) => {
            if (Math.abs(e.deltaY) < WHEEL_MIN_DELTA) return;
            const now = Date.now();
            if (now - wheelLockRef.current < 800) return;
            wheelLockRef.current = now;
            go(e.deltaY > 0 ? 'up' : 'down');
          }}
        />

        {/* Degradados para que el texto se lea sobre cualquier imagen. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/60 via-black/20 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

        {children}
      </div>

      {/* Flechas de escritorio, a la derecha del escenario como en TikTok web. */}
      {(onNext || onPrev) && (
        <div className="absolute right-6 top-1/2 hidden -translate-y-1/2 flex-col gap-3 lg:flex">
          <button
            type="button"
            onClick={() => go('down')}
            disabled={!onPrev}
            aria-label={prevLabel}
            title={prevLabel}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30"
          >
            <ChevronUp className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={() => go('up')}
            disabled={!onNext}
            aria-label={nextLabel}
            title={nextLabel}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30"
          >
            <ChevronDown className="h-6 w-6" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Mensaje centrado sobre el escenario (conectando, error, terminado...). */
export function StageNotice({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 p-6 text-center">
      {children}
    </div>
  );
}
