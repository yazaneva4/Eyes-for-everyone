// Service worker: lets the app (and Qibla) open without internet.
const CACHE = 'eyes-v44';
const SHELL = [
  '/',
  '/css/app.css',
  '/css/fonts.css',
  '/fonts/atkinson-hyperlegible-next-latin.woff2',
  '/js/app.js',
  '/js/i18n.js',
  '/js/settings.js',
  '/js/sounds.js',
  '/js/voice.js',
  '/js/camera.js',
  '/js/listen.js',
  '/js/commands.js',
  '/js/glass.js',
  '/js/sensors.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Never cache the AI (photos, audio, answers stay private).
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Network first, so updates arrive at once; the saved copy is used only when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || (await caches.match('/')))
  );
});
