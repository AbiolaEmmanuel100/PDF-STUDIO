/**
 * PDF Studio service worker — makes the app work offline once visited over http(s).
 * Strategy: precache the app shell; serve cache-first, refreshing the cache in the
 * background (stale-while-revalidate). User files are never touched or cached —
 * they never leave the page.
 * Bump VERSION whenever files change so clients pick up the new build.
 */
const VERSION = 'pdf-studio-v2.0.0';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './js/theme-init.js', './js/core/util.js', './js/core/ui.js', './js/core/engine.js', './js/core/sortable.js',
  './js/core/page-grid.js', './js/core/kit.js', './js/core/stamp.js', './js/app.js', './js/main.js',
  './js/tools/merge.js', './js/tools/organize.js', './js/tools/split.js', './js/tools/rotate.js',
  './js/tools/images-to-pdf.js', './js/tools/pdf-to-images.js', './js/tools/docx-to-pdf.js', './js/tools/text-to-pdf.js',
  './js/tools/sign.js', './js/tools/watermark.js', './js/tools/page-numbers.js', './js/tools/metadata.js',
  './js/tools/compress.js', './js/tools/info.js',
  './vendor/pdf-lib.min.js', './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './vendor/fflate.min.js',
  './vendor/mammoth.browser.min.js', './vendor/jspdf.umd.min.js', './vendor/html2canvas.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pdf-studio-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => { if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; })
        .catch(() => undefined);
      if (cached) { event.waitUntil(network); return cached; }
      const res = await network;
      if (res) return res;
      // offline navigation fallback
      if (req.mode === 'navigate') return cache.match('./index.html');
      return new Response('', { status: 504, statusText: 'Offline' });
    }),
  );
});
