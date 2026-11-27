const CACHE_APP = "badabus-app-v8";
const CACHE_RED = "badabus-red-v2";

const SHELL = [
  "/",
  "/styles.css",
  "/app.js",
  "/i18n.js",
  "/storage.js",
  "/mapa.js",
  "/vistas.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

const DATOS_RED = [
  "/data/paradas.json",
  "/data/lineas.json",
  "/data/red.json",
  "/data/shapes.json",
  "/data/dias.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_APP).then((c) => c.addAll(SHELL)),
      caches.open(CACHE_RED).then((c) => c.addAll(DATOS_RED)).catch(() => {}),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const validos = new Set([CACHE_APP, CACHE_RED]);
  event.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(claves.filter((k) => !validos.has(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Let live API requests pass directly to the network.
  if (url.pathname.startsWith("/api/")) return;

  // Network-first with offline cache fallback for static network JSON.
  if (url.pathname.startsWith("/data/")) {
    event.respondWith(
      caches.open(CACHE_RED).then(async (cache) => {
        try {
          const resp = await fetch(request);
          if (resp.ok) cache.put(request, resp.clone());
          return resp;
        } catch {
          const guardado = await cache.match(request);
          return guardado || new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
        }
      })
    );
    return;
  }

  // Network-first with offline cache fallback for app shell assets.
  event.respondWith(
    caches.open(CACHE_APP).then(async (cache) => {
      try {
        const resp = await fetch(request);
        if (resp.ok) cache.put(request, resp.clone());
        return resp;
      } catch {
        const guardado = await cache.match(request);
        return guardado || caches.match("/") || new Response("Offline", { status: 503 });
      }
    })
  );
});
