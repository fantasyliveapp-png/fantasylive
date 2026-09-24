/*
 * Service worker de FantasyLive (app instalable).
 *
 * Deliberadamente minimo: NO guarda paginas ni fotos en el movil (hay
 * contenido privado y de pago que no debe quedarse en cache). Solo guarda la
 * pantalla "Sin conexion" (con el icono dentro), para enseñarla sin internet.
 */
const CACHE = 'fl-shell-v3';
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
