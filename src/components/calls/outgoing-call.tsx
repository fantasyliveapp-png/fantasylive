'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Loader2, MessageCircle, PhoneOff } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { initials } from '@/lib/utils';
import { cancelRingingCallAction, getRingStateAction } from '@/server/actions/calls';

type RingState = 'ringing' | 'accepted' | 'declined' | 'missed' | 'cancelled';

/**
 * LLAMANDO...
 *
 * Lo que ve el fan mientras la llamada suena en la pantalla del creador. Aun
 * no se conecta la camara ni se cobra nada: si la coge, la pagina se recarga
 * y entra en la sala; si la rechaza o no contesta, se le ofrece escribirle o
 * reservar una cita.
 */
export function OutgoingCall({
  sessionId,
  name,
  image,
  rate,
  chatHref,
  profileHref,
  canBook,
}: {
  sessionId: string;
  name: string;
  image: string | null;
  rate: string;
  chatHref: string | null;
  profileHref: string | null;
  canBook: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<RingState>('ringing');
  const [left, setLeft] = useState(30);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (state !== 'ringing') return;
    let stop = false;
    async function poll() {
      const r = await getRingStateAction(sessionId);
      if (stop || !r.ok || !r.data) return;
      setLeft(r.data.secondsLeft);
      const next = r.data.state as RingState;
      if (next === 'accepted') router.refresh();
      if (next !== 'ringing') setState(next);
    }
    poll();
    const id = setInterval(poll, 2000);
    const tick = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      stop = true;
      clearInterval(id);
      clearInterval(tick);
    };
  }, [router, sessionId, state]);

  async function cancel() {
    setCancelling(true);
    await cancelRingingCallAction(sessionId);
    router.push(profileHref ?? '/');
  }

  const who = (
    <Avatar className="relative h-28 w-28 border-4 border-white/20">
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback className="bg-zinc-800 text-2xl text-white">{initials(name)}</AvatarFallback>
    </Avatar>
  );

  if (state === 'declined' || state === 'missed' || state === 'cancelled') {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center bg-black px-6 text-center text-white">
        {who}
        <h1 className="mt-6 text-2xl font-bold">
          {state === 'declined' ? `${name} no puede atenderte ahora` : `${name} no ha contestado`}
        </h1>
        <p className="mt-2 text-sm text-white/60">No se te ha cobrado nada.</p>
        <div className="mt-8 flex w-full max-w-xs flex-col gap-2">
          {chatHref && (
            <Link href={chatHref}>
              <Button variant="brand" className="w-full">
                <MessageCircle className="h-4 w-4" />
                Escribirle
              </Button>
            </Link>
          )}
          {canBook && profileHref && (
            <Link href={`${profileHref}#reservar`}>
              <Button variant="outline" className="w-full">
                <CalendarDays className="h-4 w-4" />
                Reservar videollamada
              </Button>
            </Link>
          )}
          {profileHref && (
            <Link href={profileHref}>
              <Button variant="ghost" className="w-full text-white/70">
                Volver a su perfil
              </Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col items-center justify-between bg-gradient-to-b from-zinc-900 to-black px-6 pb-16 pt-24 text-center text-white">
      <div className="flex flex-col items-center">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/60">Videollamada privada</p>
        <span className="relative mt-8">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
          {who}
        </span>
        <h1 className="mt-6 text-3xl font-bold">{name}</h1>
        <p className="mt-2 flex items-center gap-2 text-white/70">
          {state === 'accepted' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Conectando…
            </>
          ) : (
            'Llamando…'
          )}
        </p>
        <p className="mt-4 max-w-xs text-xs text-white/50">
          {rate}. No se cobra nada hasta que conteste. Se da por perdida en {left} s.
        </p>
      </div>

      <button type="button" onClick={cancel} disabled={cancelling} className="flex flex-col items-center gap-2 text-sm">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-600 shadow-lg active:scale-95">
          {cancelling ? <Loader2 className="h-7 w-7 animate-spin" /> : <PhoneOff className="h-7 w-7" />}
        </span>
        Colgar
      </button>
    </div>
  );
}
