const CACHE_NAME = 'moneynote-shell-v17';
const ASSETS = ['./', './index.html', './styles.css', './visual.css', './app.js', './image-amount.js', './image-amount-ui.js', './vendor/ocr/tesseract.esm.min.js', './vendor/ocr/worker.min.js', './vendor/ocr/tesseract-core-lstm.wasm.js', './vendor/ocr/tesseract-core-simd-lstm.wasm.js', './vendor/ocr/tesseract-core-relaxedsimd-lstm.wasm.js', './vendor/ocr/vie.traineddata.gz', './category-icons.js', './version.js', './features.js', './finance.js', './csv-import.js', './backup.js', './sync.js', './sync-data.js', './sync-config.js', './vendor/supabase.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './fonts/LilitaOne-Regular.ttf', './fonts/Nunito-wght.ttf'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS.map((asset) => new Request(asset, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request, { cache: 'no-cache' }).then((response) => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request)));
});
