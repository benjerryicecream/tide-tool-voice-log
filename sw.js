/* Tide & Tool Voice Log — small offline shell cache.
   Code and markup are network-first so a deploy is picked up immediately,
   with the cached copy as the offline fallback. Icons are cache-first.
   Audio, transcripts and the speech model never pass through here. */
var CACHE = 'tide-tool-shell-v3';
var ENGINE_CACHE = 'tide-tool-engine-v3';
var ENGINE_ORIGIN = 'https://cdn.jsdelivr.net';
var SHELL = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './manifest.webmanifest',
  './js/core.js',
  './js/recorder.js',
  './js/whisper.js',
  './js/ai.js',
  './js/ui.js',
  './js/main.js'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { /* optional file */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return (k === CACHE || k === ENGINE_CACHE) ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // The speech engine module from jsDelivr: cache-first so transcription works offline.
  if (url.origin === ENGINE_ORIGIN) {
    ev.respondWith(
      caches.open(ENGINE_CACHE).then(function (c) {
        return c.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok) c.put(req, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // never intercept model downloads or AI calls

  var cacheFirst = /\.(png|jpg|svg|woff2?)$/i.test(url.pathname);

  if (cacheFirst) {
    ev.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  ev.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw new Error('offline');
      });
    })
  );
});
