/*
 * Service worker: офлайн-оболочка библиотеки.
 *
 * Книги лежат в Google Drive, их кэшировать бессмысленно и нельзя -
 * здесь только сам сайт. Поэтому запросы к drive.google.com не трогаем.
 */

var VERSION = 'library-v7';

var SHELL = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './books.js',
    './icon.svg',
    './icon-180.png',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './manifest.webmanifest'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(VERSION)
            .then(function (cache) { return cache.addAll(SHELL); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (keys) {
                return Promise.all(keys.map(function (key) {
                    if (key !== VERSION) return caches.delete(key);
                    return null;
                }));
            })
            .then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') return;

    var url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    /* Страницы: сначала сеть, чтобы обновления прилетали сразу. */
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(function (response) {
                    var copy = response.clone();
                    caches.open(VERSION).then(function (cache) {
                        cache.put('./index.html', copy);
                    });
                    return response;
                })
                .catch(function () {
                    return caches.match('./index.html').then(function (cached) {
                        return cached || caches.match('./');
                    });
                })
        );
        return;
    }

    /* Остальное: отдаём из кэша, параллельно обновляем. */
    event.respondWith(
        caches.match(request).then(function (cached) {
            var network = fetch(request).then(function (response) {
                if (response && response.ok) {
                    var copy = response.clone();
                    caches.open(VERSION).then(function (cache) {
                        cache.put(request, copy);
                    });
                }
                return response;
            }).catch(function () {
                return cached;
            });

            return cached || network;
        })
    );
});

