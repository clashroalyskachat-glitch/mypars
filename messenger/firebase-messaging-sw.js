/* Firebase Cloud Messaging service worker for the messenger. */

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'AIzaSyAjRgRf0_tJu5LpsGBWecGYxvh3w2aPZvk',
    authDomain: 'nkselove.firebaseapp.com',
    projectId: 'nkselove',
    storageBucket: 'nkselove.firebasestorage.app',
    messagingSenderId: '520052696233',
    appId: '1:520052696233:web:1ab56a3e2206b3f58e35b8',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    const title = (payload.notification && payload.notification.title) || data.title || 'pps';
    const body = (payload.notification && payload.notification.body) || data.body || '';

    self.registration.showNotification(title, {
        body,
        icon: '/mypars/library/icon.svg',
        badge: '/mypars/library/icon.svg',
        tag: data.tag || ('msg-' + (data.nick || '')),
        data,
        vibrate: [120, 60, 120],
        requireInteraction: data.type === 'call',
    });
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    const nick = data.nick || '';
    const target = '/mypars/messenger/' + (nick ? '?add=' + encodeURIComponent(nick) : '');

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            for (const client of list) {
                if (client.url.indexOf('/mypars/messenger/') !== -1) {
                    client.focus();
                    client.postMessage({ type: 'pps-open', nick, call: data.type === 'call' });
                    return;
                }
            }
            return clients.openWindow(target);
        })
    );
});
