/* spot-sw.js — service worker for the Transit Spotter app.
   Caches the app shell so it opens instantly and keeps working with no signal
   (you're often underground or on a plane when you want to log something).
   Live data (airplanes.live / amtraker) is always network-first and simply
   absent offline; the log itself is local, so logging never needs a network. */
const CACHE = "spotter-v1";
const SHELL = ["spot.html", "theme.css", "spot-manifest.json",
               "spot-icon-192.png", "spot-icon-512.png", "spot-icon-180.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                        // never cache log POSTs
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;              // live feeds: straight to network
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match("spot.html")))
  );
});
