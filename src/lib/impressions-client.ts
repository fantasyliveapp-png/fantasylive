'use client';

/**
 * Cola de "vistas" del feed: junta las publicaciones vistas y las manda en
 * lote cada pocos segundos, y con sendBeacon al cerrar o cambiar de pestana
 * para no perder las ultimas.
 */
const queue = new Set<string>();
const sent = new Set<string>();
let timer: number | null = null;
let listening = false;

function flush(useBeacon = false) {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (queue.size === 0) return;
  const ids = [...queue].slice(0, 50);
  ids.forEach((id) => {
    queue.delete(id);
    sent.add(id);
  });
  const body = JSON.stringify({ ids });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon('/api/feed/impressions', new Blob([body], { type: 'application/json' }));
  } else {
    void fetch('/api/feed/impressions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  }
  if (queue.size > 0) schedule();
}

function schedule() {
  if (timer === null) timer = window.setTimeout(() => flush(), 3000);
}

export function trackImpression(postId: string) {
  if (sent.has(postId) || queue.has(postId)) return;
  queue.add(postId);
  if (!listening) {
    listening = true;
    window.addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(true);
    });
  }
  schedule();
}
