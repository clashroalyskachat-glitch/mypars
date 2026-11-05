(function () {
    'use strict';

    const lowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
        || (navigator.deviceMemory && navigator.deviceMemory <= 4)
        || (navigator.connection && navigator.connection.saveData);
    if (lowPower) document.documentElement.classList.add('pps-low-power');

    const $ = (id) => document.getElementById(id);
    const LS = {
        token: 'pps.token',
        user: 'pps.user',
        chats: 'pps.chats',
        theme: 'nkse-theme',
    };

    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const WS_URL = window.PPS_WS || (isLocal ? wsProto + '://' + location.host + '/ws' : '');
    const SUPABASE = window.PPS_SUPABASE || null;
    const USE_SUPABASE = !!SUPABASE;

    const state = {
        ws: null,
        token: localStorage.getItem(LS.token) || '',
        me: null,
        chats: (readJson(LS.chats, []) || [])
            .map((chat) => (typeof chat === 'string'
                ? { nick: chat, uid: null, chatId: null, lastTs: '' }
                : Object.assign({ chatId: null, lastTs: '' }, chat)))
            .filter((chat) => chat && chat.nick),
        peer: null,
        peerUid: null,
        chatId: null,
        chatChannel: null,
        presenceChannel: null,
        presenceHooked: false,
        signalChannel: null,
        signalOut: new Map(),
        sb: null,
        sbJwt: '',
        sbUid: '',
        chatMeta: readJson('pps.chatmeta', {}) || {},
        hiddenChats: readJson('pps.hidden', {}) || {},
        localDeleted: readJson('pps.deleted', {}) || {},
        contextMessage: null,
        settings: (function () {
            const saved = readJson('pps.settings', null) || {};
            const defaults = {
                notifications: false,
                dnd: false,
                silent: true,
                contactsOnly: false,
                status: '',
                invisible: false,
                v2: true,
            };
            /* One-time migration: older builds enabled sounds by default. */
            if (!saved.v2) return defaults;
            return Object.assign(defaults, saved);
        })(),
        syncTimer: 0,
        syncBusy: false,
        syncAllTimer: 0,
        syncAllBusy: false,
        ringTimer: 0,
        callTimeout: 0,
        signalPollTimer: 0,
        seenSignals: new Set(),
        clockOffset: 0,
        audioCtx: null,
        wakeLock: null,
        callStartedAt: 0,
        chatLastTs: '',
        messages: new Map(),
        online: new Set(),
        statuses: {},
        unread: new Map(),
        search: [],
        searchLoading: false,
        searchTimer: 0,
        authMode: 'login',
        retry: 0,
        call: null,
        pendingCall: null,
        scanStream: null,
        scanTimer: 0,
        scanDetector: null,
        scanCanvas: null,
        scanLoading: false,
        stickerPacks: (readJson('pps.stickerpacks', null) || [])
            .filter((pack) => pack && pack.id && Array.isArray(pack.stickers)),
        activePack: '',
    };

    const EMOJIS = [
        '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
        '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋',
        '😛', '🤪', '😜', '🤨', '🧐', '🤓', '😎', '🥳',
        '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣',
        '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
        '😡', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰',
        '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶',
        '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮',
        '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴',
        '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠',
        '😈', '👿', '👻', '💀', '👽', '🤖', '💩', '🔥',
        '✨', '💫', '⭐', '🌟', '✅', '❤️', '🧡', '💛',
        '💚', '💙', '💜', '🖤', '🤍', '💔', '💯', '👍',
        '👎', '👏', '🙌', '🤝', '🙏', '💪', '🎉', '🎊',
        '🎁', '🍕', '🍔', '☕', '🎧', '🎮', '⚽', '🏀',
        '🚀', '🌙', '☀️', '🌈',
    ];
    const STICKERS = [
        '😂', '🥰', '😎', '🤯', '😭', '😡', '🥳', '🤔',
        '👍', '🔥', '💯', '🎉', '❤️', '🚀', '🌙', '💩',
    ];
    let emojiTab = 'emoji';

    if (!state.stickerPacks.length) {
        state.stickerPacks = [{ id: 'reactions', name: 'Реакции', stickers: STICKERS.slice() }];
    }
    if (!state.stickerPacks.some((pack) => pack.id === state.activePack)) {
        state.activePack = state.stickerPacks[0].id;
    }

    const call = {
        pc: null,
        local: null,
        peer: null,
        media: 'audio',
        incoming: null,
        candidates: [],
        active: false,
    };

    /* Debug hook for local development; harmless in production. */
    window.__ppsState = state;

    /* ------------------------------------------------------------- storage */

    function readJson(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key));
            return value == null ? fallback : value;
        } catch (e) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    }

    function historyKey(nick) {
        return 'pps.history.' + String(nick).toLowerCase();
    }

    function loadHistory(nick) {
        if (!state.messages.has(nick)) {
            state.messages.set(nick, readJson(historyKey(nick), []));
        }
        return state.messages.get(nick);
    }

    function saveHistory(nick, list) {
        const sorted = list.slice().sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
        state.messages.set(nick, sorted.slice(-300));
        writeJson(historyKey(nick), state.messages.get(nick));
    }

    /* --------------------------------------------------------------- utils */

    const esc = (value) => String(value == null ? '' : value);
    const initial = (nick) => esc(nick).trim().charAt(0).toUpperCase() || '?';

    function avatarHue(nick) {
        let hash = 0;
        for (const char of String(nick || '')) {
            hash = (hash * 31 + char.codePointAt(0)) % 360;
        }
        return hash;
    }

    function paintAvatar(element, nick) {
        if (!element) return;
        element.style.setProperty('--avatar-hue', String(avatarHue(nick)));
        element.textContent = initial(nick);
    }
    const isOnline = (nick) => state.online.has(String(nick).toLowerCase());

    function presenceText(nick) {
        if (!isOnline(nick)) return 'не в сети';
        const status = state.statuses[String(nick).toLowerCase()];
        return status || 'в сети';
    }

    function updateOwnStatus() {
        const text = state.settings.invisible ? 'скрыт' : (state.settings.status || 'в сети');
        if ($('settings-status')) $('settings-status').textContent = text;
        if ($('me-status')) $('me-status').textContent = text;
    }

    function trackPresence() {
        if (!state.presenceChannel || !state.me) return;
        state.presenceChannel.track({
            uid: state.sbUid,
            nick: state.me.nick,
            status: state.settings.status || '',
            invisible: !!state.settings.invisible,
        }).catch(() => {});
    }

    function fmtTime(ts) {
        try {
            return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    function dayLabel(ts) {
        const date = new Date(ts);
        const today = new Date();
        const start = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
        const diff = Math.round((start(today) - start(date)) / 86400000);
        if (diff === 0) return 'Сегодня';
        if (diff === 1) return 'Вчера';
        return date.toLocaleDateString([], { day: 'numeric', month: 'long' });
    }

    function newId() {
        return (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(16).slice(2));
    }

    function serverNow() {
        return Date.now() + (state.clockOffset || 0);
    }

    function serverNowIso() {
        return new Date(serverNow()).toISOString();
    }

    function send(payload) {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify(payload));
            return true;
        }
        return false;
    }

    function updatePeerCount() {
        const el = $('peer-count');
        if (!el) return;
        const dot = $('conn-dot-side');
        const connected = dot ? dot.classList.contains('on') : true;
        const count = state.online.size;
        el.textContent = !connected
            ? 'Нет связи'
            : state.settings.invisible
                ? 'Скрыт'
                : (count > 0 ? count + ' онлайн' : 'В сети');
    }

    function setConn(on) {
        const dot = $('conn-dot');
        if (dot) dot.classList.toggle('on', !!on);
        const side = $('conn-dot-side');
        if (side) side.classList.toggle('on', !!on);
        updatePeerCount();
    }

    function showAuth(message) {
        document.body.classList.add('auth-locked');
        $('auth-modal').hidden = false;
        if (message) {
            $('auth-error').textContent = message;
            $('auth-error').hidden = false;
        }
        setTimeout(() => $('auth-nick').focus(), 30);
    }

    function hideAuth() {
        document.body.classList.remove('auth-locked');
        $('auth-modal').hidden = true;
        $('auth-error').hidden = true;
    }

    function setMe(user) {
        state.me = user;
        state.sbUid = user.uid || state.sbUid;
        writeJson(LS.user, user);
        $('me-bar').hidden = false;
        $('me-nick').textContent = user.nick;
        $('me-avatar').textContent = initial(user.nick);
        $('logout-btn').hidden = true;
        paintAvatar($('settings-avatar'), user.nick);
        $('settings-nick').textContent = user.nick;
        updateOwnStatus();
        $('search').disabled = false;
        updatePeerCount();
    }

    /* ----------------------------------------------------------- websocket */

    function connect() {
        if (!WS_URL) {
            showAuth('Сервер мессенджера ещё не подключён. Локально: node messenger/dev-server.mjs');
            return;
        }

        try {
            state.ws = new WebSocket(WS_URL);
        } catch (e) {
            showAuth('Не удалось открыть WebSocket.');
            return;
        }

        state.ws.onopen = () => {
            state.retry = 0;
            setConn(true);
            if (state.token) {
                send({ type: 'resume', token: state.token });
            } else {
                showAuth();
            }
        };

        state.ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch (e) { return; }
            handle(msg);
        };

        state.ws.onclose = () => {
            setConn(false);
            const delay = Math.min(5000, 400 * Math.pow(2, state.retry++));
            setTimeout(connect, delay);
        };

        state.ws.onerror = () => {
            try { state.ws.close(); } catch (e) { /* ignore */ }
        };
    }

    function handle(msg) {
        switch (msg.type) {
            case 'welcome':
                state.online = new Set((msg.users || []).filter((u) => u.online).map((u) => u.nick.toLowerCase()));
                renderPresence();
                break;

            case 'auth':
                if (msg.ok) {
                    state.token = msg.token;
                    localStorage.setItem(LS.token, msg.token);
                    setMe(msg.user);
                    hideAuth();
                    bootChats();
                } else {
                    localStorage.removeItem(LS.token);
                    state.token = '';
                    state.me = null;
                    $('me-bar').hidden = true;
                    $('logout-btn').hidden = true;
                    $('search').disabled = true;
                    $('chat-view').hidden = true;
                    $('empty').hidden = false;
                    showAuth(authError(msg.error));
                }
                break;

            case 'presence':
                if (msg.online) state.online.add(msg.nick.toLowerCase());
                else state.online.delete(msg.nick.toLowerCase());
                state.online.delete(state.me ? state.me.nick.toLowerCase() : '');
                renderPresence();
                break;

            case 'search':
                state.search = (msg.users || []).filter((u) => !state.me || u.nick !== state.me.nick);
                state.searchLoading = false;
                renderSearch();
                break;

            case 'history': {
                const peer = msg.with;
                const local = loadHistory(peer);
                const merged = mergeMessages(local, msg.messages || []);
                saveHistory(peer, merged);
                if (state.peer === peer) renderMessages();
                renderChats();
                break;
            }

            case 'message':
                receiveMessage(msg.message);
                break;

            case 'ack': {
                for (const list of state.messages.values()) {
                    const found = list.find((m) => m.id === msg.id);
                    if (found) {
                        found.status = 'sent';
                        if (state.peer) saveHistory(state.peer, loadHistory(state.peer));
                        renderMessages();
                        break;
                    }
                }
                break;
            }

            case 'signal':
                handleSignal(msg.from, msg.data);
                break;

            case 'signal-error':
                if (call.active) setCallStatus(msg.error === 'offline' ? 'собеседник не в сети' : 'не удалось позвонить');
                break;

            case 'error':
                break;
        }
    }

    function authError(code) {
        return {
            bad_nick: 'Ник: 3–20 знаков, буквы, цифры, _ и -.',
            bad_pass: 'Пароль: от 6 до 100 знаков.',
            nick_taken: 'Этот ник уже занят.',
            wrong_pass: 'Неверный ник или пароль.',
            too_many: 'Слишком много попыток. Подожди минуту.',
            no_session: 'Сессия истекла — войди снова.',
        }[code] || 'Ошибка входа.';
    }

    function mergeMessages(a, b) {
        const map = new Map();
        for (const message of a || []) map.set(message.id, message);
        for (const message of b || []) map.set(message.id, message);
        return [...map.values()].sort((x, y) => x.ts - y.ts);
    }

    /* --------------------------------------------------------------- chats */

    function addChat(nick, uid) {
        if (!nick || (state.me && nick === state.me.nick)) return;
        const existing = state.chats.find((chat) => chat.nick === nick);
        if (existing) {
            if (uid) existing.uid = uid;
            return;
        }
        state.chats.push({ nick, uid: uid || null, chatId: null, lastTs: '' });
        writeJson(LS.chats, state.chats);
    }

    function metaFor(nick) {
        if (!state.chatMeta[nick]) {
            state.chatMeta[nick] = { muted: false, blocked: false };
        }
        return state.chatMeta[nick];
    }

    function saveChatMeta() {
        writeJson('pps.chatmeta', state.chatMeta);
    }

    function saveHiddenChats() {
        writeJson('pps.hidden', state.hiddenChats);
    }

    function isLocallyDeleted(nick, id) {
        return (state.localDeleted[nick] || []).includes(id);
    }

    function markLocallyDeleted(nick, id) {
        const list = state.localDeleted[nick] || [];
        if (!list.includes(id)) list.push(id);
        state.localDeleted[nick] = list.slice(-500);
        writeJson('pps.deleted', state.localDeleted);
    }

    function removeMessageLocal(nick, id) {
        const list = loadHistory(nick).filter((message) => message.id !== id);
        saveHistory(nick, list);
        if (state.peer === nick) renderMessages();
        renderChats();
    }

    function handleDeleted(payload) {
        const clientId = payload && payload.clientId;
        const dbId = payload && payload.id;
        for (const [nick, list] of [...state.messages.entries()]) {
            const next = list.filter((message) => {
                if (clientId && message.id === clientId) return false;
                if (dbId && message.dbId === dbId) return false;
                return true;
            });
            if (next.length !== list.length) saveHistory(nick, next);
        }
        if (state.peer) renderMessages();
        renderChats();
    }

    function removeChatLocal(nick) {
        const wasActive = state.peer === nick;
        state.chats = state.chats.filter((chat) => chat.nick !== nick);
        writeJson(LS.chats, state.chats);
        localStorage.removeItem(historyKey(nick));
        state.messages.delete(nick);
        state.unread.delete(nick);
        delete state.chatMeta[nick];
        saveChatMeta();
        delete state.localDeleted[nick];
        writeJson('pps.deleted', state.localDeleted);
        if (wasActive) closeChat();
        else renderChats();
    }

    function handleChatDeleted(payload) {
        const nick = payload && payload.nick;
        if (!nick) return;
        hideChat(nick);
        removeChatLocal(nick);
        showToast('Чат удалён');
    }

    function showMessageMenu(event, message) {
        state.contextMessage = message;
        const menu = $('message-menu');
        const deleteAll = menu.querySelector('[data-msg-action="delete-all"]');
        if (deleteAll) deleteAll.hidden = false;

        menu.hidden = false;
        const width = 190;
        const height = 130;
        const x = Math.min(event.clientX || 20, window.innerWidth - width - 10);
        const y = Math.min(event.clientY || 20, window.innerHeight - height - 10);
        menu.style.left = Math.max(8, x) + 'px';
        menu.style.top = Math.max(8, y) + 'px';
        event.preventDefault();
    }

    async function deleteContextMessage(forAll) {
        const message = state.contextMessage;
        const peer = state.peer;
        $('message-menu').hidden = true;
        state.contextMessage = null;
        if (!message || !peer) return;

        if (forAll) {
            if (!state.me) return;
            removeMessageLocal(peer, message.id);
            let ok = false;

            try {
                const session = readNkseSession();
                const result = await appsScriptCall({
                    board: 'messages',
                    op: 'delete',
                    token: session.token,
                    id: message.dbId || '',
                    clientId: message.id || '',
                });
                ok = !!(result && result.ok);
            } catch (e) {
                ok = false;
            }

            if (!ok && state.sb) {
                try {
                    const patch = {
                        deleted_at: new Date().toISOString(),
                        deleted_for_all: true,
                        body: '',
                    };
                    let query = state.sb.from('messages').update(patch);
                    query = message.dbId
                        ? query.eq('id', message.dbId)
                        : query.eq('client_id', message.id).eq('sender_id', state.sbUid);
                    const { error } = await query;
                    ok = !error;
                } catch (e) {
                    ok = false;
                }
            }

            if (!ok) {
                const list = loadHistory(peer);
                if (!list.some((item) => item.id === message.id)) list.push(message);
                saveHistory(peer, list);
                renderMessages();
                renderChats();
                showToast('Не удалось удалить у всех');
                return;
            }

            if (state.peerUid) {
                sendUserEvent(state.peerUid, 'message-deleted', {
                    id: message.dbId,
                    clientId: message.id,
                }).catch(() => {});
            }
            if (state.chatChannel) {
                state.chatChannel.send({
                    type: 'broadcast',
                    event: 'message-deleted',
                    payload: { id: message.dbId, clientId: message.id },
                }).catch(() => {});
            }
        } else {
            markLocallyDeleted(peer, message.id);
            removeMessageLocal(peer, message.id);
        }
    }

    function hideChat(nick) {
        state.hiddenChats[nick] = serverNow();
        saveHiddenChats();
    }

    function unhideChat(nick) {
        if (state.hiddenChats[nick]) {
            delete state.hiddenChats[nick];
            saveHiddenChats();
        }
    }

    function applyChatMeta(nick) {
        const meta = metaFor(nick);
        const input = $('text');
        input.disabled = !!meta.blocked;
        input.placeholder = meta.blocked ? 'Пользователь заблокирован' : 'Сообщение…';
        $('chat-banner').hidden = !meta.blocked;
        $('chat-banner').textContent = meta.blocked ? 'Пользователь заблокирован. Сообщения не отправляются.' : '';
        const mute = document.querySelector('[data-action="mute"]');
        const block = document.querySelector('[data-action="block"]');
        if (mute) mute.textContent = meta.muted ? 'Включить звук' : 'Без звука';
        if (block) block.textContent = meta.blocked ? 'Разблокировать' : 'Заблокировать';
    }

    function saveSettings() {
        writeJson('pps.settings', state.settings);
    }

    function applySettingsUI() {
        const map = {
            'set-notifications': 'notifications',
            'set-dnd': 'dnd',
            'set-silent': 'silent',
            'set-contacts': 'contactsOnly',
        };
        Object.keys(map).forEach((id) => {
            const element = $(id);
            if (element) element.checked = !!state.settings[map[id]];
        });
        if ($('set-status')) $('set-status').value = state.settings.status || '';
        if ($('set-invisible')) $('set-invisible').checked = !!state.settings.invisible;
        updateOwnStatus();
    }

    function applyAccent(name) {
        const allowed = ['blue', 'emerald', 'violet', 'amber'];
        const value = allowed.includes(name) ? name : 'blue';
        document.documentElement.setAttribute('data-accent', value);
        localStorage.setItem('pps.accent', value);
        document.querySelectorAll('[data-accent-choice]').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.accentChoice === value));
        });
    }

    function initSettings() {
        $('settings-btn').addEventListener('click', () => {
            applySettingsUI();
            $('settings-modal').hidden = false;
        });
        $('settings-close').addEventListener('click', () => { $('settings-modal').hidden = true; });
        $('settings-logout').addEventListener('click', () => {
            $('settings-modal').hidden = true;
            $('logout-btn').click();
        });

        document.querySelectorAll('[data-accent-choice]').forEach((button) => {
            button.addEventListener('click', () => applyAccent(button.dataset.accentChoice));
        });
        applyAccent(localStorage.getItem('pps.accent') || 'blue');

        $('set-notifications').addEventListener('change', async (event) => {
            let checked = event.target.checked;
            if (checked && 'Notification' in window && Notification.permission === 'default') {
                try {
                    checked = (await Notification.requestPermission()) === 'granted';
                } catch (e) {
                    checked = false;
                }
            }
            if (checked && (!('Notification' in window) || Notification.permission !== 'granted')) {
                checked = false;
            }
            event.target.checked = checked;
            state.settings.notifications = checked;
            saveSettings();
            if (checked) initPush();
        });

        $('set-dnd').addEventListener('change', (event) => {
            state.settings.dnd = event.target.checked;
            if (state.settings.dnd) stopAllAudio();
            saveSettings();
        });

        $('set-silent').addEventListener('change', (event) => {
            state.settings.silent = event.target.checked;
            if (state.settings.silent) stopAllAudio();
            saveSettings();
        });

        $('set-contacts').addEventListener('change', (event) => {
            state.settings.contactsOnly = event.target.checked;
            saveSettings();
        });

        $('set-status').addEventListener('change', (event) => {
            state.settings.status = event.target.value.trim().slice(0, 40);
            event.target.value = state.settings.status;
            saveSettings();
            updateOwnStatus();
            trackPresence();
        });
        $('set-status').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') event.target.blur();
        });

        $('set-invisible').addEventListener('change', (event) => {
            state.settings.invisible = event.target.checked;
            saveSettings();
            updateOwnStatus();
            updatePeerCount();
            trackPresence();
        });

        $('push-test').addEventListener('click', () => {
            if (!state.me) return;
            if (!state.settings.notifications || Notification.permission !== 'granted') {
                showToast('Сначала включи уведомления');
                return;
            }
            pushNotify(state.me.nick, 'Тест уведомления', 'message');
            showToast('Отправлено. Сверни вкладку.');
        });
    }

    function notify(title, body, tag, nick) {
        if (!state.settings.notifications || state.settings.dnd) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        if (document.visibilityState === 'visible' && document.hasFocus()) return;
        try {
            const notification = new Notification(title, {
                body,
                tag,
                icon: '../library/icon.svg',
                vibrate: [120, 60, 120],
            });
            notification.onclick = () => {
                try { window.focus(); } catch (e) { /* ignore */ }
                if (nick && state.me && nick !== state.me.nick) {
                    openChat({ nick, uid: null });
                }
                notification.close();
            };
        } catch (e) { /* ignore */ }
    }

    let pushStarted = false;
    async function initPush() {
        if (pushStarted) return;
        if (!state.me || !state.settings.notifications) return;
        if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;
        const config = window.PPS_FIREBASE;
        if (!config || !config.vapidKey) return;

        pushStarted = true;
        try {
            const registration = await navigator.serviceWorker.register('firebase-messaging-sw.js', { scope: './' });
            const appModule = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
            const messagingModule = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');
            const app = appModule.initializeApp(config);
            const messaging = messagingModule.getMessaging(app);
            const fcmToken = await messagingModule.getToken(messaging, {
                vapidKey: config.vapidKey,
                serviceWorkerRegistration: registration,
            });
            if (!fcmToken) return;

            const session = readNkseSession();
            await appsScriptCall({
                board: 'push',
                op: 'register',
                token: session.token,
                nick: state.me.nick,
                fcm: fcmToken,
            });

            messagingModule.onMessage(messaging, (payload) => {
                const data = payload.data || {};
                const title = (payload.notification && payload.notification.title) || data.title || 'pps';
                const body = (payload.notification && payload.notification.body) || data.body || '';
                notify(title, body, data.tag || 'push', data.nick || '');
            });
        } catch (e) {
            pushStarted = false;
            console.warn('push', e);
        }
    }

    function pushNotify(to, body, type) {
        if (!state.me || !to) return;
        const session = readNkseSession();
        if (!session.token) return;
        appsScriptCall({
            board: 'push',
            op: 'send',
            token: session.token,
            to,
            nick: state.me.nick,
            title: type === 'call' ? 'Входящий звонок' : 'pps · ' + state.me.nick,
            body: String(body || '').slice(0, 120),
            type: type || 'message',
            tag: (type || 'message') + '-' + state.me.nick,
        }).catch(() => {});
    }

    let toastTimer = 0;
    function showToast(text) {
        const element = $('toast');
        if (!element) return;
        element.textContent = text;
        element.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { element.hidden = true; }, 2600);
    }

    function beep(freq, duration) {
        if (state.settings.silent || state.settings.dnd) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!state.audioCtx) state.audioCtx = new Ctx();
            const ctx = state.audioCtx;
            if (ctx.state === 'suspended') ctx.resume();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.connect(gain);
            gain.connect(ctx.destination);
            const now = ctx.currentTime;
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            osc.start(now);
            osc.stop(now + duration + 0.03);
        } catch (e) { /* ignore */ }
    }

    function startRing() {
        stopRing();
        if (state.settings.dnd || state.settings.silent) return;
        const ring = () => {
            beep(760, 0.18);
            setTimeout(() => beep(560, 0.18), 220);
            if (navigator.vibrate) navigator.vibrate([300, 200, 300]);
        };
        ring();
        state.ringTimer = setInterval(ring, 1600);
    }

    function stopRing() {
        if (state.ringTimer) clearInterval(state.ringTimer);
        state.ringTimer = 0;
        if (navigator.vibrate) navigator.vibrate(0);
    }

    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator && !state.wakeLock) {
                state.wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (e) { /* ignore */ }
    }

    function releaseWakeLock() {
        if (state.wakeLock) {
            try { state.wakeLock.release().catch(() => {}); } catch (e) { /* ignore */ }
            state.wakeLock = null;
        }
    }

    function stopAllAudio() {
        stopRing();
        if (state.audioCtx) {
            try { state.audioCtx.close(); } catch (e) { /* ignore */ }
            state.audioCtx = null;
        }
    }

    function logCall(peer, media, status, duration) {
        if (!peer) return;
        const label = media === 'video' ? 'Видеозвонок' : 'Аудиозвонок';
        let text = label + ' · ' + status;
        if (duration > 0) {
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            text += ' · ' + minutes + ':' + String(seconds).padStart(2, '0');
        }
        const list = loadHistory(peer);
        list.push({
            id: newId(),
            from: 'system',
            to: peer,
            text,
            ts: serverNow(),
            kind: 'call',
        });
        saveHistory(peer, list);
        if (state.peer === peer) renderMessages();
        renderChats();
    }

    async function chatAction(action) {
        const nick = state.peer;
        if (!nick) return;
        const meta = metaFor(nick);

        if (action === 'mute') {
            meta.muted = !meta.muted;
            saveChatMeta();
            applyChatMeta(nick);
            renderChats();
        }

        if (action === 'block') {
            meta.blocked = !meta.blocked;
            saveChatMeta();
            applyChatMeta(nick);
            if (meta.blocked) state.unread.delete(nick);
            renderChats();
        }

        if (action === 'clear') {
            if (confirm('Очистить историю этого чата на этом устройстве?')) {
                saveHistory(nick, []);
                renderMessages();
                renderChats();
            }
        }

        if (action === 'delete') {
            const both = !!(state.sb && state.peerUid)
                && confirm('Удалить чат у обоих? OK — у обоих, Отмена — только у тебя.');
            if (both) {
                try {
                    const { error } = await state.sb.rpc('delete_direct_chat', { other_id: state.peerUid });
                    if (error) throw error;
                } catch (e) {
                    showToast('Не удалось удалить у обоих');
                    return;
                }
                sendUserEvent(state.peerUid, 'chat-deleted', {
                    nick,
                    chatId: state.chatId,
                }).catch(() => {});
            }

            hideChat(nick);
            removeChatLocal(nick);
        }

        $('chat-menu').hidden = true;
        $('chat-menu-btn').setAttribute('aria-expanded', 'false');
    }

    function bootChats() {
        state.chats = state.chats.filter((chat) => chat && chat.nick && chat.nick !== state.me.nick);
        writeJson(LS.chats, state.chats);
        for (const chat of state.chats) loadHistory(chat.nick);
        renderChats();
        const add = new URLSearchParams(location.search).get('add');
        if (add) openChat({ nick: add, uid: null });
    }

    function openChat(peer) {
        const target = typeof peer === 'string' ? { nick: peer, uid: null } : peer;
        if (!state.me || !target || !target.nick || target.nick === state.me.nick) return;

        if (state.peer === target.nick && !$('chat-view').hidden) {
            closeChat();
            return;
        }

        unhideChat(target.nick);
        addChat(target.nick, target.uid);
        state.peer = target.nick;
        state.peerUid = target.uid || null;
        state.unread.delete(target.nick);
        state.chatId = null;
        state.chatLastTs = '';
        applyChatMeta(target.nick);
        $('chat-view').hidden = false;
        $('empty').hidden = true;
        $('peer-nick').textContent = target.nick;
        paintAvatar($('peer-avatar'), target.nick);
        $('peer-status').textContent = presenceText(target.nick);
        $('app').classList.add('show-chat');
        $('search').value = '';
        $('search-results').hidden = true;
        loadHistory(target.nick);
        renderMessages();
        $('messages').scrollTop = $('messages').scrollHeight;
        updateScrollButton();
        renderChats();
        const view = $('chat-view');
        view.style.animation = 'none';
        void view.offsetWidth;
        view.style.animation = '';

        if (USE_SUPABASE) {
            supabaseOpenChat(target);
        } else {
            send({ type: 'history', with: target.nick });
        }
        setTimeout(() => $('text').focus(), 40);
    }

    function closeChat() {
        state.peer = null;
        state.peerUid = null;
        state.chatId = null;
        state.chatLastTs = '';
        $('chat-view').hidden = true;
        $('empty').hidden = false;
        $('app').classList.remove('show-chat');
        renderChats();
    }

    function renderChats() {
        const list = $('chat-list');
        list.replaceChildren();

        const sorted = [...state.chats].sort((a, b) => {
            const am = lastMessage(a.nick);
            const bm = lastMessage(b.nick);
            return (bm ? bm.ts : 0) - (am ? am.ts : 0);
        });

        for (const chat of sorted) {
            const nick = chat.nick;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chat-item' + (state.peer === nick ? ' is-active' : '');
            button.addEventListener('click', () => openChat(chat));

            const avatar = document.createElement('span');
            avatar.className = 'avatar';
            paintAvatar(avatar, nick);

            const meta = document.createElement('span');
            meta.className = 'meta';
            const name = document.createElement('b');
            name.textContent = nick;
            const preview = document.createElement('small');
            const last = lastMessage(nick);
            preview.textContent = last ? previewText(last.text) : (isOnline(nick) ? 'в сети' : 'нет сообщений');
            meta.append(name, preview);

            button.append(avatar, meta);

            if (metaFor(nick).muted) {
                const muted = document.createElement('span');
                muted.className = 'chat-muted';
                muted.textContent = 'выкл. звук';
                button.append(muted);
            }

            if (state.unread.get(nick)) {
                const badge = document.createElement('span');
                badge.className = 'unread-badge';
                const count = state.unread.get(nick);
                badge.textContent = count > 99 ? '99+' : String(count);
                button.append(badge);
            }

            list.append(button);
        }

        const empty = state.chats.length === 0;
        document.querySelector('.sidebar').classList.toggle('is-empty', empty);
        $('side-empty').hidden = !empty;
        updatePeerCount();
    }

    function lastMessage(nick) {
        const list = state.messages.get(nick) || [];
        return list.length ? list[list.length - 1] : null;
    }

    function renderPresence() {
        renderChats();
        if (state.peer) $('peer-status').textContent = presenceText(state.peer);
        if (!$('search-results').hidden) renderSearch();
        updatePeerCount();
    }

    function receiveMessage(message) {
        if (!message || !message.from) return;
        if (metaFor(message.from).blocked) return;
        if (state.settings.contactsOnly && !state.chats.some((chat) => chat.nick === message.from)) return;
        addChat(message.from);
        const list = loadHistory(message.from);
        if (!list.some((m) => m.id === message.id)) {
            list.push({ ...message, status: 'sent' });
            saveHistory(message.from, list.sort((a, b) => a.ts - b.ts));
        }
        if (state.peer === message.from) {
            renderMessages();
        } else {
            state.unread.set(message.from, (state.unread.get(message.from) || 0) + 1);
        }
        renderChats();
    }

    /* ------------------------------------------------------------ messages */

    function isEmojiOnly(text) {
        const value = String(text || '').trim();
        if (!value || value.length > 16) return false;
        if (/[0-9A-Za-zА-Яа-яЁё]/.test(value)) return false;
        return /\p{Extended_Pictographic}/u.test(value);
    }

    function stickerUrl(text) {
        const match = /^\[\[sticker:([^\]]+)\]\]$/.exec(String(text || '').trim());
        if (!match) return '';
        return /^https:\/\//i.test(match[1]) ? match[1] : '';
    }

    function imageUrl(text) {
        const match = /^\[\[img:([^\]]+)\]\]$/.exec(String(text || '').trim());
        if (!match) return '';
        return /^https:\/\//i.test(match[1]) ? match[1] : '';
    }

    function fileInfo(text) {
        const match = /^\[\[file:([^|\]]+)\|([^\]]*)\]\]$/.exec(String(text || '').trim());
        if (!match || !/^https:\/\//i.test(match[1])) return null;
        return { url: match[1], name: match[2] || 'Файл' };
    }

    function driveImageUrl(url) {
        const value = String(url || '');
        const match = /drive\.google\.com\/uc\?export=view&(?:amp;)?id=([^&]+)/.exec(value);
        if (match) return 'https://drive.google.com/thumbnail?id=' + match[1] + '&sz=w1600';
        return value;
    }

    function previewText(text) {
        if (stickerUrl(text)) return 'Стикер';
        if (imageUrl(text)) return 'Фото';
        if (fileInfo(text)) return 'Файл';
        return String(text || '');
    }

    function renderMessages() {
        if (!state.peer) return;
        const box = $('messages');
        const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 90;
        box.replaceChildren();
        const ordered = loadHistory(state.peer)
            .slice()
            .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
        let lastDay = '';
        for (const message of ordered) {
            if (isLocallyDeleted(state.peer, message.id)) continue;
            const day = dayLabel(message.ts);
            if (day !== lastDay) {
                lastDay = day;
                const separator = document.createElement('div');
                separator.className = 'day-sep';
                separator.textContent = day;
                box.append(separator);
            }

            if (message.kind === 'call' || message.from === 'system') {
                const callRow = document.createElement('div');
                callRow.className = 'msg call-log';
                const bubble = document.createElement('div');
                bubble.className = 'bubble';
                bubble.textContent = message.text;
                callRow.append(bubble);
                box.append(callRow);
                continue;
            }

            const own = state.me && message.from === state.me.nick;
            const row = document.createElement('div');
            row.className = 'msg' + (own ? ' own' : '');
            row.dataset.id = message.id;
            row._message = message;

            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            const image = imageUrl(message.text);
            const file = fileInfo(message.text);
            const sticker = stickerUrl(message.text);
            if (image) {
                bubble.classList.add('is-image');
                const img = document.createElement('img');
                img.src = driveImageUrl(image);
                img.alt = 'фото';
                img.loading = 'lazy';
                bubble.append(img);
            } else if (file) {
                bubble.classList.add('is-file');
                const link = document.createElement('a');
                link.className = 'msg-file';
                link.href = file.url;
                link.target = '_blank';
                link.rel = 'noopener';
                const icon = document.createElement('span');
                icon.className = 'msg-file-icon';
                icon.textContent = '📎';
                const label = document.createElement('b');
                label.textContent = file.name;
                link.append(icon, label);
                bubble.append(link);
            } else if (sticker) {
                bubble.classList.add('is-sticker');
                const img = document.createElement('img');
                img.src = driveImageUrl(sticker);
                img.alt = 'стикер';
                img.loading = 'lazy';
                bubble.append(img);
            } else {
                bubble.textContent = message.text;
                if (isEmojiOnly(message.text)) bubble.classList.add('is-emoji');
            }

            const time = document.createElement('time');
            time.textContent = fmtTime(message.ts);
            if (own && message.status === 'sending') {
                const status = document.createElement('span');
                status.className = 'status';
                status.textContent = '· отправка';
                time.append(status);
            }
            if (own && message.status === 'failed') {
                const status = document.createElement('span');
                status.className = 'status retry';
                status.dataset.retry = message.id;
                status.title = 'Нажми, чтобы отправить снова';
                status.textContent = '· не отправлено';
                time.append(status);
            }

            row.append(bubble, time);
            box.append(row);
        }
        if (stick) box.scrollTop = box.scrollHeight;
        updateScrollButton();
    }

    function updateScrollButton() {
        const box = $('messages');
        const button = $('scroll-bottom');
        if (!box || !button) return;
        const far = box.scrollHeight - box.scrollTop - box.clientHeight > 120;
        button.hidden = !far;
    }

    function sendText(raw) {
        const text = String(raw || '').trim();
        if (!text || !state.peer || metaFor(state.peer).blocked) return;

        const message = {
            id: newId(),
            from: state.me.nick,
            to: state.peer,
            text,
            ts: serverNow(),
            status: 'sending',
        };

        const list = loadHistory(state.peer);
        list.push(message);
        saveHistory(state.peer, list);
        renderMessages();
        renderChats();

        if (USE_SUPABASE) {
            supabaseSend(message);
            return;
        }

        if (!send({ type: 'message', to: state.peer, text, id: message.id })) {
            message.status = 'failed';
            saveHistory(state.peer, list);
            renderMessages();
        }
    }

    function submitMessage(event) {
        event.preventDefault();
        const input = $('text');
        sendText(input.value);
        input.value = '';
    }

    function retryMessage(message) {
        if (!message || !state.peer) return;
        message.status = 'sending';
        saveHistory(state.peer, loadHistory(state.peer));
        renderMessages();
        if (USE_SUPABASE) {
            supabaseSend(message);
            return;
        }
        if (!send({ type: 'message', to: state.peer, text: message.text, id: message.id })) {
            message.status = 'failed';
            saveHistory(state.peer, loadHistory(state.peer));
            renderMessages();
        }
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = String(reader.result || '');
                resolve(result.slice(result.indexOf(',') + 1));
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async function uploadFile(file) {
        if (!file || !state.peer) return;
        if (file.size > 8 * 1024 * 1024) {
            showToast('Файл больше 8 МБ');
            return;
        }

        let blob = file;
        let name = file.name || 'file';
        let mime = file.type || 'application/octet-stream';

        if (mime.indexOf('image/') === 0) {
            try {
                const bitmap = await createImageBitmap(file);
                const max = 1600;
                const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
                if (bitmap.close) bitmap.close();
                if (out) {
                    blob = out;
                    mime = 'image/jpeg';
                    name = name.replace(/\.[^.]+$/, '') + '.jpg';
                }
            } catch (e) { /* keep original */ }
        }

        if (blob.size > 8 * 1024 * 1024) {
            showToast('Файл слишком большой');
            return;
        }

        showToast('Загружаю…');
        try {
            const data = await blobToBase64(blob);
            const session = readNkseSession();
            const result = await appsScriptCall({
                board: 'media',
                op: 'upload',
                token: session.token,
                name,
                mime,
                data,
            });
            if (!result || !result.ok || !result.url) {
                throw new Error(result && result.error ? result.error : 'upload');
            }
            if (mime.indexOf('image/') === 0) sendText('[[img:' + (result.thumb || result.url) + ']]');
            else sendText('[[file:' + (result.view || result.url) + '|' + name.replace(/[|\]]/g, '') + ']]');
        } catch (e) {
            const code = e && e.message ? e.message : '';
            const text = code === 'no_session' ? 'Сессия истекла, войди заново'
                : code === 'too_big' ? 'Файл больше 8 МБ'
                    : code === 'unknown_action' ? 'Сервер не обновлён — переразверни Apps Script'
                        : 'Не удалось загрузить файл';
            showToast(text);
        }
    }

    function insertEmoji(emoji) {
        const input = $('text');
        const start = input.selectionStart == null ? input.value.length : input.selectionStart;
        const end = input.selectionEnd == null ? input.value.length : input.selectionEnd;
        input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
        const pos = start + emoji.length;
        input.focus();
        input.setSelectionRange(pos, pos);
    }

    function sendSticker(sticker) {
        if (/^https:\/\//i.test(sticker)) {
            sendText('[[sticker:' + sticker + ']]');
        } else {
            sendText(sticker);
        }
    }

    function openPackModal() {
        $('pack-error').hidden = true;
        $('pack-modal').hidden = false;
        setTimeout(() => $('pack-name').focus(), 30);
    }

    function saveStickerPack(name, stickers) {
        const pack = {
            id: newId(),
            name: String(name || 'Пак').trim().slice(0, 40) || 'Пак',
            stickers: stickers.slice(0, 120),
        };
        state.stickerPacks.push(pack);
        state.activePack = pack.id;
        writeJson('pps.stickerpacks', state.stickerPacks);
        $('pack-modal').hidden = true;
        $('pack-name').value = '';
        $('pack-link').value = '';
        $('pack-urls').value = '';
        emojiTab = 'sticker';
        document.querySelectorAll('[data-emoji-tab]').forEach((tab) => {
            tab.classList.toggle('is-active', tab.dataset.emojiTab === 'sticker');
        });
        renderEmojiPanel();
        $('emoji-panel').hidden = false;
        $('emoji-btn').setAttribute('aria-expanded', 'true');
    }

    async function addStickerPack() {
        const name = $('pack-name').value.trim();
        const link = $('pack-link').value.trim();
        const urls = $('pack-urls').value
            .split(/\s+/)
            .map((value) => value.trim())
            .filter((value) => /^https:\/\//i.test(value));
        const error = $('pack-error');
        error.hidden = true;

        if (link) {
            const match = link.match(/addstickers\/([^/?#]+)/i) || link.match(/^@?([A-Za-z0-9_]+)$/);
            const packName = match ? match[1] : '';
            if (!packName) {
                error.textContent = 'Не понял ссылку на пак.';
                error.hidden = false;
                return;
            }
            const session = readNkseSession();
            const button = $('pack-add');
            button.disabled = true;
            button.textContent = 'Загружаю…';
            try {
                const data = await appsScriptCall({
                    board: 'media',
                    op: 'stickerpack',
                    token: session.token,
                    name: packName,
                    limit: 16,
                });
                if (!data || !data.ok) throw new Error('failed');
                const stickers = (data.stickers || []).filter((url) => /^https:\/\//i.test(url));
                if (!stickers.length) throw new Error('empty');
                saveStickerPack(data.title || name, stickers);
            } catch (e) {
                error.textContent = 'Не удалось загрузить пак. Проверь, что сервер обновлён и в нём есть TELEGRAM_BOT_TOKEN.';
                error.hidden = false;
            } finally {
                button.disabled = false;
                button.textContent = 'Добавить пак';
            }
            return;
        }

        if (urls.length) {
            saveStickerPack(name, urls);
            return;
        }

        error.textContent = 'Вставь ссылку на пак Telegram или ссылки на картинки.';
        error.hidden = false;
    }

    function renderEmojiPanel() {
        const grid = $('emoji-grid');
        const packs = $('emoji-packs');
        if (!grid || !packs) return;

        const stickersMode = emojiTab === 'sticker';
        packs.hidden = !stickersMode;
        grid.classList.toggle('stickers', stickersMode);
        packs.replaceChildren();

        if (stickersMode) {
            for (const pack of state.stickerPacks) {
                const chip = document.createElement('span');
                chip.className = 'pack-chip' + (pack.id === state.activePack ? ' is-active' : '');
                const title = document.createElement('button');
                title.type = 'button';
                title.className = 'pack-name';
                title.textContent = pack.name;
                title.addEventListener('click', () => {
                    state.activePack = pack.id;
                    renderEmojiPanel();
                });
                chip.append(title);
                if (pack.id !== 'reactions') {
                    const remove = document.createElement('button');
                    remove.type = 'button';
                    remove.className = 'pack-del';
                    remove.textContent = '×';
                    remove.title = 'Удалить пак';
                    remove.addEventListener('click', (event) => {
                        event.stopPropagation();
                        if (!confirm('Удалить пак «' + pack.name + '»?')) return;
                        state.stickerPacks = state.stickerPacks.filter((item) => item.id !== pack.id);
                        if (state.activePack === pack.id) {
                            state.activePack = state.stickerPacks[0] ? state.stickerPacks[0].id : '';
                        }
                        writeJson('pps.stickerpacks', state.stickerPacks);
                        renderEmojiPanel();
                    });
                    chip.append(remove);
                }
                packs.append(chip);
            }
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'pack-add';
            add.textContent = '＋ Пак';
            add.addEventListener('click', openPackModal);
            packs.append(add);
        }

        grid.replaceChildren();
        const active = state.stickerPacks.find((pack) => pack.id === state.activePack);
        const list = stickersMode ? (active ? active.stickers : []) : EMOJIS;
        for (const sticker of list) {
            const button = document.createElement('button');
            button.type = 'button';
            if (stickersMode && /^https:\/\//i.test(sticker)) {
                const img = document.createElement('img');
                img.src = driveImageUrl(sticker);
                img.alt = 'стикер';
                img.loading = 'lazy';
                button.append(img);
            } else {
                button.textContent = sticker;
            }
            button.addEventListener('click', () => {
                if (stickersMode) {
                    $('emoji-panel').hidden = true;
                    $('emoji-btn').setAttribute('aria-expanded', 'false');
                    sendSticker(sticker);
                } else {
                    insertEmoji(sticker);
                }
            });
            grid.append(button);
        }
    }

    /* -------------------------------------------------------------- search */

    function onSearch() {
        clearTimeout(state.searchTimer);
        const query = $('search').value.trim();
        if (!query) {
            state.searchLoading = false;
            $('search-results').hidden = true;
            return;
        }

        const lower = query.toLowerCase();
        state.search = state.chats
            .filter((chat) => chat.nick.toLowerCase().includes(lower))
            .map((chat) => ({
                nick: chat.nick,
                uid: chat.uid,
                online: isOnline(chat.nick),
            }));
        state.searchLoading = true;
        renderSearch();

        state.searchTimer = setTimeout(() => {
            if (USE_SUPABASE) supabaseSearch(query);
            else send({ type: 'search', query });
        }, 160);
    }

    function renderSearch() {
        const box = $('search-results');
        box.replaceChildren();
        box.hidden = false;

        if (!state.search.length) {
            const empty = document.createElement('div');
            empty.className = 'search-empty';
            empty.textContent = state.searchLoading ? 'Поиск…' : 'Никто не найден';
            box.append(empty);
            return;
        }

        for (const user of state.search) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'search-result';

            const avatar = document.createElement('span');
            avatar.className = 'avatar';
            paintAvatar(avatar, user.nick);

            const name = document.createElement('b');
            name.textContent = user.nick;

            const status = document.createElement('small');
            status.textContent = user.online
                ? (state.statuses[user.nick.toLowerCase()] || 'в сети')
                : 'не в сети';

            button.append(avatar, name, status);
            button.addEventListener('click', () => openChat({ nick: user.nick, uid: user.uid }));
            box.append(button);
        }

        if (state.searchLoading) {
            const loading = document.createElement('div');
            loading.className = 'search-empty';
            loading.textContent = 'Поиск…';
            box.append(loading);
        }
    }

    /* ------------------------------------------------------------------ qr */

    function myLink() {
        if (!state.me) return '';
        return location.origin + location.pathname + '?add=' + encodeURIComponent(state.me.nick);
    }

    function openQr() {
        if (!state.me) return showAuth();
        const link = myLink();
        $('qr-link').textContent = link;
        const box = $('qr-box');
        box.replaceChildren();
        try {
            const qr = qrcode(0, 'M');
            qr.addData(link);
            qr.make();
            box.innerHTML = qr.createSvgTag(5, 4);
        } catch (e) {
            box.textContent = 'QR недоступен';
        }
        $('qr-modal').hidden = false;
    }

    function loadQrDecoder() {
        if (window.jsQR) return Promise.resolve(window.jsQR);
        if (state.scanLoading) {
            return new Promise((resolve) => {
                const started = Date.now();
                const wait = setInterval(() => {
                    if (window.jsQR) {
                        clearInterval(wait);
                        resolve(window.jsQR);
                    } else if (Date.now() - started > 12000) {
                        clearInterval(wait);
                        resolve(null);
                    }
                }, 100);
            });
        }
        state.scanLoading = true;
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'jsqr.min.js?v=7';
            script.onload = () => {
                state.scanLoading = false;
                resolve(window.jsQR || null);
            };
            script.onerror = () => {
                state.scanLoading = false;
                resolve(null);
            };
            document.head.append(script);
        });
    }

    function scanHint(text) {
        const el = $('scan-hint');
        if (el) el.textContent = text;
    }

    function stopScanLoop() {
        clearTimeout(state.scanTimer);
        state.scanTimer = 0;
    }

    function stopScan() {
        stopScanLoop();
        if (state.scanStream) {
            state.scanStream.getTracks().forEach((track) => track.stop());
            state.scanStream = null;
        }
        const video = $('scan-video');
        if (video) video.srcObject = null;
    }

    function closeScanner() {
        stopScan();
        $('scan-modal').hidden = true;
    }

    function parseQrNick(text) {
        const raw = String(text || '').trim();
        if (!raw) return '';
        try {
            const url = new URL(raw, location.origin);
            const add = url.searchParams.get('add');
            if (add) return add.trim();
        } catch (e) { /* not a url */ }
        return /^[A-Za-zА-Яа-яЁё0-9_-]{3,20}$/.test(raw) ? raw : '';
    }

    function handleScanResult(text) {
        if ($('scan-modal').hidden) return;
        closeScanner();
        const nick = parseQrNick(text);
        if (!nick) {
            showToast('Это не QR мессенджера');
            return;
        }
        openChat({ nick, uid: null });
    }

    async function decodeQr(source, width, height, invert) {
        if (state.scanDetector) {
            try {
                const codes = await state.scanDetector.detect(source);
                if (codes && codes.length) return codes[0].rawValue;
            } catch (e) { /* fall back to jsQR */ }
        }
        const jsQR = await loadQrDecoder();
        if (!jsQR) return '';
        const canvas = state.scanCanvas || (state.scanCanvas = document.createElement('canvas'));
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(source, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height);
        const code = jsQR(data.data, width, height, {
            inversionAttempts: invert ? 'attemptBoth' : 'dontInvert',
        });
        return code ? code.data : '';
    }

    function startScanLoop() {
        stopScanLoop();
        const tick = async () => {
            if (!state.scanStream) return;
            const video = $('scan-video');
            if (video && video.readyState >= 2 && video.videoWidth) {
                try {
                    const text = await decodeQr(video, video.videoWidth, video.videoHeight, false);
                    if (text) {
                        handleScanResult(text);
                        return;
                    }
                } catch (e) { /* keep scanning */ }
            }
            if (!state.scanStream) return;
            state.scanTimer = setTimeout(tick, 240);
        };
        state.scanTimer = setTimeout(tick, 250);
    }

    async function openScanner() {
        if (!state.me) return showAuth();
        $('qr-modal').hidden = true;
        $('scan-modal').hidden = false;
        $('scan-file').value = '';
        scanHint('Запрашиваю камеру…');
        if ('BarcodeDetector' in window) {
            try {
                state.scanDetector = new BarcodeDetector({ formats: ['qr_code'] });
            } catch (e) {
                state.scanDetector = null;
            }
        }
        try {
            state.scanStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
                audio: false,
            });
            const video = $('scan-video');
            video.srcObject = state.scanStream;
            await video.play();
            scanHint('Наведи камеру на QR-код');
            startScanLoop();
        } catch (e) {
            scanHint('Нет доступа к камере. Можно выбрать фото.');
        }
    }

    async function scanFromFile(file) {
        if (!file) return;
        scanHint('Читаю QR…');
        try {
            const bitmap = await createImageBitmap(file);
            const text = await decodeQr(bitmap, bitmap.width, bitmap.height, true);
            if (bitmap.close) bitmap.close();
            if (text) handleScanResult(text);
            else scanHint('QR не найден на фото');
        } catch (e) {
            scanHint('Не удалось прочитать фото');
        }
    }

    /* --------------------------------------------------------------- calls */

    const ICE = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject',
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject',
            },
            {
                urls: 'turns:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject',
            },
        ],
        iceCandidatePoolSize: 10,
    };

    function setCallStatus(text) {
        $('call-status').textContent = text;
    }

    function showCall(peer, media, incoming) {
        call.peer = peer;
        call.media = media;
        call.incoming = incoming || null;
        call.active = false;
        call.videoUnavailable = false;
        state.callStartedAt = 0;
        $('video-note').hidden = true;
        $('call-nick').textContent = peer;
        paintAvatar($('call-avatar'), peer);
        $('call-modal').hidden = false;
        requestWakeLock();
        $('videos').classList.toggle('on', media === 'video');
        $('call-accept').hidden = !incoming;
        $('call-reject').hidden = !incoming;
        $('call-hangup').hidden = !!incoming;
        $('call-mute').hidden = !!incoming;
        $('call-mute').textContent = 'Микрофон';
        $('call-camera').hidden = media !== 'video' || !!incoming;
        $('call-camera').textContent = 'Камера';
        $('call-volume-wrap').hidden = !!incoming;
        $('call-volume').value = 100;
        $('remote-audio').volume = 1;
        $('remote-audio').muted = false;
        $('remote-audio').play().catch(() => {});
        setCallStatus(incoming ? 'входящий звонок' : 'звоним…');

        if (incoming) {
            startRing();
            notify('Входящий звонок', peer, 'call-' + peer, peer);
            clearTimeout(state.callTimeout);
            state.callTimeout = setTimeout(() => {
                if (call.incoming && !call.active) {
                    setCallStatus('пропущен');
                    cleanupCall('пропущен');
                }
            }, 30000);
        }
    }

    async function mediaFor(media) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Браузер не поддерживает звонки');
        }

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                video: media === 'video',
            });
        } catch (error) {
            if (media !== 'video') throw error;
            /* Камеры нет или доступ к ней запрещён — продолжаем аудиозвонком. */
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                video: false,
            });
            call.videoUnavailable = true;
        }

        call.local = stream;
        $('local-video').srcObject = stream;
        const noVideo = media === 'video' && stream.getVideoTracks().length === 0;
        $('video-note').hidden = !noVideo;
        if (noVideo) $('video-note').textContent = 'Камера недоступна — только звук';
        return stream;
    }

    function createPc() {
        const pc = new RTCPeerConnection(ICE);
        call.pc = pc;
        call.candidates = [];

        pc.onicecandidate = (event) => {
            if (event.candidate) signal({ kind: 'ice', candidate: event.candidate });
        };
        pc.ontrack = (event) => {
            const stream = event.streams[0] || new MediaStream([event.track]);
            $('remote-video').srcObject = stream;
            const audio = $('remote-audio');
            audio.srcObject = stream;
            audio.play().catch(() => {});
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                state.callStartedAt = Date.now();
                clearTimeout(state.callTimeout);
                setCallStatus('в звонке');
            }
            if (pc.connectionState === 'disconnected') {
                setCallStatus('связь нестабильна…');
            }
            if (pc.connectionState === 'failed') {
                setCallStatus('связь потеряна');
                const peer = call.peer;
                setTimeout(() => {
                    if (call.peer === peer) cleanupCall('связь потеряна');
                }, 800);
            }
        };
        return pc;
    }

    function signal(data) {
        if (!call.peer) return;
        if (USE_SUPABASE) {
            supabaseSignal(data);
            return;
        }
        send({ type: 'signal', to: call.peer, data });
    }

    function sendSignalReject(from, fromUid) {
        if (USE_SUPABASE) {
            if (fromUid && state.sb) {
                sendSignalTo(fromUid, { kind: 'reject' }).catch(() => {});
            }
            return;
        }
        send({ type: 'signal', to: from, data: { kind: 'reject' } });
    }

    async function startCall(media) {
        if (!state.peer || call.active || !state.me) return;
        showCall(state.peer, media, null);
        call.active = true;
        try {
            await mediaFor(media);
            const pc = createPc();
            for (const track of call.local.getTracks()) pc.addTrack(track, call.local);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            signal({ kind: 'offer', media, sdp: pc.localDescription.sdp });
            pushNotify(call.peer, 'Входящий звонок', 'call');
            setCallStatus('ждём ответа…');
            clearTimeout(state.callTimeout);
            state.callTimeout = setTimeout(() => {
                if (call.active && !state.callStartedAt) {
                    setCallStatus('нет ответа');
                    cleanupCall('пропущен');
                }
            }, 30000);
        } catch (e) {
            setCallStatus(e.message || 'нет доступа к камере/микрофону');
            setTimeout(() => cleanupCall('не удалось'), 1200);
        }
    }

    async function acceptCall() {
        if (!call.incoming) return;
        call.active = true;
        clearTimeout(state.callTimeout);
        stopRing();
        $('call-accept').hidden = true;
        $('call-reject').hidden = true;
        $('call-hangup').hidden = false;
        $('call-mute').hidden = false;
        $('call-camera').hidden = call.media !== 'video';
        $('call-volume-wrap').hidden = false;
        setCallStatus('подключаемся…');

        try {
            await mediaFor(call.media);
            const pc = createPc();
            for (const track of call.local.getTracks()) pc.addTrack(track, call.local);
            await pc.setRemoteDescription({ type: 'offer', sdp: call.incoming.sdp });
            for (const candidate of call.incoming.candidates || []) {
                try { await pc.addIceCandidate(candidate); } catch (e) { /* ignore */ }
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signal({ kind: 'answer', sdp: pc.localDescription.sdp });
            setCallStatus('в звонке');
        } catch (e) {
            setCallStatus(e.message || 'не удалось принять звонок');
            setTimeout(() => cleanupCall('не удалось'), 1200);
        }
    }

    function rejectCall() {
        if (call.incoming) signal({ kind: 'reject' });
        stopRing();
        cleanupCall('отклонён');
    }

    function endCall() {
        if (call.pc) signal({ kind: 'end' });
        cleanupCall('завершён');
    }

    function cleanupCall(reason) {
        const peer = call.peer;
        const media = call.media;
        const duration = state.callStartedAt
            ? Math.round((Date.now() - state.callStartedAt) / 1000)
            : 0;

        clearTimeout(state.callTimeout);
        state.callTimeout = 0;
        stopRing();
        releaseWakeLock();

        $('call-modal').hidden = true;
        $('video-note').hidden = true;

        if (peer) {
            addChat(peer, state.peerUid);
            try {
                logCall(peer, media, reason || 'завершён', duration);
            } catch (e) { /* history must never block cleanup */ }
            showToast(
                reason === 'отклонён' ? 'Звонок отклонён'
                    : reason === 'пропущен' ? 'Пропущенный звонок'
                        : reason === 'связь потеряна' ? 'Связь потеряна'
                            : reason === 'не удалось' ? 'Не удалось соединиться'
                                : 'Звонок завершён'
            );
        }

        if (call.local) for (const track of call.local.getTracks()) track.stop();
        if (call.pc) {
            try { call.pc.close(); } catch (e) { /* ignore */ }
        }
        call.pc = null;
        call.local = null;
        call.peer = null;
        call.media = 'audio';
        call.incoming = null;
        call.candidates = [];
        call.active = false;
        state.callStartedAt = 0;
        state.pendingCall = null;
        $('local-video').srcObject = null;
        $('remote-video').srcObject = null;
        const remoteAudio = $('remote-audio');
        remoteAudio.pause();
        remoteAudio.srcObject = null;
    }

    async function handleSignal(from, data, fromUid, sid) {
        if (!data || !from) return;
        if (sid) {
            if (state.seenSignals.has(sid)) return;
            state.seenSignals.add(sid);
            if (state.seenSignals.size > 500) {
                state.seenSignals.clear();
                state.seenSignals.add(sid);
            }
        }

        if (data.kind === 'offer') {
            if (call.active) {
                sendSignalReject(from, fromUid);
                return;
            }
            state.peerUid = fromUid || state.peerUid;
            addChat(from, fromUid);
            state.pendingCall = { from, sdp: data.sdp, media: data.media || 'audio', candidates: [] };
            call.peer = from;
            call.media = data.media || 'audio';
            showCall(from, call.media, state.pendingCall);
            return;
        }

        if (data.kind === 'answer') {
            if (call.pc && call.pc.signalingState !== 'stable') {
                await call.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
                for (const candidate of call.candidates.splice(0)) {
                    try { await call.pc.addIceCandidate(candidate); } catch (e) { /* ignore */ }
                }
                setCallStatus('в звонке');
            }
            return;
        }

        if (data.kind === 'ice') {
            if (call.pc && call.pc.remoteDescription) {
                try { await call.pc.addIceCandidate(data.candidate); } catch (e) { /* ignore */ }
            } else if (state.pendingCall && state.pendingCall.from === from) {
                state.pendingCall.candidates.push(data.candidate);
            }
            return;
        }

        if (data.kind === 'end' || data.kind === 'reject') {
            if (call.peer === from) {
                cleanupCall(data.kind === 'reject' ? 'отклонён' : 'завершён');
            }
        }
    }

    /* --------------------------------------------------------------- events */

    function wire() {
        $('theme-btn').addEventListener('click', () => {
            const root = document.documentElement;
            const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            root.setAttribute('data-theme', next);
            localStorage.setItem(LS.theme, next);
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', next === 'light' ? '#e9e5dd' : '#08080a');
        });

        $('fullscreen-btn').addEventListener('click', () => {
            const app = $('app');
            const on = !app.classList.contains('is-fullscreen');
            app.classList.toggle('is-fullscreen', on);
            document.body.classList.toggle('is-fullscreen', on);
            if (on && document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else if (!on && document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
        });

        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                $('app').classList.remove('is-fullscreen');
                document.body.classList.remove('is-fullscreen');
            }
        });

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                const data = event.data || {};
                if (data.type === 'pps-open' && data.nick) {
                    openChat({ nick: data.nick, uid: null });
                }
            });
        }

        $('qr-btn').addEventListener('click', openQr);
        $('empty-qr').addEventListener('click', openQr);
        $('empty-scan').addEventListener('click', openScanner);
        $('empty-search').addEventListener('click', () => {
            $('search').focus();
            $('search').select();
        });
        $('side-empty-search').addEventListener('click', () => {
            $('search').focus();
            $('search').select();
        });
        $('side-empty-scan').addEventListener('click', openScanner);
        $('qr-close').addEventListener('click', () => { $('qr-modal').hidden = true; });
        $('qr-copy').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(myLink());
                $('qr-copy').textContent = 'Скопировано';
                setTimeout(() => { $('qr-copy').textContent = 'Скопировать ссылку'; }, 1200);
            } catch (e) {
                $('qr-link').textContent = myLink();
            }
        });
        $('qr-scan').addEventListener('click', openScanner);
        $('scan-close').addEventListener('click', closeScanner);
        $('scan-modal').addEventListener('click', (event) => {
            if (event.target === $('scan-modal')) closeScanner();
        });
        $('scan-file').addEventListener('change', (event) => scanFromFile(event.target.files[0]));

        document.querySelectorAll('.tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                state.authMode = tab.dataset.mode;
                document.querySelectorAll('.tab').forEach((t) => {
                    const active = t === tab;
                    t.classList.toggle('is-active', active);
                    t.setAttribute('aria-selected', String(active));
                });
                $('auth-submit').textContent = state.authMode === 'login' ? 'Войти' : 'Создать аккаунт';
                $('auth-title').textContent = state.authMode === 'login' ? 'Вход' : 'Регистрация';
                const registering = state.authMode === 'register';
                $('auth-confirm-field').hidden = !registering;
                $('auth-confirm').required = registering;
                $('auth-pass').autocomplete = registering ? 'new-password' : 'current-password';
            });
        });

        document.querySelectorAll('.pass-eye').forEach((button) => {
            button.addEventListener('click', () => {
                const input = $(button.dataset.eye);
                if (!input) return;
                const show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                button.classList.toggle('is-on', show);
                button.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
            });
        });

        $('auth-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const nick = $('auth-nick').value.trim();
            const password = $('auth-pass').value;
            $('auth-error').hidden = true;

            if (state.authMode === 'register') {
                if (password.length < 6) {
                    $('auth-error').textContent = 'Пароль должен быть от 6 символов.';
                    $('auth-error').hidden = false;
                    return;
                }
                if (password !== $('auth-confirm').value) {
                    $('auth-error').textContent = 'Пароли не совпадают.';
                    $('auth-error').hidden = false;
                    return;
                }
            }

            $('auth-submit').disabled = true;

            if (USE_SUPABASE) {
                supabaseAuth(state.authMode, nick, password).finally(() => {
                    setTimeout(() => { $('auth-submit').disabled = false; }, 400);
                });
                return;
            }

            if (!send({ type: state.authMode, nick, password })) {
                $('auth-error').textContent = 'Нет соединения с сервером.';
                $('auth-error').hidden = false;
            }
            setTimeout(() => { $('auth-submit').disabled = false; }, 600);
        });

        $('logout-btn').addEventListener('click', () => {
            if (USE_SUPABASE) {
                supabaseLogout();
                return;
            }
            localStorage.removeItem(LS.token);
            localStorage.removeItem(LS.user);
            state.token = '';
            state.me = null;
            state.peer = null;
            state.chats = [];
            state.messages.clear();
            $('me-bar').hidden = true;
            $('logout-btn').hidden = true;
            $('search').disabled = true;
            $('chat-view').hidden = true;
            $('empty').hidden = false;
            $('chat-list').replaceChildren();
            $('search').value = '';
            $('search-results').hidden = true;
            if (state.ws) state.ws.close();
            setTimeout(connect, 200);
            showAuth('Вы вышли.');
        });

        $('search').addEventListener('input', onSearch);
        $('search').addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                $('search').value = '';
                $('search-results').hidden = true;
            }
            if (event.key === 'Enter' && state.search.length) openChat(state.search[0].nick);
        });

        $('composer').addEventListener('submit', submitMessage);
        $('file-btn').addEventListener('click', () => $('file-input').click());
        $('file-input').addEventListener('change', (event) => {
            const file = event.target.files[0];
            event.target.value = '';
            uploadFile(file);
        });
        $('emoji-btn').addEventListener('click', (event) => {
            event.stopPropagation();
            const panel = $('emoji-panel');
            const open = panel.hidden;
            if (open) renderEmojiPanel();
            panel.hidden = !open;
            $('emoji-btn').setAttribute('aria-expanded', String(open));
        });
        $('emoji-panel').addEventListener('click', (event) => event.stopPropagation());
        document.querySelectorAll('[data-emoji-tab]').forEach((button) => {
            button.addEventListener('click', () => {
                emojiTab = button.dataset.emojiTab;
                document.querySelectorAll('[data-emoji-tab]').forEach((tab) => {
                    tab.classList.toggle('is-active', tab === button);
                });
                renderEmojiPanel();
            });
        });
        $('pack-add').addEventListener('click', addStickerPack);
        $('pack-close').addEventListener('click', () => { $('pack-modal').hidden = true; });
        $('pack-modal').addEventListener('click', (event) => {
            if (event.target === $('pack-modal')) $('pack-modal').hidden = true;
        });
        $('back-btn').addEventListener('click', closeChat);
        $('messages').addEventListener('scroll', updateScrollButton);
        $('messages').addEventListener('click', (event) => {
            const status = event.target.closest('.status.retry');
            if (!status) return;
            const id = status.dataset.retry;
            const message = loadHistory(state.peer).find((item) => item.id === id);
            if (message) retryMessage(message);
        });
        $('scroll-bottom').addEventListener('click', () => {
            $('messages').scrollTop = $('messages').scrollHeight;
            updateScrollButton();
        });

        $('messages').addEventListener('contextmenu', (event) => {
            const row = event.target.closest('.msg');
            if (row && row._message) showMessageMenu(event, row._message);
        });

        let pressTimer = 0;
        $('messages').addEventListener('touchstart', (event) => {
            const row = event.target.closest('.msg');
            if (!row || !row._message) return;
            const touch = event.touches[0];
            pressTimer = setTimeout(() => {
                showMessageMenu({
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    preventDefault() {},
                }, row._message);
            }, 500);
        }, { passive: true });
        ['touchend', 'touchmove', 'touchcancel'].forEach((name) => {
            $('messages').addEventListener(name, () => clearTimeout(pressTimer), { passive: true });
        });

        $('message-menu').addEventListener('click', (event) => {
            event.stopPropagation();
            const button = event.target.closest('[data-msg-action]');
            if (!button) return;
            const action = button.dataset.msgAction;
            const message = state.contextMessage;
            if (!message) return;

            if (action === 'copy') {
                navigator.clipboard.writeText(message.text).then(() => showToast('Скопировано')).catch(() => {});
                $('message-menu').hidden = true;
                state.contextMessage = null;
            } else if (action === 'delete-self') {
                deleteContextMessage(false);
            } else if (action === 'delete-all') {
                deleteContextMessage(true);
            }
        });

        document.addEventListener('keydown', (event) => {
            const tag = document.activeElement && document.activeElement.tagName;
            const typing = tag === 'INPUT' || tag === 'TEXTAREA';
            if (event.key === '/' && !typing) {
                event.preventDefault();
                $('search').focus();
            }
            if (event.key === 'Escape') {
                if (!$('scan-modal').hidden) closeScanner();
                else if (!$('settings-modal').hidden) $('settings-modal').hidden = true;
                else if (!$('qr-modal').hidden) $('qr-modal').hidden = true;
                else if (!$('pack-modal').hidden) $('pack-modal').hidden = true;
                else if (!$('emoji-panel').hidden) {
                    $('emoji-panel').hidden = true;
                    $('emoji-btn').setAttribute('aria-expanded', 'false');
                }
                else if (!$('chat-menu').hidden) $('chat-menu').hidden = true;
                else if (state.peer && window.matchMedia('(max-width: 760px)').matches) closeChat();
            }
        });

        $('chat-menu-btn').addEventListener('click', (event) => {
            event.stopPropagation();
            if (!state.peer) return;
            const menu = $('chat-menu');
            const willOpen = menu.hidden;
            if (willOpen) applyChatMeta(state.peer);
            menu.hidden = !willOpen;
            $('chat-menu-btn').setAttribute('aria-expanded', String(willOpen));
        });

        $('chat-menu').addEventListener('click', (event) => {
            const button = event.target.closest('[data-action]');
            if (!button) return;
            event.stopPropagation();
            chatAction(button.dataset.action);
        });

        document.addEventListener('click', () => {
            $('chat-menu').hidden = true;
            $('chat-menu-btn').setAttribute('aria-expanded', 'false');
            $('message-menu').hidden = true;
            $('emoji-panel').hidden = true;
            $('emoji-btn').setAttribute('aria-expanded', 'false');
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                supabaseSyncChat();
                supabaseSyncAllChats();
            }
        });
        window.addEventListener('online', () => {
            supabaseSyncChat();
            supabaseSyncAllChats();
        });

        $('audio-call').addEventListener('click', () => startCall('audio'));
        $('video-call').addEventListener('click', () => startCall('video'));
        $('call-accept').addEventListener('click', acceptCall);
        $('call-reject').addEventListener('click', rejectCall);
        $('call-hangup').addEventListener('click', endCall);
        $('call-mute').addEventListener('click', () => {
            if (!call.local) return;
            const audio = call.local.getAudioTracks()[0];
            if (!audio) return;
            audio.enabled = !audio.enabled;
            $('call-mute').textContent = audio.enabled ? 'Микрофон' : 'Включить микрофон';
        });

        $('call-camera').addEventListener('click', () => {
            if (!call.local) return;
            const video = call.local.getVideoTracks()[0];
            if (!video) {
                showToast('Камера недоступна');
                return;
            }
            video.enabled = !video.enabled;
            $('call-camera').textContent = video.enabled ? 'Камера' : 'Включить камеру';
        });

        $('call-volume').addEventListener('input', (event) => {
            const value = Number(event.target.value) / 100;
            $('remote-audio').volume = value;
            $('remote-audio').muted = value === 0;
        });

        window.addEventListener('beforeunload', () => {
            if (call.active) signal({ kind: 'end' });
        });

        initSettings();
    }

    /* ------------------------------------------------------------- supabase */

    function loadSupabaseSdk() {
        if (window.PPS && window.PPS.createClient) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'supabase.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('supabase sdk failed'));
            document.head.appendChild(script);
        });
    }

    function readNkseSession() {
        const raw = localStorage.getItem('nkse-session');
        if (!raw) return { token: '', user: null };
        try {
            const data = JSON.parse(raw);
            if (data && data.t) return { token: data.t, user: data.u || null };
        } catch (e) { /* old raw-token format */ }
        return { token: raw, user: null };
    }

    function writeNkseSession(token, user) {
        try {
            localStorage.setItem('nkse-session', JSON.stringify({ t: token, u: user }));
        } catch (e) { /* private mode */ }
    }

    function decodeJwt(token) {
        try {
            const part = String(token).split('.')[1];
            const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
            const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
            const binary = atob(padded);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return JSON.parse(new TextDecoder('utf-8').decode(bytes));
        } catch (e) {
            return {};
        }
    }

    async function appsScriptCall(payload) {
        const endpoint = window.PPS_AUTH_API;
        if (!endpoint) throw new Error('auth endpoint is not configured');
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            redirect: 'follow',
        });
        if (!response.ok) throw new Error('auth http ' + response.status);
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error('Apps Script вернул не JSON. Проверь доступ Web App: «Все».');
        }
    }

    async function supabaseAuth(mode, nick, password) {
        try {
            const data = await appsScriptCall({ board: 'auth', op: mode, nick, pass: password });
            if (!data || !data.ok) {
                showAuth(authError(data && data.error));
                return;
            }
            writeNkseSession(data.token, data.user);
            await exchangeSession(data.token);
        } catch (e) {
            console.warn(e);
            const detail = e && e.message ? e.message : '';
            showAuth(detail ? 'Ошибка входа: ' + detail : 'Не удалось связаться с сервером регистрации.');
        }
    }

    async function exchangeSession(token) {
        const data = await appsScriptCall({ board: 'auth', op: 'supabase', token });
        if (!data || !data.ok || !data.token) {
            throw new Error((data && data.error) || 'supabase token missing');
        }
        const payload = decodeJwt(data.token);
        const uid = payload.sub || (data.user && data.user.uid);
        const nick = (data.user && data.user.nick) || payload.nick;
        if (!uid || !nick) throw new Error('invalid supabase token');
        await initSupabase(data.token, { uid, nick });
    }

    async function bootSupabase() {
        if (isLocal) {
            const testJwt = localStorage.getItem('pps.test.jwt');
            if (testJwt) {
                const payload = decodeJwt(testJwt);
                if (payload.sub && payload.nick) {
                    await initSupabase(testJwt, { uid: payload.sub, nick: payload.nick });
                    return;
                }
            }
        }

        const session = readNkseSession();
        const cachedUser = readJson(LS.user, null);
        if (cachedUser) {
            setMe(cachedUser);
            hideAuth();
            for (const chat of state.chats) loadHistory(chat.nick);
            renderChats();
            $('settings-status').textContent = 'подключение…';
        }
        if (session.token) {
            hideAuth();
            $('me-status').textContent = 'подключение…';
            try {
                await exchangeSession(session.token);
                return;
            } catch (e) {
                console.warn(e);
            }
        }
        showAuth();
    }

    async function initSupabase(jwt, user) {
        state.sbJwt = jwt;
        state.sbUid = user.uid;

        const client = window.PPS.createClient(SUPABASE.url, SUPABASE.key, {
            global: { headers: { Authorization: 'Bearer ' + jwt } },
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        state.sb = client;
        client.realtime.setAuth(jwt);

        setMe({ nick: user.nick, uid: user.uid });
        hideAuth();
        setConn(true);
        for (const chat of state.chats) loadHistory(chat.nick);
        renderChats();

        /* These must not delay the first paint. */
        syncServerClock().catch(() => {});
        client.from('profiles').upsert(
            { id: user.uid, nick: user.nick, last_seen: new Date().toISOString() },
            { onConflict: 'id' }
        ).then(({ error }) => {
            if (error) console.warn('profile upsert', error);
        });

        subscribePresence();
        subscribeSignals();
        startSignalPoll();
        startAllChatSync();
        if (state.settings.notifications) initPush();

        const add = new URLSearchParams(location.search).get('add');
        if (add) openChat({ nick: add, uid: null });
    }

    async function syncServerClock() {
        try {
            const now = await fetch(SUPABASE.url + '/rest/v1/', {
                method: 'HEAD',
                headers: { apikey: SUPABASE.key },
            });
            const date = now.headers.get('date');
            if (date) state.clockOffset = new Date(date).getTime() - Date.now();
        } catch (e) { /* keep local clock */ }
    }

    function subscribePresence() {
        if (!state.sb) return;
        const channel = state.sb.channel('pps-online', {
            config: { presence: { key: state.sbUid } },
        });

        channel.on('presence', { event: 'sync' }, () => {
            const snapshot = channel.presenceState();
            const next = new Set();
            const statuses = {};
            Object.keys(snapshot).forEach((key) => {
                for (const entry of snapshot[key] || []) {
                    if (!entry || !entry.nick || entry.uid === state.sbUid || entry.invisible) continue;
                    const nick = String(entry.nick).toLowerCase();
                    next.add(nick);
                    if (entry.status) statuses[nick] = String(entry.status).slice(0, 40);
                }
            });
            state.online = next;
            state.statuses = statuses;
            renderPresence();
        });

        channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') trackPresence();
        });

        state.presenceChannel = channel;

        if (!state.presenceHooked) {
            state.presenceHooked = true;
            const retrack = () => {
                if (document.visibilityState !== 'visible') return;
                trackPresence();
            };
            document.addEventListener('visibilitychange', retrack);
            window.addEventListener('focus', retrack);
        }
    }

    function subscribeSignals() {
        if (!state.sb) return;
        state.signalChannel = state.sb
            .channel('user-' + state.sbUid, { config: { broadcast: { self: false } } })
            .on('broadcast', { event: 'signal' }, ({ payload }) => {
                if (!payload || !payload.data) return;
                handleSignal(payload.fromNick || payload.fromUid, payload.data, payload.fromUid, payload.sid);
            })
            .on('broadcast', { event: 'message' }, ({ payload }) => {
                if (!payload || !payload.row || !payload.fromUid) return;
                if (state.settings.contactsOnly && !state.chats.some((item) => item.nick === payload.fromNick)) return;
                addChat(payload.fromNick, payload.fromUid);
                const chat = state.chats.find((item) => item.nick === payload.fromNick);
                if (chat) {
                    if (payload.chatId) chat.chatId = payload.chatId;
                    if (payload.row.created_at) chat.lastTs = payload.row.created_at;
                }
                handleIncomingRow(payload.row, payload.fromNick);
            })
            .on('broadcast', { event: 'message-deleted' }, ({ payload }) => {
                handleDeleted(payload);
            })
            .on('broadcast', { event: 'chat-deleted' }, ({ payload }) => {
                handleChatDeleted(payload);
            })
            .subscribe();
    }

    async function nickForUid(uid) {
        const known = state.chats.find((chat) => chat.uid === uid);
        if (known) return known.nick;
        const { data } = await state.sb.from('profiles').select('nick').eq('id', uid).maybeSingle();
        if (data && data.nick) {
            addChat(data.nick, uid);
            return data.nick;
        }
        return uid;
    }

    async function uidForNick(nick) {
        const key = String(nick || '').toLowerCase();
        const known = state.chats.find((chat) => chat.nick.toLowerCase() === key && chat.uid);
        if (known) return known.uid;
        const { data } = await state.sb.from('profiles').select('id').ilike('nick', nick).maybeSingle();
        if (data && data.id) {
            const chat = state.chats.find((item) => item.nick.toLowerCase() === key);
            if (chat) chat.uid = data.id;
            return data.id;
        }
        return '';
    }

    async function supabaseSearch(query) {
        if (!state.sb) return;
        const { data, error } = await state.sb
            .from('profiles')
            .select('id,nick,last_seen')
            .ilike('nick', '%' + query + '%')
            .limit(20);
        if (error) {
            console.warn(error);
            state.search = [];
            state.searchLoading = false;
            renderSearch();
            return;
        }
        state.searchLoading = false;
        state.search = (data || [])
            .filter((user) => user.id !== state.sbUid)
            .map((user) => ({
                nick: user.nick,
                uid: user.id,
                online: state.online.has(user.nick.toLowerCase()),
            }));
        renderSearch();
    }

    async function supabaseOpenChat(peer) {
        if (!state.sb) return;        try {
            let uid = peer.uid;
            if (!uid) {
                const { data } = await state.sb.from('profiles').select('id').eq('nick', peer.nick).maybeSingle();
                if (!data) {
                    $('peer-status').textContent = 'ник не найден';
                    return;
                }
                uid = data.id;
                peer.uid = uid;
                state.peerUid = uid;
                addChat(peer.nick, uid);
            }

            const { data: chatId, error } = await state.sb.rpc('create_direct_chat', { other_id: uid });
            if (error) {
                console.warn('create_direct_chat', error);
                $('peer-status').textContent = 'не удалось открыть чат';
                return;
            }

            state.chatId = chatId;
            const chatRecord = state.chats.find((item) => item.nick === peer.nick);
            if (chatRecord) chatRecord.chatId = chatId;
            const { data: rows, error: loadError } = await state.sb
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .order('created_at', { ascending: true })
                .limit(200);
            if (loadError) console.warn('messages', loadError);

            const mapped = (rows || []).map((row) => rowToMessage(row, peer.nick));
            state.chatLastTs = rows && rows.length
                ? rows[rows.length - 1].created_at
                : new Date(0).toISOString();
            if (chatRecord && state.chatLastTs) chatRecord.lastTs = state.chatLastTs;
            const local = loadHistory(peer.nick);
            const dbIds = new Set((rows || []).map((row) => row.id));
            const keep = local.filter((message) => {
                if (message.status === 'sending' || message.status === 'failed') return true;
                if (!message.dbId) return true;
                return dbIds.has(message.dbId);
            });
            saveHistory(peer.nick, mergeMessages(keep, mapped));
            renderMessages();
            renderChats();
            subscribeChat(chatId, peer.nick);
            startChatSync();
        } catch (e) {
            console.warn(e);
            $('peer-status').textContent = 'ошибка чата';
        }
    }

    window.__ppsOpenChat = supabaseOpenChat;

    function subscribeChat(chatId, peerNick) {
        if (!state.sb) return;
        if (state.chatChannel) {
            try { state.sb.removeChannel(state.chatChannel); } catch (e) { /* ignore */ }
        }

        state.chatChannel = state.sb
            .channel('chat-' + chatId, { config: { broadcast: { self: false } } })
            .on('broadcast', { event: 'message' }, ({ payload }) => {
                if (payload) handleIncomingRow(payload, peerNick);
            })
            .on('broadcast', { event: 'message-deleted' }, ({ payload }) => {
                handleDeleted(payload);
            })
            .on('broadcast', { event: 'chat-deleted' }, ({ payload }) => {
                handleChatDeleted(payload);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') supabaseSyncChat();
            });
    }

    function startChatSync() {
        clearInterval(state.syncTimer);
        state.syncTimer = setInterval(supabaseSyncChat, 1000);
    }

    async function supabaseSyncChat() {
        if (state.syncBusy) return;
        if (!state.sb || !state.chatId || !state.peer || !state.chatLastTs) return;

        const chatId = state.chatId;
        const peer = state.peer;
        const since = state.chatLastTs;

        state.syncBusy = true;
        try {
            const { data, error } = await state.sb
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .gt('created_at', since)
                .order('created_at', { ascending: true })
                .limit(100);

            if (!error && data && state.chatId === chatId && state.peer === peer) {
                for (const row of data) {
                    handleIncomingRow(row, peer);
                }
            }
        } catch (e) {
            /* transient network; next tick retries */
        } finally {
            state.syncBusy = false;
        }
    }

    async function discoverChats() {
        if (!state.sb || !state.sbUid) return;
        const { data, error } = await state.sb
            .from('chat_members')
            .select('chat_id')
            .eq('user_id', state.sbUid);
        if (error || !data) return;

        const memberIds = new Set(data.map((row) => row.chat_id));
        for (const chat of [...state.chats]) {
            if (chat.chatId && !memberIds.has(chat.chatId)) {
                removeChatLocal(chat.nick);
            }
        }

        const known = new Set(state.chats.map((chat) => chat.chatId).filter(Boolean));
        for (const row of data) {
            const chatId = row.chat_id;
            if (!chatId || known.has(chatId)) continue;

            const { data: others } = await state.sb
                .from('chat_members')
                .select('user_id')
                .eq('chat_id', chatId)
                .neq('user_id', state.sbUid)
                .limit(1);
            const other = others && others[0];
            if (!other) continue;

            const { data: profile } = await state.sb
                .from('profiles')
                .select('nick')
                .eq('id', other.user_id)
                .maybeSingle();
            if (!profile || !profile.nick) continue;
            if (state.hiddenChats[profile.nick]) continue;

            addChat(profile.nick, other.user_id);
            const chat = state.chats.find((item) => item.nick === profile.nick);
            if (chat) chat.chatId = chatId;
        }
    }
    function startAllChatSync() {
        clearInterval(state.syncAllTimer);
        state.syncAllTimer = setInterval(supabaseSyncAllChats, 1500);
    }

    async function supabaseSyncAllChats() {
        if (!state.sb || !state.me || state.syncAllBusy) return;
        state.syncAllBusy = true;

        try {
            await discoverChats();

            for (const chat of [...state.chats]) {
                if (!chat.uid || chat.nick === state.me.nick) continue;

                if (!chat.chatId) {
                    const { data, error } = await state.sb.rpc('create_direct_chat', { other_id: chat.uid });
                    if (!error && data) chat.chatId = data;
                }
                if (!chat.chatId) continue;

                const since = chat.lastTs || new Date(0).toISOString();
                const { data, error } = await state.sb
                    .from('messages')
                    .select('*')
                    .eq('chat_id', chat.chatId)
                    .gt('created_at', since)
                    .order('created_at', { ascending: true })
                    .limit(50);

                if (!error && data) {
                    for (const row of data) {
                        if (row.created_at) chat.lastTs = row.created_at;
                        handleIncomingRow(row, chat.nick);
                    }
                }
            }
            writeJson(LS.chats, state.chats);
        } catch (e) {
            /* transient; retry */
        } finally {
            state.syncAllBusy = false;
        }
    }

    function handleIncomingRow(row, peerNick) {
        if (metaFor(peerNick).blocked) return;
        const messageId = row.client_id || row.id;
        if (isLocallyDeleted(peerNick, messageId)) return;
        if (row.deleted_for_all) {
            removeMessageLocal(peerNick, messageId);
            return;
        }
        const hiddenAt = state.hiddenChats[peerNick];
        if (hiddenAt) {
            const messageAt = Date.parse(row.created_at) || 0;
            if (messageAt <= hiddenAt) return;
            unhideChat(peerNick);
        }
        if (!state.chats.some((chat) => chat.nick === peerNick)) {
            if (state.settings.contactsOnly) return;
            addChat(peerNick, null);
        }
        const chat = state.chats.find((item) => item.nick === peerNick);
        if (chat && row.created_at && (!chat.lastTs || row.created_at > chat.lastTs)) {
            chat.lastTs = row.created_at;
        }
        if (peerNick === state.peer && row.created_at && (!state.chatLastTs || row.created_at > state.chatLastTs)) {
            state.chatLastTs = row.created_at;
        }
        const list = loadHistory(peerNick);

        if (row.sender_id === state.sbUid) {
            const found = list.find((message) => message.id === (row.client_id || row.id));
            if (found) {
                found.status = 'sent';
                found.ts = Date.parse(row.created_at) || found.ts;
                saveHistory(peerNick, list);
                if (state.peer === peerNick) renderMessages();
            }
            return;
        }

        const message = rowToMessage(row, peerNick);
        const existing = list.find((item) => item.id === message.id);
        let isNew = false;
        if (existing) {
            existing.ts = Date.parse(row.created_at) || existing.ts;
            existing.text = row.body || existing.text;
            saveHistory(peerNick, list);
        } else {
            list.push(message);
            saveHistory(peerNick, list.sort((a, b) => a.ts - b.ts));
            isNew = true;
        }
        if (state.peer === peerNick) renderMessages();
        else if (isNew) {
            state.unread.set(peerNick, (state.unread.get(peerNick) || 0) + 1);
            if (message.from !== state.me.nick) {
                notify('pps · ' + peerNick, previewText(message.text), 'msg-' + peerNick, peerNick);
                if (document.visibilityState !== 'visible' || !document.hasFocus()) beep(520, 0.07);
            }
        }
        renderChats();
    }

    function rowToMessage(row, peerNick) {
        const own = row.sender_id === state.sbUid;
        return {
            id: row.client_id || row.id,
            dbId: row.id,
            from: own ? state.me.nick : peerNick,
            to: own ? peerNick : state.me.nick,
            text: row.body,
            ts: Date.parse(row.created_at) || Date.now(),
            status: 'sent',
        };
    }

    async function supabaseSend(message) {
        if (!state.sb || !state.chatId) {
            message.status = 'failed';
            saveHistory(state.peer, loadHistory(state.peer));
            renderMessages();
            return;
        }

        /* Optimistic personal broadcast: the recipient should see the message
           even if the REST insert is slow. The real row dedupes by client_id. */
        if (state.peerUid) {
            sendUserEvent(state.peerUid, 'message', {
                row: {
                    id: null,
                    sender_id: state.sbUid,
                    body: message.text,
                    client_id: message.id,
                    created_at: serverNowIso(),
                },
                fromUid: state.sbUid,
                fromNick: state.me.nick,
                chatId: state.chatId,
            }).catch(() => {});
        }
        message.status = 'sent';
        saveHistory(state.peer, loadHistory(state.peer));
        renderMessages();

        const { data, error } = await state.sb
            .from('messages')
            .insert({
                chat_id: state.chatId,
                sender_id: state.sbUid,
                body: message.text,
                client_id: message.id,
            })
            .select('*')
            .single();

        if (error && error.code === '23505') {
            const { data: existing } = await state.sb
                .from('messages')
                .select('*')
                .eq('client_id', message.id)
                .eq('sender_id', state.sbUid)
                .maybeSingle();
            if (existing) {
                message.status = 'sent';
                message.dbId = existing.id;
                message.ts = Date.parse(existing.created_at) || message.ts;
                saveHistory(state.peer, loadHistory(state.peer));
                renderMessages();
                return;
            }
        }

        message.status = error ? 'failed' : 'sent';
        if (error) {
            console.warn('send message', error);
            showToast('Не отправлено: ' + (error.message || error.code || 'ошибка'));
        }
        if (!error && data) {
            message.ts = Date.parse(data.created_at) || message.ts;
            message.dbId = data.id;
            if (state.chatChannel) {
                state.chatChannel
                    .send({ type: 'broadcast', event: 'message', payload: data })
                    .catch(() => {});
            }
            if (state.peerUid) {
                sendUserEvent(state.peerUid, 'message', {
                    row: data,
                    fromUid: state.sbUid,
                    fromNick: state.me.nick,
                    chatId: state.chatId,
                }).catch(() => {});
            }
            pushNotify(message.to, previewText(message.text), 'message');
        }
        saveHistory(state.peer, loadHistory(state.peer));
        renderMessages();
    }

    function signalChannelFor(uid) {
        let entry = state.signalOut.get(uid);
        if (entry) return entry;

        const channel = state.sb.channel('user-' + uid, { config: { broadcast: { self: false } } });
        const ready = new Promise((resolve) => {
            channel.subscribe((status) => {
                if (status === 'SUBSCRIBED') resolve();
            });
        });
        entry = { channel, ready };
        state.signalOut.set(uid, entry);
        return entry;
    }

    async function sendUserEvent(uid, event, payload) {
        if (!state.sb || !uid) return;
        const { channel, ready } = signalChannelFor(uid);
        await ready;
        await channel.send({ type: 'broadcast', event, payload });
    }

    async function sendSignalTo(uid, data) {
        const sid = newId();
        const payload = {
            fromUid: state.sbUid,
            fromNick: state.me.nick,
            data,
            sid,
        };

        try {
            await sendUserEvent(uid, 'signal', payload);
        } catch (e) {
            /* Broadcast is best-effort; the DB copy below is the fallback. */
        }

        try {
            await state.sb.from('signals').insert({
                from_id: state.sbUid,
                to_id: uid,
                payload,
            });
        } catch (e) {
            /* Broadcast already tried; DB copy is best-effort. */
        }
    }

    function startSignalPoll() {
        clearInterval(state.signalPollTimer);
        state.signalPollTimer = setInterval(pollSignals, 1000);
    }

    async function pollSignals() {
        if (!state.sb || !state.sbUid) return;
        try {
            const { data, error } = await state.sb
                .from('signals')
                .select('id,from_id,payload')
                .eq('to_id', state.sbUid)
                .order('id', { ascending: true })
                .limit(20);
            if (error || !data) return;

            for (const row of data) {
                try { await state.sb.from('signals').delete().eq('id', row.id); } catch (e) { /* ignore */ }
                const payload = row.payload || {};
                handleSignal(payload.fromNick || row.from_id, payload.data, row.from_id, payload.sid);
            }
        } catch (e) {
            /* transient; retry */
        }
    }

    async function supabaseSignal(data) {
        if (!state.peerUid && call.peer) {
            try { state.peerUid = await uidForNick(call.peer); } catch (e) { /* ignore */ }
        }
        if (!state.peerUid) return;
        try {
            await sendSignalTo(state.peerUid, data);
        } catch (e) {
            console.warn('signal', e);
        }
    }

    function supabaseLogout() {
        if (state.presenceChannel && state.sb) {
            try { state.sb.removeChannel(state.presenceChannel); } catch (e) { /* ignore */ }
        }
        if (state.chatChannel && state.sb) {
            try { state.sb.removeChannel(state.chatChannel); } catch (e) { /* ignore */ }
        }
        localStorage.removeItem('nkse-session');
        localStorage.removeItem(LS.user);
        localStorage.removeItem(LS.token);
        clearInterval(state.signalPollTimer);
        state.signalPollTimer = 0;
        state.chats = [];
        state.messages.clear();
        state.peer = null;
        state.peerUid = null;
        state.sb = null;
        location.reload();
    }

    /* ----------------------------------------------------------------- boot */

    function boot() {
        wire();
        stopAllAudio();
        const storedSettings = readJson('pps.settings', null);
        if (!storedSettings || !storedSettings.v2) {
            state.settings.v2 = true;
            saveSettings();
        }
        if (USE_SUPABASE) {
            loadSupabaseSdk()
                .then(bootSupabase)
                .catch(() => showAuth('Не удалось загрузить Supabase SDK.'));
            return;
        }

        const savedUser = readJson(LS.user, null);
        if (savedUser && state.token) {
            hideAuth();
            setMe(savedUser);
            $('me-status').textContent = 'подключение…';
        } else {
            showAuth();
        }
        if (!state.chats.length) {
            const add = new URLSearchParams(location.search).get('add');
            if (add) state.chats.push({ nick: add, uid: null });
        }
        connect();
    }

    boot();
})();
