// Service worker: lets the installed app open instantly and work offline.
//
// Strategy: network first (always revalidated, so a new deploy or a changed
// collection date shows up right away), falling back to the last good copy when
// the network is slow (> 4 s) or gone. Everything the app needs is precached.
const CACHE = 'abfall-v4'; // bump when the set of files changes so the old cache is dropped on activate
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'config.json',
  'data/collections.json',
  'data/announcements.json',
  'css/styles.css',
  'css/scene.css',
  'js/app.js',
  'js/shell.js',
  'js/bins.js',
  'js/dates.js',
  'js/icons.js',
  'js/prefs.js',
  'js/ics.js',
  'js/scene.js',
  'js/pdf.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
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
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(request, url));
});

// "/", "/index.html" and "/?today=…" are all the same page: keep a single cached copy.
const isPage = (url) => url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');

async function networkFirst(request, url) {
  const cache = await caches.open(CACHE);
  const key = isPage(url) ? scopeUrl('index.html') : request.url;

  const network = fetch(url.href, { cache: 'no-cache' }).then((response) => {
    if (response.status >= 500) throw new Error(`server error ${response.status}`); // prefer the cached copy
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS));

  try {
    return await Promise.race([network, timeout]);
  } catch {
    network.catch(() => {}); // a late failure after the timeout is already handled
    return (await cache.match(key)) ?? Response.error();
  }
}
