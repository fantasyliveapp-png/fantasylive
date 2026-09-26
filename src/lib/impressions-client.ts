'use client';

import { useEffect, useRef } from 'react';

/**
 * TIEMPO DE VISUALIZACION del feed.
 *
 * Cada tarjeta mide cuanto tiempo esta (al menos a medias) en pantalla. Al
 * salir de la pantalla ese rato se encola; la cola se manda en lote cada
 * pocos segundos y, al cerrar o cambiar de pestana, con sendBeacon para no
 * perder lo ultimo. Un video visto (casi) entero se marca aparte.
 */
type Pending = { ms: number; done: boolean };
const queue = new Map<string, Pending>();
let timer: number | null = null;
let listening = false;
const flushHandlers = new Set<() => void>();

/** Menos que esto no llega a ser una vista (scroll muy rapido). */
const MIN_VISIBLE_MS = 300;

function send(useBeacon: boolean) {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (queue.size === 0) return;
  const items = [...queue.entries()].slice(0, 50).map(([id, v]) => ({
    id,
    ms: Math.round(v.ms),
    ...(v.done ? { done: true } : {}),
  }));
  items.forEach((i) => queue.delete(i.id));
  const body = JSON.stringify({ items });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon('/api/feed/impressions', new Blob([body], { type: 'application/json' }));
  } else {
    void fetch('/api/feed/impressions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  }
  if (queue.size > 0) schedule();
}

function schedule() {
  if (timer === null) timer = window.setTimeout(() => send(false), 4000);
}

function ensureListeners() {
  if (listening) return;
  listening = true;
  const leave = () => {
    // Las tarjetas visibles cierran su rato antes de mandar.
    flushHandlers.forEach((fn) => fn());
    send(true);
  };
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
  });
}

function enqueue(postId: string, ms: number, done = false) {
  const prev = queue.get(postId);
  queue.set(postId, { ms: (prev?.ms ?? 0) + ms, done: Boolean(prev?.done || done) });
  ensureListeners();
  schedule();
}

/** El video de esta publicacion se ha visto (casi) entero. */
const completedSent = new Set<string>();

export function markCompleted(postId: string) {
  if (completedSent.has(postId)) return;
  completedSent.add(postId);
  enqueue(postId, 0, true);
}

/**
 * Mide el tiempo en pantalla de un elemento y lo registra para `postId`.
 * `enabled` = false en vistas previas o en publicaciones propias.
 */
export function useViewTracking(postId: string, enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let since: number | null = null;
    let intersecting = false;
    const close = () => {
      if (since === null) return;
      const ms = performance.now() - since;
      since = null;
      if (ms >= MIN_VISIBLE_MS) enqueue(postId, ms);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        intersecting = Boolean(entry?.isIntersecting);
        if (intersecting && document.visibilityState === 'visible') {
          if (since === null) since = performance.now();
        } else {
          close();
        }
      },
      { threshold: 0.5 },
    );
    // Al volver a la pestana, lo que sigue en pantalla vuelve a contar.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && intersecting && since === null) {
        since = performance.now();
      }
    };
    observer.observe(el);
    flushHandlers.add(close);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      close();
      observer.disconnect();
      flushHandlers.delete(close);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [postId, enabled]);

  return ref;
}
