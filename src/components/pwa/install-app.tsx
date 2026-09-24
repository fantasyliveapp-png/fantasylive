'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Share, SquarePlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * APP INSTALABLE
 *
 * - Registra el service worker (lo que hace la web instalable).
 * - Tras unas visitas, invita a instalarla: en Android/ordenador con el boton
 *   del sistema; en iPhone explicando "Compartir > Anadir a pantalla de
 *   inicio" (Apple no deja un boton automatico). Dentro de Instagram y otras
 *   apps no se puede instalar: se pide abrirla en el navegador.
 * - Si la cierra, no vuelve a salir en 14 dias. "Instalar app" del menu la
 *   abre cuando quiera (evento fl:install-open).
 */

const VISITS_KEY = 'fl_visits';
const DISMISS_KEY = 'fl_install_dismissed';
const SESSION_KEY = 'fl_visit_counted';
const MIN_VISITS = 3;
const SNOOZE_MS = 14 * 24 * 3600 * 1000;
export const INSTALL_OPEN_EVENT = 'fl:install-open';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Mode = 'prompt' | 'ios' | 'inapp' | 'other' | null;

function read(key: string, storage: Storage = localStorage) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string, storage: Storage = localStorage) {
  try {
    storage.setItem(key, value);
  } catch {
    // Sin almacenamiento: simplemente se volvera a ofrecer.
  }
}

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function platform(): Mode {
  const ua = navigator.userAgent;
  const inApp = /Instagram|FBAN|FBAV|TikTok|Twitter|Line\/|Snapchat/i.test(ua);
  if (inApp) return 'inapp';
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  if (ios) return 'ios';
  return null;
}

export function InstallApp() {
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [open, setOpen] = useState(false);

  // Service worker: sin el, el movil no ofrece instalarla.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  const decide = useCallback(
    (force: boolean) => {
      if (isStandalone()) return;
      const m: Mode = deferred ? 'prompt' : platform();
      if (!m) {
        // Navegador que no avisa (o ya instalada): nada que ensenar.
        return;
      }
      if (!force) {
        const visits = Number(read(VISITS_KEY) ?? 0);
        const dismissed = Number(read(DISMISS_KEY) ?? 0);
        if (visits < MIN_VISITS || Date.now() - dismissed < SNOOZE_MS) return;
      }
      setMode(m);
      setOpen(true);
    },
    [deferred],
  );

  // Cuenta una visita por sesion.
  useEffect(() => {
    if (read(SESSION_KEY, sessionStorage)) return;
    write(SESSION_KEY, '1', sessionStorage);
    write(VISITS_KEY, String(Number(read(VISITS_KEY) ?? 0) + 1));
  }, []);

  // Android / ordenador: el navegador avisa de que se puede instalar.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setOpen(false);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Tras unos segundos en la pagina, si toca, se ofrece.
  useEffect(() => {
    const t = setTimeout(() => decide(false), 4000);
    return () => clearTimeout(t);
  }, [decide]);

  // "Instalar app" desde el menu.
  useEffect(() => {
    const onOpen = () => {
      if (isStandalone()) return;
      setMode(deferred ? 'prompt' : (platform() ?? 'other'));
      setOpen(true);
    };
    window.addEventListener(INSTALL_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(INSTALL_OPEN_EVENT, onOpen);
  }, [deferred]);

  if (!open || !mode || pathname?.startsWith('/admin')) return null;

  function dismiss() {
    write(DISMISS_KEY, String(Date.now()));
    setOpen(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    setDeferred(null);
    if (choice?.outcome === 'accepted') setOpen(false);
    else dismiss();
  }

  return (
    <div
      role="dialog"
      aria-label="Instalar la app"
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
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={48}
          height={48}
          className="shrink-0 rounded-xl"
        />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">Instala FantasyLive</p>
          {mode === 'prompt' && (
            <p className="text-sm text-muted-foreground">
              Tenla en tu pantalla de inicio, a pantalla completa y con avisos.
            </p>
          )}
          {mode === 'ios' && (
            <ol className="space-y-1.5 text-sm text-muted-foreground">
              <li className="flex items-center gap-1.5">
                1. Toca <Share className="h-4 w-4 text-foreground" />{' '}
                <strong className="text-foreground">Compartir</strong> abajo en Safari
              </li>
              <li className="flex items-center gap-1.5">
                2. Elige <SquarePlus className="h-4 w-4 text-foreground" />{' '}
                <strong className="text-foreground">Añadir a pantalla de inicio</strong>
              </li>
            </ol>
          )}
          {mode === 'other' && (
            <p className="text-sm text-muted-foreground">
              Abre el menu de tu navegador y elige{' '}
              <strong className="text-foreground">Instalar app</strong> o{' '}
              <strong className="text-foreground">Añadir a pantalla de inicio</strong>.
            </p>
          )}
          {mode === 'inapp' && (
            <p className="text-sm text-muted-foreground">
              Desde esta app no se puede instalar. Abre el menu (···) y elige{' '}
              <strong className="text-foreground">Abrir en el navegador</strong>, y allí instálala.
            </p>
          )}
        </div>
      </div>
      {mode === 'prompt' && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Ahora no
          </Button>
          <Button size="sm" variant="brand" onClick={install}>
            Instalar
          </Button>
        </div>
      )}
    </div>
  );
}

/** Abrir la invitacion a instalar desde cualquier boton (p. ej. el menu). */
export function openInstallApp() {
  window.dispatchEvent(new Event(INSTALL_OPEN_EVENT));
}
