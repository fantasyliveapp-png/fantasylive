'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2, Phone, PhoneOff, Video } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn, initials } from '@/lib/utils';
import { acceptCallAction, declineCallAction } from '@/server/actions/calls';
import { setOnlineStatusAction } from '@/server/actions/model';

/**
 * "RECIBO LLAMADAS"
 *
 * Un solo interruptor para el creador, siempre a mano: arriba en el movil, en
 * la barra lateral en escritorio y en su panel. Todos comparten el mismo
 * estado (este contexto), asi que cambiar uno cambia todos.
 *
 * Mientras esta activado, la web pregunta cada pocos segundos si le estan
 * llamando y, si es asi, muestra la llamada entrante a pantalla completa con
 * sonido: Aceptar / Rechazar.
 */

interface Incoming {
  /** Esta en directo: aceptar termina el directo. */
  live?: boolean;
  sessionId: string;
  name: string;
  image: string | null;
  rate: string;
  secondsLeft: number;
}

interface Ctx {
  available: boolean;
  pending: boolean;
  canStream: boolean;
  toggle: () => void;
}

const AvailabilityContext = createContext<Ctx | null>(null);

const POLL_MS = 4000;

export function CallAvailabilityProvider({
  initialAvailable,
  canStream,
  children,
}: {
  initialAvailable: boolean;
  canStream: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [available, setAvailable] = useState(initialAvailable);
  const [pending, startTransition] = useTransition();
  // Justo al activarlo, el servidor aun puede contestar "apagado": se ignora.
  const toggledAt = useRef(0);

  // Tras un refresh, el servidor manda el estado real.
  useEffect(() => setAvailable(initialAvailable), [initialAvailable]);

  const toggle = useCallback(() => {
    if (!canStream) {
      toast.error('Verifica tu identidad para poder recibir llamadas.');
      return;
    }
    const next = !available;
    toggledAt.current = Date.now();
    setAvailable(next);
    unlockRingtone();
    startTransition(async () => {
      const r = await setOnlineStatusAction({ isOnline: next });
      if (r.ok) {
        toast.success(r.message ?? (next ? 'Recibes llamadas.' : 'Ya no recibes llamadas.'));
        router.refresh();
      } else {
        setAvailable(!next);
        toast.error(r.error ?? 'No se pudo cambiar.');
      }
    });
  }, [available, canStream, router]);

  return (
    <AvailabilityContext.Provider value={{ available, pending, canStream, toggle }}>
      {children}
      {canStream && (
        <IncomingCallWatcher
          available={available}
          onServerOff={() => {
            if (Date.now() - toggledAt.current < 15_000) return;
            setAvailable(false);
            toast('Ya no recibes llamadas: la web estuvo cerrada un rato. Vuelve a activarlo cuando quieras.');
          }}
        />
      )}
    </AvailabilityContext.Provider>
  );
}

export function useCallAvailability() {
  return useContext(AvailabilityContext);
}

// ---------------------------------------------------------------------------
// El interruptor
// ---------------------------------------------------------------------------

/**
 * - header: pastilla pequena para la barra de arriba del movil.
 * - sidebar: fila de la barra lateral de escritorio (en tablet solo el icono).
 * - hero: boton grande del panel, con una linea que explica que hace.
 */
export function AvailabilitySwitch({ variant }: { variant: 'header' | 'sidebar' | 'hero' }) {
  const ctx = useCallAvailability();
  if (!ctx) return null;
  const { available: on, pending, toggle, canStream } = ctx;

  const knob = (
    <span
      className={cn(
        'relative inline-block shrink-0 rounded-full transition-colors',
        variant === 'header' ? 'h-4 w-7' : 'h-6 w-11',
        on ? 'bg-state-connected' : 'bg-muted-foreground/40',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 flex items-center justify-center rounded-full bg-white shadow transition-all',
          variant === 'header' ? 'h-3 w-3' : 'h-5 w-5',
          on ? (variant === 'header' ? 'left-[14px]' : 'left-[22px]') : 'left-0.5',
        )}
      >
        {pending && variant !== 'header' && <Loader2 className="h-3 w-3 animate-spin text-black" />}
      </span>
    </span>
  );

  if (variant === 'header') {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={on}
        aria-label={on ? 'Recibo llamadas: activado' : 'Recibo llamadas: desactivado'}
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold transition-colors',
          on
            ? 'border-state-connected/50 bg-state-connected/15 text-foreground'
            : 'border-border text-muted-foreground',
        )}
      >
        {knob}
        <span>{on ? 'Disponible' : 'No disponible'}</span>
      </button>
    );
  }

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={on}
        title={on ? 'Recibes llamadas. Toca para dejar de recibirlas.' : 'Toca para recibir llamadas'}
        className={cn(
          'flex w-full items-center justify-center gap-3 rounded-xl border px-2 py-2.5 text-left transition-colors lg:justify-start lg:px-3',
          on
            ? 'border-state-connected/50 bg-state-connected/10'
            : 'border-border/60 hover:bg-muted/60',
        )}
      >
        {/* Tablet: solo el icono con su punto de estado. */}
        <span className="relative lg:hidden">
          <Video className={cn('h-6 w-6', on ? 'text-state-connected' : 'text-muted-foreground')} />
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background',
              on ? 'bg-state-connected' : 'bg-muted-foreground',
            )}
          />
        </span>
        <span className="hidden min-w-0 flex-1 lg:block">
          <span className="block text-sm font-semibold">{on ? 'Recibo llamadas' : 'No recibo llamadas'}</span>
          <span className="block text-[11px] text-muted-foreground">
            {on ? 'Los fans pueden llamarte' : 'Toca para estar disponible'}
          </span>
        </span>
        <span className="hidden lg:block">{knob}</span>
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending || !canStream}
        aria-pressed={on}
        className={cn(
          'flex items-center gap-2.5 rounded-full border py-2 pl-2 pr-4 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60',
          on
            ? 'border-state-connected/50 bg-state-connected/15 text-foreground'
            : 'border-border bg-muted/60 text-muted-foreground hover:text-foreground',
        )}
      >
        {knob}
        {on ? 'Recibo llamadas' : 'No recibo llamadas'}
      </button>
      <p className="text-xs text-muted-foreground">
        {!canStream
          ? 'Verifica tu identidad para poder recibir llamadas.'
          : on
            ? 'Te sonará aquí mientras tengas la web abierta.'
            : 'Actívalo cuando quieras que los fans puedan llamarte.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Llamada entrante
// ---------------------------------------------------------------------------

function IncomingCallWatcher({
  available,
  onServerOff,
}: {
  available: boolean;
  onServerOff: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [call, setCall] = useState<Incoming | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const handled = useRef<Set<string>>(new Set());
  const offRef = useRef(onServerOff);
  offRef.current = onServerOff;

  const inCall = pathname.startsWith('/call/');

  // Pregunta siempre (no solo con "Recibo llamadas"): en un directo con
  // privados tambien pueden llamarle.
  useEffect(() => {
    if (inCall) {
      setCall(null);
      return;
    }
    let stop = false;
    async function poll() {
      try {
        const res = await fetch('/api/calls/incoming', { cache: 'no-store' });
        if (!res.ok || stop) return;
        const data = (await res.json()) as { available: boolean; live: boolean; call: Incoming | null };
        if (stop) return;
        if (available && !data.available) offRef.current();
        const c =
          data.call && !handled.current.has(data.call.sessionId) ? { ...data.call, live: data.live } : null;
        setCall(c);
        if (c) setLeft(c.secondsLeft);
      } catch {
        // sin red: se reintenta en el siguiente ciclo
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [available, inCall]);

  // Cuenta atras, tono, vibracion y titulo de la pestana mientras suena.
  useEffect(() => {
    if (!call) return;
    const stopRing = startRingtone();
    const title = document.title;
    let flip = false;
    const tick = setInterval(() => {
      setLeft((s) => Math.max(0, s - 1));
      flip = !flip;
      document.title = flip ? `📞 ${call.name} te llama` : title;
    }, 1000);
    return () => {
      stopRing();
      clearInterval(tick);
      document.title = title;
    };
  }, [call]);

  useEffect(() => {
    if (call && left <= 0) setCall(null);
  }, [call, left]);

  if (!call) return null;

  async function accept() {
    if (!call) return;
    setBusy('accept');
    handled.current.add(call.sessionId);
    const r = await acceptCallAction(call.sessionId);
    setBusy(null);
    setCall(null);
    if (r.ok) router.push(`/call/${call.sessionId}`);
    else toast.error(r.error ?? 'La llamada ya no esta sonando.');
  }

  async function decline() {
    if (!call) return;
    setBusy('decline');
    handled.current.add(call.sessionId);
    await declineCallAction(call.sessionId);
    setBusy(null);
    setCall(null);
  }

  return (
    <div
      role="alertdialog"
      aria-label={`Videollamada entrante de ${call.name}`}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-black/90 px-6 pb-16 pt-24 text-white backdrop-blur-md"
    >
      <div className="flex flex-col items-center text-center">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/60">Videollamada privada</p>
        <span className="relative mt-8">
          <span className="absolute inset-0 animate-ping rounded-full bg-state-connected/40" />
          <Avatar className="relative h-28 w-28 border-4 border-state-connected">
            {call.image && <AvatarImage src={call.image} alt="" />}
            <AvatarFallback className="text-2xl">{initials(call.name)}</AvatarFallback>
          </Avatar>
        </span>
        <h2 className="mt-6 text-3xl font-bold">{call.name}</h2>
        <p className="mt-2 text-white/70">te está llamando · {call.rate}</p>
        <p className="mt-1 text-xs text-white/50">Se da por perdida en {left} s</p>
        {call.live && (
          <p className="mt-4 max-w-xs rounded-xl bg-white/10 px-3 py-2 text-sm text-white/80">
            Estás en directo: si aceptas, el directo termina y pasas al privado.
          </p>
        )}
      </div>

      <div className="flex w-full max-w-xs items-start justify-between">
        <button
          type="button"
          onClick={decline}
          disabled={busy !== null}
          className="flex flex-col items-center gap-2 text-sm"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-600 shadow-lg transition-transform active:scale-95">
            {busy === 'decline' ? <Loader2 className="h-7 w-7 animate-spin" /> : <PhoneOff className="h-7 w-7" />}
          </span>
          Rechazar
        </button>
        <button
          type="button"
          onClick={accept}
          disabled={busy !== null}
          className="flex flex-col items-center gap-2 text-sm"
        >
          <span className="flex h-16 w-16 animate-bounce items-center justify-center rounded-full bg-state-connected shadow-lg transition-transform active:scale-95">
            {busy === 'accept' ? <Loader2 className="h-7 w-7 animate-spin" /> : <Phone className="h-7 w-7" />}
          </span>
          Aceptar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tono de llamada (sin archivos: dos pitidos cada 2 s con WebAudio)
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;

/** Los navegadores solo dejan sonar audio tras un toque: se prepara al activar. */
function unlockRingtone() {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
  } catch {
    // sin audio: queda la pantalla y la vibracion
  }
}

function startRingtone(): () => void {
  unlockRingtone();
  const ring = () => {
    try {
      navigator.vibrate?.([400, 200, 400]);
      if (!audioCtx) return;
      const t = audioCtx.currentTime;
      for (const start of [0, 0.5]) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, t + start);
        gain.gain.exponentialRampToValueAtTime(0.25, t + start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + start + 0.35);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t + start);
        osc.stop(t + start + 0.4);
      }
    } catch {
      // ignorar
    }
  };
  ring();
  const id = setInterval(ring, 2000);
  return () => {
    clearInterval(id);
    try {
      navigator.vibrate?.(0);
    } catch {
      // ignorar
    }
  };
}
