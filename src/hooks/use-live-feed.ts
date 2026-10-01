'use client';

import { useEffect, useRef, useState } from 'react';

const QUEUE_KEY = 'fl-live-queue';
const FLUSH_EVERY_S = 15;

function readQueue(): string[] {
  try {
    const raw = sessionStorage.getItem(QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: string[]) {
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Sin sessionStorage se desliza igual; solo se pierde el orden fijo.
  }
}

/**
 * Cola de deslizar de esta sesion, como el feed de TikTok: el orden ya visto
 * no cambia (volver hacia atras lleva a donde estabas), y lo nuevo que
 * recomienda el algoritmo se añade al final.
 *
 * `feed` es el orden personalizado que manda el servidor en cada pagina; los
 * directos que ya no estan en el (terminados) se quitan de la cola.
 */
export function useLiveQueue(currentSlug: string, feed: string[]) {
  const [queue, setQueue] = useState<string[]>([]);
  const feedKey = feed.join(',');

  useEffect(() => {
    const live = new Set(feed);
    let stored = readQueue().filter((s) => s === currentSlug || live.has(s));
    // Entrar a un directo que no estaba en la cola (desde /live, un enlace
    // compartido...) empieza una cola nueva a partir de el.
    if (!stored.includes(currentSlug)) stored = [currentSlug];
    stored = [...stored, ...feed.filter((s) => !stored.includes(s))];
    writeQueue(stored);
    setQueue(stored);
    // feedKey resume feed: el array cambia de identidad en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlug, feedKey]);

  const index = queue.indexOf(currentSlug);
  return {
    nextSlug: index >= 0 ? (queue[index + 1] ?? null) : null,
    prevSlug: index > 0 ? (queue[index - 1] ?? null) : null,
  };
}

/**
 * Mide cuanto tiempo se mira un directo (solo con la pestana visible y con
 * la sala conectada) y lo envia a /api/live/watch cada 15 s y al salir.
 * Es la senal de retencion del algoritmo de directos.
 */
export function useLiveWatchTime(streamId: string, watching: boolean) {
  const pendingRef = useRef(0);
  const watchingRef = useRef(watching);
  watchingRef.current = watching;

  useEffect(() => {
    function flush() {
      const seconds = Math.min(60, Math.floor(pendingRef.current));
      if (seconds < 1) return;
      pendingRef.current -= seconds;
      void fetch('/api/live/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId, seconds }),
        // Sobrevive al cierre de la pestana y a la navegacion al deslizar.
        keepalive: true,
      }).catch(() => {
        // Un tramo perdido solo resta unos segundos de precision.
      });
    }

    let sinceFlush = 0;
    const tick = setInterval(() => {
      if (!watchingRef.current || document.visibilityState !== 'visible') return;
      pendingRef.current += 1;
      sinceFlush += 1;
      if (sinceFlush >= FLUSH_EVERY_S) {
        sinceFlush = 0;
        flush();
      }
    }, 1_000);

    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);

    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [streamId]);
}
