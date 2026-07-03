/* Seoul Dex service worker — offline-first app shell + runtime tile cache. */
var VERSION = "seoul-dex-v3";
var SHELL = VERSION + "-shell";
var TILES = VERSION + "-tiles";

var PRECACHE = [
  "./",
  "index.html",
  "css/styles.css",
  "js/data.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL).then(function (cache) {
      // cache individually so one failing CDN asset doesn't abort the whole install
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
      }));
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf(VERSION) !== 0) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // Map tiles -> cache-first, then network, store in tile cache
  if (/tile\.openstreetmap\.org/.test(url.hostname)) {
    e.respondWith(
      caches.open(TILES).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            // tiles may come back opaque (no-cors) or 200 (cors) — cache either so the map works offline
            if (res && (res.status === 200 || res.type === "opaque")) cache.put(req, res.clone());
            return res;
          }).catch(function () { return hit; });
        });
      })
    );
    return;
  }

  // Weather -> network-first, fall back to cache (app also has localStorage fallback)
  if (/api\.open-meteo\.com/.test(url.hostname)) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // App shell & everything else -> cache-first, fall back to network
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.status === 200 && (url.origin === location.origin)) {
          var copy = res.clone();
          caches.open(SHELL).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // last resort for navigations: serve the app shell
        if (req.mode === "navigate") return caches.match("index.html");
      });
    })
  );
});
