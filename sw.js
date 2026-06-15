/* Service Worker — Höher geht immer · Die Werkzeuge
   Offline-first: App-Shell + werkzeuge.json + Icons werden gecacht.
   Navigationsanfragen (auch Deep Links /werkzeug/:id) fallen offline auf index.html zurück. */
const VERSION = "hgi-werkzeuge-v2";
const SHELL = [
  "/",
  "/index.html",
  "/app.js",
  "/manifest.webmanifest",
  "/werkzeuge.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-180.png",
  "/icons/maskable-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  // Navigation (Deep Links): erst Netz, offline -> gecachte index.html
  if(req.mode === "navigate"){
    e.respondWith(
      fetch(req).catch(() => caches.match("/index.html").then(r => r || caches.match("/")))
    );
    return;
  }

  // werkzeuge.json: network-first, damit Inhalte aktuell bleiben
  if(url.pathname === "/werkzeuge.json"){
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Übrige Assets: cache-first, im Hintergrund auffrischen
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if(res && res.status === 200){ const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
