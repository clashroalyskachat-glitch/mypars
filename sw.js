/*
 * NKSE schedule - offline support.
 *
 * Caching strategy is deliberately NOT uniform, because stale data is far
 * worse than a slow page:
 *
 *   app shell (html/js/icons)  network-first, cache fallback
 *     - a reload always shows the currently deployed UI
 *     - cache is only used when the network is unreachable
 *
 *   /schedule.json             network-first, cache fallback
 *     - online  -> always the freshest file, straight from the server
 *     - offline -> last known good copy
 *
 * The earlier "load from localStorage for 60 min" path is what produced an
 * empty Monday on screen for an hour, so nothing user-facing is ever served
 * from cache while the network is reachable.
 */

const VERSION = 'nkse-v8';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

const SHELL_ASSETS = [
    './',
    'index.html',
    'app.js',
    'app.css',
    'manifest.json',
    'icon.svg',
];

// schedule.json is precached too, otherwise the very first offline visit has
// no data to show. Best-effort: a miss here must not block installation.
const DATA_ASSETS = ['schedule.json'];

// Third-party assets: without these the offline page renders unstyled.
const VENDOR_ASSETS = [
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
            // Vendor CSS/fonts: without these the offline page is unstyled.
            .then(() =>
                caches.open(SHELL_CACHE).then((cache) =>
                    Promise.all(VENDOR_ASSETS.map((u) => cache.add(u).catch(() => {})))
                )
            )
            .then(() =>
                caches.open(DATA_CACHE).then((cache) =>
                    Promise.all(DATA_ASSETS.map((u) => cache.add(u).catch(() => {})))
                )
            )
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
            )
            .then(() => self.clients.claim())
    );
});

function isShellRequest(url) {
    if (url.origin === self.location.origin) {
        return /\/(index\.html|app\.js|manifest\.json|icon\.svg)?$/.test(url.pathname);
    }
    return VENDOR_ASSETS.some((u) => url.href.startsWith(u.split('?')[0]));
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Schedule data: network-first, cache only as offline fallback.
    if (url.origin === self.location.origin && url.pathname.endsWith('schedule.json')) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res && res.ok) {
                        const copy = res.clone();
                        caches.open(DATA_CACHE).then((c) => c.put(req, copy));
                    }
                    return res;
                })
                .catch(() =>
                    caches.match(req, { ignoreSearch: true }).then((hit) => {
                        if (hit) {
                            // Let the client know it is looking at cached data.
                            hit.headers.set('X-NKSE-Cache', 'offline');
                        }
                        return hit;
                    })
                )
        );
        return;
    }

    if (!isShellRequest(url)) return;

    // App shell: network-first, cache only as offline fallback.
    //
    // This used to be stale-while-revalidate, which meant the FIRST reload
    // after a deploy still served the previous index.html/app.js and only the
    // second one showed the change - so UI fixes looked like "nothing
    // happened". The files are tiny (a few KB), so paying one request to
    // guarantee the user always sees the current UI is the right trade.
    const isLocal = url.origin === self.location.origin;
    event.respondWith(
        (async () => {
            try {
                const res = await fetch(req);
                if (res && (res.ok || res.type === 'opaque')) {
                    const cache = await caches.open(SHELL_CACHE);
                    cache.put(req, res.clone());
                }
                return res;
            } catch (err) {
                const cache = await caches.open(SHELL_CACHE);
                const hit = await cache.match(req, { ignoreSearch: true });
                if (hit) return hit;
                return (await cache.match('index.html')) || Response.error();
            }
        })()
    );
});

// Lets the page force a full cache reset when something looks stale.
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
    if (event.data === 'CLEAR_CACHES') {
        event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
    }
});
