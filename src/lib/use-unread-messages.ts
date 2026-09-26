'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Numerito de chats sin leer para el icono de Mensajes. Se pide al cambiar
 * de pagina (p. ej. al salir de un chat ya leido) y cada 20 s mientras la
 * pestana esta visible.
 */
export function useUnreadMessages(enabled: boolean): number {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/messages/unread', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { count: 0 }))
        .then((d: { count?: number }) => {
          if (!cancelled) setCount(d.count ?? 0);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 20_000);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [enabled, pathname]);

  return count;
}
