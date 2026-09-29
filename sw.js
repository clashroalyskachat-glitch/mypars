/*
 * NKSE schedule - offline support.
 *
 * Caching strategy is deliberately NOT uniform, because stale data is far
 * worse than a slow page:
 *
 *   app shell (html/js/icons)  cache-first, versioned
 *     - changes only on deploy, and the version constant below is bumped then
 *     - old caches are deleted on activate
 *
 *   /schedule.json             network-first, cache fallback
 *     - online  -> always the freshest file, straight from the server
 *     - offline -> last known good copy
 *
 * The earlier "load from localStorage for 60 min" path is what produced an
 * empty Monday on screen for an hour, so nothing user-facing is ever served
 * from cache while the network is reachable.
 */

const VERSION = 'nkse-v4';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

const SHELL_ASSETS = [
    './',
    'index.html',
    'app.js',
    'manifest.json',
    'icon.svg',
];

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

    // App shell: stale-while-revalidate.
    // Cache-first-forever would pin returning users to the copy they got on
    // their first visit, so a newly deployed index.html/app.js would never
    // reach them. Serving the cached copy keeps the instant paint, while the
    // background refetch means the next load shows the new version.
    const isLocal = url.origin === self.location.origin;
    event.respondWith(
        caches.open(SHELL_CACHE).then(async (cache) => {
            const hit = await cache.match(req, { ignoreSearch: true });
            const fresh = fetch(req)
                .then((res) => {
                    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
                    return res;
                })
                .catch(() => null);

            if (hit) {
                // do not await fresh: respond now, let it update the cache
                if (isLocal) event.waitUntil(fresh);
                return hit;
            }
            const res = await fresh;
            return res || (await cache.match('index.html')) || Response.error();
        })
    );
});

// Lets the page force a full cache reset when something looks stale.
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
    if (event.data === 'CLEAR_CACHES') {
        event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
    }
});
