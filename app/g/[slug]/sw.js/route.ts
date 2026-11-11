// GET /g/{slug}/sw.js - service worker for the athlete PWA (scope /g/{slug}/).
//  - pages: network first, cached copy when offline, else the offline page
//  - QR keys + crowd meter: network first with a cached fallback, so the QR
//    keeps working with no signal at the gym door
//  - Next.js static files: cache first (they are content-hashed)
//  - web push: show the notification, open the right screen on tap
export const dynamic = 'force-dynamic'

const SOURCE = String.raw`
const BASE = '/g/__SLUG__';
const CACHE = 'kasrat-' + '__SLUG__' + '-v1';
const STATIC = 'kasrat-static-v1';
const CORE = [BASE, BASE + '/qr', BASE + '/schedule', BASE + '/offline'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(CORE.map((url) => cache.add(new Request(url, { credentials: 'include' })).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('kasrat-') && key !== CACHE && key !== STATIC && key.indexOf('__SLUG__') !== -1).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const offline = await cache.match(fallbackUrl);
      if (offline) return offline;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/pwa/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.pathname === '/api/g/__SLUG__/me/qr-key' || url.pathname === '/api/g/__SLUG__/occupancy') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (request.mode === 'navigate' && (url.pathname === BASE || url.pathname.startsWith(BASE + '/'))) {
    event.respondWith(networkFirst(request, BASE + '/offline'));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'logout') event.waitUntil(caches.delete(CACHE));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = { title: 'Rep+', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Rep+', {
      body: data.body || '',
      icon: '/pwa/icon-192.png',
      badge: '/pwa/icon-192-maskable.png',
      tag: data.tag || undefined,
      data: { url: data.url || BASE },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || BASE;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.indexOf(BASE) !== -1 && 'focus' in client) { client.navigate(target); return client.focus(); }
      }
      return self.clients.openWindow(target);
    }),
  );
});
`

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safe = slug.replace(/[^a-z0-9-]/g, '')
  return new Response(SOURCE.replace(/__SLUG__/g, safe), {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': `/g/${safe}/` },
  })
}
