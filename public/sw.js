/*
 * Service worker de FantasyLive (app instalable).
 *
 * Deliberadamente minimo: NO guarda paginas ni fotos en el movil (hay
 * contenido privado y de pago que no debe quedarse en cache). Solo guarda la
 * pantalla "Sin conexion" (con el icono dentro), para enseñarla sin internet.
 */
const CACHE = 'fl-shell-v4';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Solo navegaciones (abrir una pagina): siempre de la red; si falla, la
  // pantalla de sin conexion. Todo lo demas pasa sin tocarlo.
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  event.respondWith(
    fetch(req).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached || Response.error();
    }),
  );
});

// ---------------------------------------------------------------------------
// AVISOS AL MOVIL (Web Push)
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : 'FantasyLive' };
  }
  const title = data.title || 'FantasyLive';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || '/' },
    }),
  );
});

// Al tocar el aviso: si la app ya esta abierta, se usa esa ventana.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/';
  // Solo paginas de la propia web.
  const target = new URL(path, self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin) && 'focus' in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
