'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { BellRing, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { installBannerOpen, isStandalone } from '@/components/pwa/install-app';
import { cn } from '@/lib/utils';
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from '@/server/actions/push';

/**
 * AVISOS AL MOVIL (lado del navegador)
 *
 * - Pedir permiso solo cuando la persona toca "Activar" (el navegador lo exige
 *   y asi no molesta nada mas entrar).
 * - En iPhone solo funciona con la app instalada (pantalla de inicio); si no,
 *   no se ofrece: primero sale la invitacion a instalarla.
 * - Si ya dio permiso, se asegura en silencio de que este dispositivo esta
 *   guardado para su cuenta (p. ej. tras cambiar de cuenta).
 */

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const DISMISS_KEY = 'fl_push_dismissed';
const SYNCED_KEY = 'fl_push_synced';
const SNOOZE_MS = 14 * 24 * 3600 * 1000;

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    Boolean(PUBLIC_KEY) &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function keyBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function subscribeThisDevice() {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(PUBLIC_KEY),
    }));
  const result = await savePushSubscriptionAction(sub.toJSON());
  if (!result.ok) throw new Error(result.error ?? 'No se pudo guardar.');
}

/** Pide permiso y activa los avisos en este dispositivo. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) {
    toast.error(
      isIos() && !isStandalone()
        ? 'En iPhone, primero instala la app en tu pantalla de inicio.'
        : 'Este navegador no admite avisos.',
    );
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    toast.error('Sin permiso no podemos avisarte. Puedes activarlo en los ajustes del navegador.');
    return false;
  }
  try {
    await subscribeThisDevice();
    return true;
  } catch {
    toast.error('No se pudieron activar los avisos. Intentalo de nuevo.');
    return false;
  }
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await removePushSubscriptionAction(sub.endpoint);
    await sub.unsubscribe().catch(() => undefined);
  }
}

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sin almacenamiento
  }
}

/**
 * Invitacion discreta a activar los avisos (a partir de la 2a visita, con
 * sesion iniciada) y sincronizacion silenciosa si ya dio permiso.
 */
export function PushPrompt() {
  const { status } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated' || !pushSupported()) return;

    // Ya dio permiso: que este dispositivo quede guardado (una vez por sesion).
    if (Notification.permission === 'granted') {
      try {
        if (sessionStorage.getItem(SYNCED_KEY)) return;
        sessionStorage.setItem(SYNCED_KEY, '1');
      } catch {
        // sin almacenamiento de sesion: se sincroniza igual
      }
      void subscribeThisDevice().catch(() => undefined);
      return;
    }
    if (Notification.permission !== 'default') return;

    const visits = Number(read('fl_visits') ?? 0);
    const dismissed = Number(read(DISMISS_KEY) ?? 0);
    if (visits < 2 || Date.now() - dismissed < SNOOZE_MS) return;
    // Despues de la invitacion a instalar, nunca a la vez.
    const t = setTimeout(() => {
      if (!installBannerOpen()) setOpen(true);
    }, 9000);
    return () => clearTimeout(t);
  }, [status]);

  if (!open || pathname?.startsWith('/admin')) return null;

  function dismiss() {
    write(DISMISS_KEY, String(Date.now()));
    setOpen(false);
  }

  async function activate() {
    setBusy(true);
    const ok = await enablePush();
    setBusy(false);
    if (ok) {
      toast.success('Listo: te avisaremos en este dispositivo.');
      setOpen(false);
    } else {
      dismiss();
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Activar avisos"
      className="fixed inset-x-3 bottom-20 z-[60] mx-auto max-w-md rounded-2xl border border-border/60 bg-card/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 md:bottom-6"
    >
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2.5 top-2.5 rounded-full p-1 text-muted-foreground hover:bg-muted"
        aria-label="Ahora no"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15">
          <BellRing className="h-5 w-5 text-primary" />
        </span>
        <div className="space-y-1">
          <p className="font-semibold">¿Te avisamos?</p>
          <p className="text-sm text-muted-foreground">
            Cuando te escriban, empiece un directo de quien sigues o haya algo nuevo para ti.
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Ahora no
        </Button>
        <Button size="sm" variant="brand" onClick={activate} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Activar avisos
        </Button>
      </div>
    </div>
  );
}

/** Interruptor "Avisos en este dispositivo" (panel de notificaciones). */
export function PushToggle({ className }: { className?: string }) {
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'blocked' | 'unsupported'>(
    'loading',
  );
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!pushSupported()) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === 'loading') return null;

  const hint =
    state === 'on'
      ? 'Activados en este dispositivo'
      : state === 'blocked'
        ? 'Bloqueados en los ajustes del navegador'
        : state === 'unsupported'
          ? isIos() && !isStandalone()
            ? 'En iPhone, instala la app para activarlos'
            : 'Este navegador no admite avisos'
          : 'Recibe avisos aunque tengas la app cerrada';

  return (
    <div className={cn('flex items-center gap-2.5 px-3 py-2.5', className)}>
      <BellRing className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">Avisos al movil</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
      {state === 'on' ? (
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            disabled={busy}
            onClick={async () => {
              const r = await sendTestPushAction();
              if (!r.ok) toast.error(r.error ?? 'No se pudo enviar.');
            }}
          >
            Probar
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await disablePush();
              setBusy(false);
              await refresh();
            }}
          >
            Desactivar
          </button>
        </div>
      ) : state === 'off' ? (
        <Button
          size="sm"
          variant="brand"
          className="h-7 px-2.5 text-xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await enablePush();
            setBusy(false);
            await refresh();
          }}
        >
          Activar
        </Button>
      ) : null}
    </div>
  );
}
