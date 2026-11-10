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
        sbJwtExp: 0,
        refreshing: false,
        tokenTimer: 0,
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
        chatOldestTs: '',
        loadingOlder: false,
        prefetching: new Set(),
        prefetchSeen: new Map(),
        storageReady: null,
        batchSync: false,
        relay: null,
        relayRetry: 0,
        chatObserver: null,
        signalRowChannel: null,
        relayPeer: '',
        relayReady: false,
        relayQueue: [],
        messages: new Map(),
        online: new Set(),
        statuses: {},
        unread: new Map(),
        search: [],
        searchLoading: false,
        welcomeFocused: false,
        chatTab: 'all',
        pendingFiles: [],
        pendingPreviews: [],
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
        state.messages.set(nick, sorted.slice(-600));
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

    function buildTime(message, own) {
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
        return time;
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
        let lastNick = '';
        try { lastNick = localStorage.getItem('pps.lastNick') || ''; } catch (e) { /* private mode */ }
        if (lastNick && !$('auth-nick').value) $('auth-nick').value = lastNick;
        setTimeout(() => (lastNick ? $('auth-pass') : $('auth-nick')).focus(), 30);
    }

    function hideAuth() {
        document.body.classList.remove('auth-locked');
        $('auth-modal').hidden = true;
        $('auth-error').hidden = true;
        try {
            if (!localStorage.getItem('pps.onboarded')) setTimeout(showHelp, 700);
        } catch (e) { /* private mode */ }
    }

    function showHelp() {
        $('help-modal').hidden = false;
    }

    function hideHelp() {
        $('help-modal').hidden = true;
        try { localStorage.setItem('pps.onboarded', '1'); } catch (e) { /* private mode */ }
    }

    function setMe(user) {
        state.me = user;
        state.sbUid = user.uid || state.sbUid;
        writeJson(LS.user, user);
        try { localStorage.setItem('pps.lastNick', user.nick || ''); } catch (e) { /* private mode */ }
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

    function saveChats() {
        writeJson(LS.chats, state.chats);
    }

    function addChat(nick, uid) {
        if (!nick || (state.me && nick === state.me.nick)) return;
        const existing = state.chats.find((chat) => chat.nick === nick);
        if (existing) {
            if (uid && existing.uid !== uid) {
                existing.uid = uid;
                saveChats();
            }
            return;
        }
        state.chats.push({ nick, uid: uid || null, chatId: null, lastTs: '' });
        saveChats();
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

            if (state.sb) {
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
                    const { data: updated, error } = await query.select('id');
                    ok = !error && Array.isArray(updated) && updated.length > 0;
                } catch (e) {
                    ok = false;
                }
            }

            if (!ok) {
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
        input.placeholder = meta.blocked ? 'Пользователь заблокирован' : 'Напиши сообщение…';
        $('chat-banner').hidden = !meta.blocked;
        $('chat-banner').textContent = meta.blocked ? 'Пользователь заблокирован. Сообщения не отправляются.' : '';
        const mute = document.querySelector('[data-action="mute"]');
        const block = document.querySelector('[data-action="block"]');
        if (mute) mute.textContent = meta.muted ? 'Включить звук' : 'Без звука';
        if (block) block.textContent = meta.blocked ? 'Разблокировать' : 'Заблокировать';
        const profileMute = document.querySelector('[data-profile-action="mute"]');
        const profileBlock = document.querySelector('[data-profile-action="block"]');
        if (profileMute) profileMute.textContent = meta.muted ? 'Включить звук' : 'Без звука';
        if (profileBlock) profileBlock.textContent = meta.blocked ? 'Разблокировать' : 'Заблокировать';
    }

    function openProfile() {
        if (!state.peer) return;
        $('profile-nick').textContent = state.peer;
        paintAvatar($('profile-avatar'), state.peer);
        $('profile-status').textContent = presenceText(state.peer);
        applyChatMeta(state.peer);
        $('profile-panel').hidden = false;
    }

    function closeProfile() {
        $('profile-panel').hidden = true;
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

    function initSidebarResize() {
        const app = $('app');
        const sidebar = document.querySelector('.sidebar');
        const resizer = $('sidebar-resizer');
        if (!app || !sidebar || !resizer) return;

        const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
        const savedWidth = () => Number(localStorage.getItem('pps.sidebarWidth')) || 340;

        const applyWidth = () => {
            if (isMobile()) {
                sidebar.style.width = '';
                sidebar.style.flexBasis = '';
                return;
            }
            if (app.classList.contains('is-collapsed')) return;
            const width = savedWidth();
            sidebar.style.width = width + 'px';
            sidebar.style.flexBasis = width + 'px';
        };

        if (localStorage.getItem('pps.sidebarCollapsed') === '1') {
            app.classList.add('is-collapsed');
        }
        applyWidth();
        window.addEventListener('resize', applyWidth);

        let dragging = false;
        let startX = 0;
        let startW = 0;

        const onMove = (event) => {
            if (!dragging) return;
            const width = Math.max(220, Math.min(560, startW + event.clientX - startX));
            if (width < 260) {
                app.classList.add('is-collapsed');
                sidebar.style.width = '';
                sidebar.style.flexBasis = '';
            } else {
                app.classList.remove('is-collapsed');
                sidebar.style.width = width + 'px';
                sidebar.style.flexBasis = width + 'px';
            }
        };

        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            resizer.classList.remove('is-dragging');
            document.body.classList.remove('is-resizing');
            const collapsed = app.classList.contains('is-collapsed');
            localStorage.setItem('pps.sidebarCollapsed', collapsed ? '1' : '0');
            if (!collapsed) {
                localStorage.setItem('pps.sidebarWidth', String(Math.round(sidebar.getBoundingClientRect().width)));
            }
        };

        resizer.addEventListener('pointerdown', (event) => {
            if (isMobile()) return;
            dragging = true;
            startX = event.clientX;
            startW = sidebar.getBoundingClientRect().width;
            resizer.classList.add('is-dragging');
            document.body.classList.add('is-resizing');
            try { resizer.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
        });
        resizer.addEventListener('pointermove', onMove);
        resizer.addEventListener('pointerup', onUp);
        resizer.addEventListener('pointercancel', onUp);
        resizer.addEventListener('dblclick', () => {
            const collapsed = app.classList.toggle('is-collapsed');
            if (collapsed) {
                sidebar.style.width = '';
                sidebar.style.flexBasis = '';
            } else {
                const width = savedWidth();
                sidebar.style.width = width + 'px';
                sidebar.style.flexBasis = width + 'px';
            }
            localStorage.setItem('pps.sidebarCollapsed', collapsed ? '1' : '0');
        });
    }

    function initSettings() {
        $('settings-btn').addEventListener('click', () => {
            applySettingsUI();
            $('settings-modal').hidden = false;
        });
        $('settings-close').addEventListener('click', () => { $('settings-modal').hidden = true; });
        $('hard-refresh').addEventListener('click', async () => {
            try {
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.map((reg) => reg.unregister()));
                }
                if (window.caches) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map((key) => caches.delete(key)));
                }
            } catch (e) { /* ignore */ }
            location.replace(location.pathname + '?v=' + Date.now());
        });
        $('help-btn').addEventListener('click', showHelp);
        $('help-btn-main').addEventListener('click', showHelp);
        $('help-close').addEventListener('click', hideHelp);
        $('help-ok').addEventListener('click', hideHelp);
        $('help-skip').addEventListener('click', hideHelp);
        $('settings-logout').addEventListener('click', () => {
            $('settings-modal').hidden = true;
            $('logout-btn').click();
        });

        document.querySelectorAll('[data-accent-choice]').forEach((button) => {
            button.addEventListener('click', () => applyAccent(button.dataset.accentChoice));
        });
        try {
            if (!localStorage.getItem('pps.goldV1')) {
                localStorage.setItem('pps.goldV1', '1');
                localStorage.setItem('pps.accent', 'amber');
                document.documentElement.setAttribute('data-accent', 'amber');
            }
        } catch (e) { /* private mode */ }
        applyAccent(localStorage.getItem('pps.accent') || 'amber');

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

    async function sendCallLog(peer, media, status, duration) {
        if (!peer || !state.me) return;

        const marker = '[[call:' + (media === 'video' ? 'video' : 'audio') + '|' +
            encodeURIComponent(status || 'завершён') + '|' + (duration || 0) + ']]';
        const message = {
            id: newId(),
            from: state.me.nick,
            to: peer,
            text: marker,
            ts: serverNow(),
            status: 'sending',
            kind: 'call',
        };

        const list = loadHistory(peer);
        list.push(message);
        saveHistory(peer, list);
        if (state.peer === peer) renderMessages();
        renderChats();

        if (!USE_SUPABASE) {
            if (send({ type: 'message', to: peer, text: marker, id: message.id })) {
                message.status = 'sent';
                saveHistory(peer, loadHistory(peer));
                renderMessages();
            }
            return;
        }

        if (!state.sb || !state.sbUid) return;

        let uid = state.peer === peer
            ? state.peerUid
            : (state.chats.find((chat) => chat.nick === peer) || {}).uid;
        if (!uid) {
            try { uid = await uidForNick(peer); } catch (e) { uid = ''; }
        }
        if (!uid) return;

        let chatId = state.peer === peer
            ? state.chatId
            : (state.chats.find((chat) => chat.nick === peer) || {}).chatId;
        if (!chatId) {
            try {
                const { data } = await state.sb.rpc('create_direct_chat', { other_id: uid });
                chatId = data;
                const chat = state.chats.find((item) => item.nick === peer);
                if (chat) chat.chatId = chatId;
            } catch (e) {
                chatId = '';
            }
        }
        if (!chatId) return;

        const { data, error } = await state.sb
            .from('messages')
            .insert({
                chat_id: chatId,
                sender_id: state.sbUid,
                body: marker,
                client_id: message.id,
            })
            .select('*')
            .single();

        if (error || !data) {
            message.status = 'failed';
            saveHistory(peer, loadHistory(peer));
            if (state.peer === peer) renderMessages();
            return;
        }

        message.status = 'sent';
        message.dbId = data.id;
        message.ts = Date.parse(data.created_at) || message.ts;
        saveHistory(peer, loadHistory(peer));

        if (state.chatId === chatId && state.chatChannel) {
            state.chatChannel.send({ type: 'broadcast', event: 'message', payload: data }).catch(() => {});
        }
        sendUserEvent(uid, 'message', {
            row: data,
            fromUid: state.sbUid,
            fromNick: state.me.nick,
            chatId,
        }).catch(() => {});

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

        clearPendingFile();
        closeProfile();
        unhideChat(target.nick);
        addChat(target.nick, target.uid);
        state.peer = target.nick;
        state.peerUid = target.uid || null;
        state.unread.delete(target.nick);
        state.chatId = null;
        state.chatLastTs = '';
        state.chatOldestTs = '';
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
        clearPendingFile();
        relayClose();
        closeProfile();
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

        let visible = [...state.chats];
        if (state.chatTab === 'unread') {
            visible = visible.filter((chat) => (state.unread.get(chat.nick) || 0) > 0);
        } else if (state.chatTab === 'online') {
            visible = visible.filter((chat) => isOnline(chat.nick));
        }
        const sorted = visible.sort((a, b) => {
            const am = lastMessage(a.nick);
            const bm = lastMessage(b.nick);
            return (bm ? bm.ts : 0) - (am ? am.ts : 0);
        });

        for (const chat of sorted) {
            const nick = chat.nick;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chat-item' + (state.peer === nick ? ' is-active' : '');
            button.dataset.nick = nick;
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
            if (state.chatObserver) state.chatObserver.observe(button);
        }

        if (!sorted.length && state.chats.length) {
            const note = document.createElement('div');
            note.className = 'chat-tab-empty';
            note.textContent = state.chatTab === 'unread'
                ? 'Нет непрочитанных. Всё прочитано.'
                : 'Сейчас никого нет в сети.';
            list.append(note);
        }

        const empty = state.chats.length === 0;
        document.querySelector('.sidebar').classList.toggle('is-empty', empty);
        $('side-empty').hidden = !empty;
        if (empty && !state.welcomeFocused) {
            state.welcomeFocused = true;
            setTimeout(() => { const search = $('search'); if (search) search.focus(); }, 400);
        }
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

    function imageInfo(text) {
        const match = /^\[\[img:([^|\]]+)(?:\|([^\]]*))?\]\]$/.exec(String(text || '').trim());
        if (!match || !/^https:\/\//i.test(match[1])) return null;
        return {
            url: match[1],
            caption: match[2] ? decodeURIComponent(match[2]) : '',
        };
    }

    function albumInfo(text) {
        const match = /^\[\[album:([^\]]+)\]\]$/.exec(String(text || '').trim());
        if (!match) return null;
        const parts = match[1].split('|');
        let caption = '';
        if (parts.length && !/^https:\/\//i.test(parts[parts.length - 1])) {
            caption = decodeURIComponent(parts.pop());
        }
        const urls = parts.filter((url) => /^https:\/\//i.test(url));
        if (urls.length < 2) return null;
        return { urls, caption };
    }

    function fileInfo(text) {
        const match = /^\[\[file:([^|\]]+)\|([^|]*)(?:\|([^\]]*))?\]\]$/.exec(String(text || '').trim());
        if (!match || !/^https:\/\//i.test(match[1])) return null;
        return {
            url: match[1],
            name: match[2] || 'Файл',
            caption: match[3] ? decodeURIComponent(match[3]) : '',
        };
    }

    function driveImageUrl(url) {
        const value = String(url || '');
        const match = /drive\.google\.com\/uc\?export=view&(?:amp;)?id=([^&]+)/.exec(value);
        if (match) return 'https://drive.google.com/thumbnail?id=' + match[1] + '&sz=w1600';
        return value;
    }

    function callLogInfo(text) {
        const match = /^\[\[call:([^|]*)\|([^|]*)\|([^\]]*)\]\]$/.exec(String(text || '').trim());
        if (!match) return null;
        const media = match[1] === 'video' ? 'Видеозвонок' : 'Аудиозвонок';
        const status = decodeURIComponent(match[2] || '');
        const duration = Number(match[3]) || 0;
        let label = media + ' · ' + status;
        if (duration > 0) {
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            label += ' · ' + minutes + ':' + String(seconds).padStart(2, '0');
        }
        return { text: label, media: match[1], status, duration };
    }

    function previewText(text) {
        if (stickerUrl(text)) return 'Стикер';
        const album = albumInfo(text);
        if (album) return album.urls.length + ' фото';
        if (imageInfo(text)) return 'Фото';
        if (fileInfo(text)) return 'Файл';
        if (callLogInfo(text)) return 'Звонок';
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
        if (!ordered.length) {
            const hint = document.createElement('div');
            hint.className = 'chat-empty';
            hint.innerHTML = '<span>👋</span><b>Напиши первое сообщение</b><small>Поле ввода — внизу</small>';
            box.append(hint);
        }
        let lastDay = '';
        let lastFrom = '';
        let lastTs = 0;
        for (const message of ordered) {
            if (isLocallyDeleted(state.peer, message.id)) continue;
            const day = dayLabel(message.ts);
            if (day !== lastDay) {
                lastDay = day;
                lastFrom = '';
                lastTs = 0;
                const separator = document.createElement('div');
                separator.className = 'day-sep';
                separator.textContent = day;
                box.append(separator);
            }

            const callLog = callLogInfo(message.text);
            if (message.kind === 'call' || message.from === 'system' || callLog) {
                const callRow = document.createElement('div');
                callRow.className = 'msg call-log';
                const bubble = document.createElement('div');
                bubble.className = 'bubble';
                bubble.textContent = callLog ? callLog.text : message.text;
                callRow.append(bubble);
                box.append(callRow);
                lastFrom = '';
                lastTs = 0;
                continue;
            }

            const own = state.me && message.from === state.me.nick;
            const grouped = message.from === lastFrom && (message.ts - lastTs) < 120000;
            const row = document.createElement('div');
            row.className = 'msg' + (own ? ' own' : '') + (grouped ? ' is-grouped' : '');
            row.dataset.id = message.id;
            row._message = message;

            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            const album = albumInfo(message.text);
            const image = imageInfo(message.text);
            const file = fileInfo(message.text);
            const sticker = stickerUrl(message.text);
            let time = null;
            let timeInside = false;

            if (album) {
                bubble.classList.add('is-album');
                const grid = document.createElement('div');
                grid.className = 'album-grid' + (album.urls.length === 3 ? ' is-three' : '');
                album.urls.forEach((url) => {
                    const src = driveImageUrl(url);
                    const img = document.createElement('img');
                    img.src = src;
                    img.alt = 'фото';
                    img.loading = 'lazy';
                    img.addEventListener('click', () => window.open(src, '_blank', 'noopener'));
                    grid.append(img);
                });
                bubble.append(grid);
                if (album.caption) {
                    const caption = document.createElement('div');
                    caption.className = 'msg-caption';
                    const text = document.createElement('span');
                    text.className = 'caption-text';
                    text.textContent = album.caption;
                    time = buildTime(message, own);
                    time.classList.add('caption-time');
                    caption.append(text, time);
                    bubble.append(caption);
                } else {
                    time = buildTime(message, own);
                    time.classList.add('msg-time-overlay');
                    bubble.append(time);
                }
                timeInside = true;
            } else if (image) {
                bubble.classList.add('is-image');
                const img = document.createElement('img');
                img.src = driveImageUrl(image.url);
                img.alt = 'фото';
                img.loading = 'lazy';
                img.addEventListener('click', () => window.open(img.src, '_blank', 'noopener'));
                bubble.append(img);
                if (image.caption) {
                    const caption = document.createElement('div');
                    caption.className = 'msg-caption';
                    const text = document.createElement('span');
                    text.className = 'caption-text';
                    text.textContent = image.caption;
                    time = buildTime(message, own);
                    time.classList.add('caption-time');
                    caption.append(text, time);
                    bubble.append(caption);
                } else {
                    time = buildTime(message, own);
                    time.classList.add('msg-time-overlay');
                    bubble.append(time);
                }
                timeInside = true;
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
                if (file.caption) {
                    const caption = document.createElement('div');
                    caption.className = 'msg-caption';
                    caption.textContent = file.caption;
                    bubble.append(caption);
                }
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
            lastFrom = message.from;
            lastTs = message.ts;
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
        if (state.pendingFiles.length) {
            sendPendingAttachment();
            return;
        }
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

    function testDelay() {
        const params = new URLSearchParams(location.search);
        const lag = Number(params.get('lag')) || 0;
        const jitter = Number(params.get('jitter')) || 0;
        if (!lag && !jitter) return Promise.resolve();
        const ms = Math.max(0, lag + (jitter ? (Math.random() * 2 - 1) * jitter : 0));
        return new Promise((resolve) => setTimeout(resolve, ms));
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

    async function prepareUpload(file) {
        if (!file) throw new Error('empty');
        if (file.size > 8 * 1024 * 1024) throw new Error('too_big');

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

        if (blob.size > 8 * 1024 * 1024) throw new Error('too_big');
        return { blob, name, mime };
    }

    async function uploadPrepared(prepared) {
        const data = await blobToBase64(prepared.blob);
        const session = readNkseSession();
        const result = await appsScriptCall({
            board: 'media',
            op: 'upload',
            token: session.token,
            name: prepared.name,
            mime: prepared.mime,
            data,
        });
        if (!result || !result.ok || !result.url) {
            throw new Error(result && result.error ? result.error : 'upload');
        }
        return result;
    }

    function fileExtension(name, mime) {
        const match = /\.([a-z0-9]{1,5})$/i.exec(String(name || ''));
        if (match) return match[1].toLowerCase();
        if (mime === 'image/jpeg') return 'jpg';
        if (mime === 'image/png') return 'png';
        if (mime === 'image/webp') return 'webp';
        if (mime === 'image/gif') return 'gif';
        return 'bin';
    }

    /* Direct upload to Supabase Storage: CDN delivery, no Apps Script.
       Falls back to Drive automatically while the bucket is not created. */
    async function uploadToStorage(prepared) {
        if (!state.sb || !state.sbUid) throw new Error('no_sb');
        const ext = fileExtension(prepared.name, prepared.mime);
        const path = state.sbUid + '/' + Date.now() + '-' +
            Math.random().toString(36).slice(2, 8) + '.' + ext;
        const { error } = await state.sb.storage.from('media').upload(path, prepared.blob, {
            contentType: prepared.mime,
            upsert: false,
            cacheControl: '31536000',
        });
        if (error) throw error;
        const { data } = state.sb.storage.from('media').getPublicUrl(path);
        const url = data && data.publicUrl;
        if (!url) throw new Error('no_url');
        return {
            ok: true,
            url,
            view: url,
            thumb: prepared.mime.indexOf('image/') === 0 ? url : '',
        };
    }

    function setPendingFiles(files) {
        const list = Array.from(files || []).slice(0, 10);
        if (!list.length) return;
        clearPendingFile();
        state.pendingFiles = list;
        state.pendingPreviews = [];

        const media = $('attach-media');
        media.replaceChildren();
        const images = list.filter((file) => (file.type || '').indexOf('image/') === 0);
        if (images.length) {
            images.slice(0, 3).forEach((file) => {
                const url = URL.createObjectURL(file);
                state.pendingPreviews.push(url);
                const img = document.createElement('img');
                img.src = url;
                img.alt = '';
                media.append(img);
            });
            if (images.length > 3) {
                const more = document.createElement('span');
                more.className = 'attach-more';
                more.textContent = '+' + (images.length - 3);
                media.append(more);
            }
        } else {
            const icon = document.createElement('span');
            icon.className = 'attach-file-icon';
            icon.textContent = '📎';
            media.append(icon);
        }

        let name = list[0].name || 'Файл';
        if (list.length > 1) {
            name = images.length === list.length ? list.length + ' фото' : list.length + ' файла';
        }
        $('attach-name').textContent = name;
        $('attach-preview').hidden = false;
        $('attach-send').disabled = false;
        $('attach-send').classList.remove('is-loading');
        $('text').placeholder = images.length ? 'Подпись к фото…' : 'Подпись к файлу…';
        setTimeout(() => $('text').focus(), 50);
    }

    function clearPendingFile() {
        state.pendingPreviews.forEach((url) => {
            try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        });
        state.pendingFiles = [];
        state.pendingPreviews = [];
        $('attach-preview').hidden = true;
        $('attach-media').replaceChildren();
        $('file-input').value = '';
        $('attach-send').disabled = false;
        $('attach-send').classList.remove('is-loading');
        $('text').placeholder = 'Напиши сообщение…';
    }

    async function uploadOne(prepared) {
        if (state.storageReady !== false) {
            try {
                const result = await uploadToStorage(prepared);
                state.storageReady = true;
                return result;
            } catch (e) {
                state.storageReady = false;
            }
        }
        return uploadPrepared(prepared);
    }

    async function sendPendingAttachment() {
        const files = state.pendingFiles.slice();
        if (!files.length) return;
        const caption = $('text').value.trim();
        $('attach-send').disabled = true;
        $('attach-send').classList.add('is-loading');

        try {
            const uploadAll = async (file) => {
                const prepared = await prepareUpload(file);
                const result = await uploadOne(prepared);
                return { prepared, result };
            };
            /* Up to 3 files upload in parallel; more go sequentially to keep
               memory sane on phones. */
            const uploaded = files.length <= 3
                ? await Promise.all(files.map(uploadAll))
                : await (async () => {
                    const list = [];
                    for (const file of files) list.push(await uploadAll(file));
                    return list;
                })();

            const images = uploaded.filter((item) => item.prepared.mime.indexOf('image/') === 0);
            const others = uploaded.filter((item) => item.prepared.mime.indexOf('image/') !== 0);

            if (images.length > 1) {
                const urls = images.map((item) => item.result.thumb || item.result.url);
                const suffix = caption ? '|' + encodeURIComponent(caption) : '';
                sendText('[[album:' + urls.join('|') + suffix + ']]');
            } else if (images.length === 1) {
                const suffix = caption ? '|' + encodeURIComponent(caption) : '';
                sendText('[[img:' + (images[0].result.thumb || images[0].result.url) + suffix + ']]');
            }

            others.forEach((item, index) => {
                const name = item.prepared.name.replace(/[|\]]/g, '');
                const suffix = caption && index === 0 && !images.length ? '|' + encodeURIComponent(caption) : '';
                sendText('[[file:' + (item.result.view || item.result.url) + '|' + name + suffix + ']]');
            });

            $('text').value = '';
            clearPendingFile();
        } catch (e) {
            const code = e && e.message ? e.message : '';
            const text = code === 'no_session' ? 'Сессия истекла, войди заново'
                : code === 'too_big' ? 'Файл больше 8 МБ'
                    : code === 'unknown_action' ? 'Сервер не обновлён — переразверни Apps Script'
                        : 'Не удалось загрузить файл';
            showToast(text);
            $('attach-send').disabled = false;
            $('attach-send').classList.remove('is-loading');
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
            script.src = 'jsqr.min.js?v=32';
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
        $('call-modal').classList.remove('is-fullscreen');
        requestWakeLock();
        $('videos').classList.toggle('on', media === 'video');
        $('call-accept').hidden = !incoming;
        $('call-reject').hidden = !incoming;
        $('call-hangup').hidden = !!incoming;
        $('call-mute').hidden = !!incoming;
        $('call-mute').textContent = 'Микрофон';
        $('call-mute').classList.remove('is-off');
        $('call-camera').hidden = !!incoming;
        $('call-camera').textContent = media === 'video' ? 'Камера' : 'Включить камеру';
        $('call-camera').classList.remove('is-off');
        $('call-fullscreen').hidden = media !== 'video' || !!incoming;
        $('call-fullscreen').textContent = 'На весь экран';
        $('call-zoom-wrap').hidden = media !== 'video' || !!incoming;
        $('call-zoom').value = 100;
        $('remote-video').style.transform = '';
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
                    sampleRate: 48000,
                    channelCount: 1,
                },
                video: media === 'video'
                    ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
                    : false,
            });
        } catch (error) {
            if (media !== 'video') throw error;
            /* Камеры нет или доступ к ней запрещён — продолжаем аудиозвонком. */
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1,
                },
                video: false,
            });
            call.videoUnavailable = true;
        }

        call.local = stream;
        $('local-video').srcObject = stream;
        const noVideo = media === 'video' && stream.getVideoTracks().length === 0;
        $('video-note').hidden = !noVideo;
        if (noVideo) $('video-note').textContent = 'Ваша камера недоступна — вас не видно';
        return stream;
    }

    function addCallTracks(pc) {
        for (const track of call.local.getTracks()) {
            const sender = pc.addTrack(track, call.local);
            if (track.kind === 'video') {
                try {
                    const params = sender.getParameters();
                    params.encodings = params.encodings || [{}];
                    params.encodings[0].maxBitrate = 1500000;
                    sender.setParameters(params).catch(() => {});
                } catch (e) { /* ignore */ }
            }
        }
    }

    async function enableCamera() {
        if (!call.pc || !call.local) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
                audio: false,
            });
            const track = stream.getVideoTracks()[0];
            if (!track) throw new Error('no camera');

            call.local.addTrack(track);
            $('local-video').srcObject = call.local;
            const sender = call.pc.addTrack(track, call.local);
            try {
                const params = sender.getParameters();
                params.encodings = params.encodings || [{}];
                params.encodings[0].maxBitrate = 1500000;
                sender.setParameters(params).catch(() => {});
            } catch (e) { /* ignore */ }

            call.media = 'video';
            $('videos').classList.add('on');
            $('video-note').hidden = true;
            $('call-fullscreen').hidden = false;
            $('call-zoom-wrap').hidden = false;
            $('call-camera').textContent = 'Камера';
            $('call-camera').classList.remove('is-off');

            const offer = await call.pc.createOffer();
            await call.pc.setLocalDescription(offer);
            signal({ kind: 'renegotiate', sdp: call.pc.localDescription.sdp });
        } catch (e) {
            showToast('Камера недоступна');
        }
    }

    function createPc() {
        const pc = new RTCPeerConnection(ICE);
        call.pc = pc;
        window.__ppsPc = pc;
        window.__ppsCall = call;
        call.candidates = [];

        pc.onicecandidate = (event) => {
            if (event.candidate) signal({ kind: 'ice', candidate: event.candidate });
        };
        pc.ontrack = (event) => {
            if (event.track.kind === 'video') {
                const current = $('remote-video').srcObject;
                const stream = new MediaStream();
                if (current) {
                    current.getVideoTracks().forEach((track) => {
                        if (track !== event.track) stream.addTrack(track);
                    });
                }
                stream.addTrack(event.track);
                $('remote-video').srcObject = stream;
                $('videos').classList.add('on');
                $('video-note').hidden = true;
                $('call-fullscreen').hidden = false;
                $('call-zoom-wrap').hidden = false;
            } else {
                const audioStream = event.streams[0] || new MediaStream([event.track]);
                const audio = $('remote-audio');
                audio.srcObject = audioStream;
                audio.play().catch(() => {});
            }
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
                signal({ kind: 'end' });
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
            addCallTracks(pc);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            signal({ kind: 'offer', media, sdp: pc.localDescription.sdp });
            pushNotify(call.peer, 'Входящий звонок', 'call');
            setCallStatus('ждём ответа…');
            clearTimeout(state.callTimeout);
            state.callTimeout = setTimeout(() => {
                if (call.active && !state.callStartedAt) {
                    setCallStatus('нет ответа');
                    signal({ kind: 'end' });
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
        $('call-camera').hidden = false;
        $('call-camera').textContent = call.media === 'video' ? 'Камера' : 'Включить камеру';
        $('call-fullscreen').hidden = call.media !== 'video';
        $('call-zoom-wrap').hidden = call.media !== 'video';
        $('call-volume-wrap').hidden = false;
        setCallStatus('подключаемся…');

        try {
            await mediaFor(call.media);
            const pc = createPc();
            addCallTracks(pc);
            await pc.setRemoteDescription({ type: 'offer', sdp: call.incoming.sdp });
            for (const candidate of call.incoming.candidates || []) {
                try { await pc.addIceCandidate(candidate); } catch (e) { /* ignore */ }
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signal({ kind: 'answer', sdp: pc.localDescription.sdp });
            setCallStatus('подключаемся…');
            clearTimeout(state.callTimeout);
            state.callTimeout = setTimeout(() => {
                if (call.active && !state.callStartedAt) {
                    setCallStatus('не удалось соединиться');
                    signal({ kind: 'end' });
                    cleanupCall('не удалось');
                }
            }, 20000);
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
        const wasIncoming = !!call.incoming;
        const duration = state.callStartedAt
            ? Math.round((Date.now() - state.callStartedAt) / 1000)
            : 0;

        clearTimeout(state.callTimeout);
        state.callTimeout = 0;
        stopRing();
        releaseWakeLock();

        $('call-modal').hidden = true;
        $('call-modal').classList.remove('is-fullscreen');
        $('videos').classList.remove('on');
        $('video-note').hidden = true;
        $('call-fullscreen').hidden = true;
        $('call-zoom-wrap').hidden = true;
        $('remote-video').style.transform = '';

        if (peer) {
            addChat(peer, state.peerUid);
            if (!wasIncoming) {
                sendCallLog(peer, media, reason || 'завершён', duration).catch(() => {});
            }
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
                setCallStatus('подключаемся…');
            }
            return;
        }

        if (data.kind === 'renegotiate') {
            if (!call.pc) return;
            try {
                await call.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
                const answer = await call.pc.createAnswer();
                await call.pc.setLocalDescription(answer);
                signal({ kind: 'renegotiate-answer', sdp: call.pc.localDescription.sdp });
            } catch (e) { /* ignore */ }
            return;
        }

        if (data.kind === 'renegotiate-answer') {
            if (call.pc && call.pc.signalingState !== 'stable') {
                try { await call.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp }); } catch (e) { /* ignore */ }
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
                    if (data.call) {
                        setTimeout(() => {
                            if (!call.incoming && !call.active) showToast('Звонок уже завершён');
                        }, 1500);
                    }
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
        $('empty-help').addEventListener('click', showHelp);
        document.querySelectorAll('[data-chat-tab]').forEach((button) => {
            button.addEventListener('click', () => {
                state.chatTab = button.dataset.chatTab;
                document.querySelectorAll('[data-chat-tab]').forEach((item) => {
                    const active = item === button;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-selected', String(active));
                });
                renderChats();
            });
        });
        $('compose-btn').addEventListener('click', () => {
            $('search').focus();
            $('search').select();
            $('chat-list').scrollTop = 0;
        });
        $('side-empty-search').addEventListener('click', () => {
            $('search').focus();
            $('search').select();
        });
        $('side-empty-scan').addEventListener('click', openScanner);
        $('side-empty-qr').addEventListener('click', openQr);
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
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            setPendingFiles(files);
        });
        $('attach-send').addEventListener('click', sendPendingAttachment);
        $('attach-cancel').addEventListener('click', clearPendingFile);
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
        $('messages').addEventListener('scroll', () => {
            updateScrollButton();
            if ($('messages').scrollTop < 60) loadOlderMessages();
        });
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

        $('chat-info-btn').addEventListener('click', (event) => {
            event.stopPropagation();
            openProfile();
        });
        $('profile-close').addEventListener('click', closeProfile);
        $('profile-panel').addEventListener('click', (event) => {
            const button = event.target.closest('[data-profile-action]');
            if (!button) return;
            event.stopPropagation();
            chatAction(button.dataset.profileAction);
            closeProfile();
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
                if (state.sbJwtExp && Date.now() > state.sbJwtExp - 10 * 60 * 1000) {
                    refreshSupabaseToken();
                }
                supabaseSyncChat();
                supabaseSyncAllChats();
                pollSignals();
                if (state.peerUid) relayConnect(state.peerUid);
            }
        });
        window.addEventListener('online', () => {
            if (state.sbJwtExp && Date.now() > state.sbJwtExp - 10 * 60 * 1000) {
                refreshSupabaseToken();
            }
            supabaseSyncChat();
            supabaseSyncAllChats();
            pollSignals();
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
            $('call-mute').textContent = audio.enabled ? 'Микрофон' : 'Микрофон выкл';
            $('call-mute').classList.toggle('is-off', !audio.enabled);
        });

        $('call-camera').addEventListener('click', () => {
            if (!call.local) return;
            const video = call.local.getVideoTracks()[0];
            if (!video) {
                enableCamera();
                return;
            }
            video.enabled = !video.enabled;
            $('call-camera').textContent = video.enabled ? 'Камера' : 'Включить камеру';
            $('call-camera').classList.toggle('is-off', !video.enabled);
        });

        $('call-fullscreen').addEventListener('click', () => {
            const on = !$('call-modal').classList.contains('is-fullscreen');
            $('call-modal').classList.toggle('is-fullscreen', on);
            $('call-fullscreen').textContent = on ? 'Свернуть' : 'На весь экран';
        });

        $('call-zoom').addEventListener('input', (event) => {
            const scale = Number(event.target.value) / 100;
            $('remote-video').style.transform = 'scale(' + scale + ')';
        });

        $('call-volume').addEventListener('input', (event) => {
            const value = Number(event.target.value) / 100;
            $('remote-audio').volume = value;
            $('remote-audio').muted = value === 0;
        });

        window.addEventListener('beforeunload', () => {
            if (call.active) signal({ kind: 'end' });
        });

        initSidebarResize();
        initPrefetch();
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

    async function refreshSupabaseToken() {
        if (state.refreshing) return;
        const session = readNkseSession();
        if (!session.token) return;

        state.refreshing = true;
        try {
            const data = await appsScriptCall({ board: 'auth', op: 'supabase', token: session.token });
            if (!data || !data.ok || !data.token) return;

            const payload = decodeJwt(data.token);
            state.sbJwt = data.token;
            state.sbJwtExp = (payload.exp || 0) * 1000;
            try { localStorage.setItem('pps.sbJwt', data.token); } catch (e) { /* private mode */ }

            if (state.sb) {
                state.sb.headers.Authorization = 'Bearer ' + data.token;
                state.sb.realtime.setAuth(data.token);
            }
        } catch (e) {
            /* keep the old token; the next tick retries */
        } finally {
            state.refreshing = false;
        }
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
        /* Reuse the signed JWT while it is valid: returning users skip the
           3-second Apps Script round trip on every app start. */
        if (cachedUser && session.token) {
            let cachedJwt = '';
            try { cachedJwt = localStorage.getItem('pps.sbJwt') || ''; } catch (e) { /* private mode */ }
            if (cachedJwt) {
                const payload = decodeJwt(cachedJwt);
                const exp = (payload.exp || 0) * 1000;
                if (exp > Date.now() + 5 * 60 * 1000
                    && payload.sub === cachedUser.uid
                    && payload.nick === cachedUser.nick) {
                    try {
                        await initSupabase(cachedJwt, cachedUser);
                        if (exp < Date.now() + 60 * 60 * 1000) {
                            refreshSupabaseToken().catch(() => {});
                        }
                        return;
                    } catch (e) {
                        console.warn('cached jwt', e);
                    }
                }
            }
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
        state.sbJwtExp = (decodeJwt(jwt).exp || 0) * 1000;
        state.sbUid = user.uid;
        try { localStorage.setItem('pps.sbJwt', jwt); } catch (e) { /* private mode */ }

        const client = window.PPS.createClient(SUPABASE.url, SUPABASE.key, {
            global: { headers: { Authorization: 'Bearer ' + jwt } },
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        state.sb = client;
        client.realtime.setAuth(jwt);

        let chatsOwner = '';
        try { chatsOwner = localStorage.getItem('pps.chatsOwner') || ''; } catch (e) { /* private mode */ }
        if (chatsOwner && chatsOwner !== user.nick) state.chats = [];
        state.chats = state.chats.filter((chat) => chat && chat.nick && chat.nick !== user.nick);
        try { localStorage.setItem('pps.chatsOwner', user.nick); } catch (e) { /* private mode */ }
        saveChats();

        setMe({ nick: user.nick, uid: user.uid });
        hideAuth();
        setConn(true);
        for (const chat of state.chats) loadHistory(chat.nick);
        renderChats();

        /* These must not delay the first paint. */
        syncServerClock().catch(() => {});
        let lastSeenAt = 0;
        try { lastSeenAt = Number(localStorage.getItem('pps.lastSeenAt')) || 0; } catch (e) { /* private mode */ }
        if (Date.now() - lastSeenAt > 5 * 60 * 1000) {
            try { localStorage.setItem('pps.lastSeenAt', String(Date.now())); } catch (e) { /* private mode */ }
            client.from('profiles').upsert(
                { id: user.uid, nick: user.nick, last_seen: new Date().toISOString() },
                { onConflict: 'id' }
            ).then(({ error }) => {
                if (error) console.warn('profile upsert', error);
            });
        }

        subscribePresence();
        subscribeSignals();
        subscribeSignalRows();
        startSignalPoll();
        startAllChatSync();
        relayPrewarm();
        if (state.settings.notifications) initPush();

        clearInterval(state.tokenTimer);
        state.tokenTimer = setInterval(() => {
            if (state.sbJwtExp && Date.now() > state.sbJwtExp - 15 * 60 * 1000) {
                refreshSupabaseToken();
            }
        }, 5 * 60 * 1000);

        if (new URLSearchParams(location.search).get('call')) {
            setTimeout(() => {
                if (!call.incoming && !call.active) showToast('Звонок уже завершён');
            }, 3500);
        }

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

                /* A pending broadcast that never gets a durable row (sender
                   crashed, insert failed silently) must not stay forever. */
                if (payload.pending && payload.row.client_id) {
                    schedulePendingCleanup(payload.fromNick, payload.row.client_id);
                }
            })
            .on('broadcast', { event: 'message-deleted' }, ({ payload }) => {
                handleDeleted(payload);
            })
            .on('broadcast', { event: 'message-failed' }, ({ payload }) => {
                if (payload && payload.clientId) handleDeleted({ clientId: payload.clientId });
            })
            .on('broadcast', { event: 'chat-deleted' }, ({ payload }) => {
                handleChatDeleted(payload);
            })
            .subscribe();
    }

    function subscribeSignalRows() {
        if (!state.sb || !state.sbUid) return;
        if (state.signalRowChannel) {
            try { state.sb.removeChannel(state.signalRowChannel); } catch (e) { /* ignore */ }
        }
        state.signalRowChannel = state.sb
            .channel('signals-' + state.sbUid)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'signals',
                filter: 'to_id=eq.' + state.sbUid,
            }, ({ new: row }) => {
                if (!row || !row.payload) return;
                const payload = row.payload;
                state.sb.from('signals').delete().eq('id', row.id).catch(() => {});
                handleSignal(
                    payload.fromNick || row.from_id,
                    payload.data,
                    row.from_id,
                    payload.sid,
                );
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
        if (!state.sb) return;
        try {
            const chatRecord = state.chats.find((item) => item.nick === peer.nick);
            let uid = peer.uid || (chatRecord && chatRecord.uid) || null;
            let chatId = (chatRecord && chatRecord.chatId) || null;

            /* A fresh uid from search wins over the cached one. If they differ,
               the cached chat belongs to someone else: drop it. */
            if (peer.uid && chatRecord && chatRecord.uid && peer.uid !== chatRecord.uid) {
                chatId = null;
                chatRecord.chatId = null;
                chatRecord.lastTs = '';
                saveChats();
            }

            if (!uid) {
                const { data: profile } = await state.sb
                    .from('profiles')
                    .select('id')
                    .eq('nick', peer.nick)
                    .maybeSingle();
                if (profile && profile.id) uid = profile.id;
            }
            if (uid) {
                peer.uid = uid;
                state.peerUid = uid;
                addChat(peer.nick, uid);
                /* Warm the outgoing sockets so the first message is instant. */
                signalChannelFor(uid).ready.catch(() => {});
                relayConnect(uid);
            }
            if (!uid) {
                $('peer-status').textContent = 'ник не найден';
                return;
            }

            if (!chatId) {
                const { data, error } = await state.sb.rpc('create_direct_chat', { other_id: uid });
                if (error) {
                    console.warn('create_direct_chat', error);
                    $('peer-status').textContent = 'не удалось открыть чат';
                    return;
                }
                chatId = data;
            }

            state.chatId = chatId;
            if (chatRecord) {
                chatRecord.chatId = chatId;
                chatRecord.uid = uid;
                saveChats();
            }

            /* Known chat: ask only for what is new. One request instead of three. */
            let since = (chatRecord && chatRecord.lastTs) || '';
            const local = loadHistory(peer.nick);

            const fetchRows = async (after) => {
                let query = state.sb
                    .from('messages')
                    .select('*')
                    .eq('chat_id', chatId);
                if (after) query = query.gt('created_at', after);
                const { data, error } = await query
                    .order('created_at', { ascending: false })
                    .limit(after ? 100 : 200);
                if (error) console.warn('messages', error);
                return (data || []).filter((row) => !row.deleted_for_all).slice().reverse();
            };

            let rows = await fetchRows(since);

            /* No local base (new device or cleared cache): load the chat
               fresh. If the cached chat is gone, rebuild it first. */
            if (since && !local.length) {
                const { data, error } = await state.sb.rpc('create_direct_chat', { other_id: uid });
                if (!error && data) {
                    if (data !== chatId) {
                        chatId = data;
                        state.chatId = chatId;
                        if (chatRecord) chatRecord.chatId = chatId;
                        saveChats();
                    }
                    since = '';
                    rows = await fetchRows('');
                }
            }

            if (since) {
                if (rows.length) {
                    const mapped = rows.map((row) => rowToMessage(row, peer.nick));
                    saveHistory(peer.nick, mergeMessages(local, mapped));
                    state.chatLastTs = rows[rows.length - 1].created_at;
                    if (!state.chatOldestTs && local.length) {
                        state.chatOldestTs = new Date(local[0].ts).toISOString();
                    }
                } else {
                    state.chatLastTs = since;
                    if (!state.chatOldestTs && local.length) {
                        state.chatOldestTs = new Date(local[0].ts).toISOString();
                    }
                }
            } else {
                const mapped = rows.map((row) => rowToMessage(row, peer.nick));
                state.chatOldestTs = rows.length ? rows[0].created_at : '';
                state.chatLastTs = rows.length
                    ? rows[rows.length - 1].created_at
                    : new Date(0).toISOString();
                const dbIds = new Set(rows.map((row) => row.id));
                const keep = local.filter((message) => {
                    if (message.status === 'sending' || message.status === 'failed') return true;
                    if (!message.dbId) return true;
                    return dbIds.has(message.dbId);
                });
                saveHistory(peer.nick, mergeMessages(keep, mapped));
            }

            if (chatRecord) {
                if (state.chatLastTs) chatRecord.lastTs = state.chatLastTs;
                chatRecord.syncedAt = Date.now();
            }
            saveChats();
            renderMessages();
            renderChats();
            subscribeChat(chatId, peer.nick);
            startChatSync();
        } catch (e) {
            console.warn(e);
            $('peer-status').textContent = 'ошибка чата';
        }
    }

    async function prefetchChat(nick) {
        if (!state.sb || !state.me || !nick || nick === state.me.nick) return;
        if (state.peer === nick) return;
        if (state.prefetching.has(nick)) return;
        if (Date.now() - (state.prefetchSeen.get(nick) || 0) < 60000) return;
        const chat = state.chats.find((item) => item.nick === nick);
        if (!chat) return;
        if (chat.syncedAt && Date.now() - chat.syncedAt < 60000) return;

        state.prefetchSeen.set(nick, Date.now());
        state.prefetching.add(nick);
        try {
            if (!chat.uid) {
                const { data } = await state.sb
                    .from('profiles')
                    .select('id')
                    .eq('nick', nick)
                    .maybeSingle();
                if (data && data.id) {
                    chat.uid = data.id;
                    saveChats();
                }
            }
            if (!chat.uid) return;

            if (!chat.chatId) {
                const { data, error } = await state.sb.rpc('create_direct_chat', { other_id: chat.uid });
                if (error || !data) return;
                chat.chatId = data;
                saveChats();
            }

            const since = chat.lastTs || '';
            let query = state.sb
                .from('messages')
                .select('*')
                .eq('chat_id', chat.chatId);
            if (since) query = query.gt('created_at', since);
            const { data: rows } = await query
                .order('created_at', { ascending: false })
                .limit(since ? 30 : 40);

            if (rows && rows.length) {
                const mapped = rows
                    .filter((row) => !row.deleted_for_all)
                    .slice()
                    .reverse()
                    .map((row) => rowToMessage(row, nick));
                if (mapped.length) {
                    saveHistory(nick, mergeMessages(loadHistory(nick), mapped));
                }
                const newest = rows[0];
                if (newest && newest.created_at && (!chat.lastTs || newest.created_at > chat.lastTs)) {
                    chat.lastTs = newest.created_at;
                }
                saveChats();
                if (state.peer === nick) renderMessages();
                renderChats();
            }
            chat.prefetchedAt = Date.now();
            chat.syncedAt = Date.now();
            saveChats();
        } catch (e) {
            /* prefetch is best-effort */
        } finally {
            state.prefetching.delete(nick);
        }
    }

    function initPrefetch() {
        const list = $('chat-list');
        if (!list) return;

        /* Mobile: preload the chats that scroll into view. */
        if ('IntersectionObserver' in window) {
            state.chatObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const name = entry.target.dataset.nick;
                    if (!name) continue;
                    setTimeout(() => prefetchChat(name), 700);
                }
            }, { root: list, rootMargin: '160px' });
            list.querySelectorAll('.chat-item').forEach((item) => state.chatObserver.observe(item));
        }

        let timer = 0;
        let nick = '';
        list.addEventListener('pointerover', (event) => {
            const item = event.target && event.target.closest
                ? event.target.closest('.chat-item')
                : null;
            if (!item || !item.dataset.nick) return;
            nick = item.dataset.nick;
            if (nick === state.peer) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (nick) prefetchChat(nick);
            }, 180);
        });
        list.addEventListener('pointerout', () => {
            clearTimeout(timer);
            nick = '';
        });
    }

    window.__ppsOpenChat = supabaseOpenChat;

    async function loadOlderMessages() {
        if (!state.sb || !state.chatId || !state.peer || !state.chatOldestTs || state.loadingOlder) return;
        state.loadingOlder = true;
        const box = $('messages');
        const prevHeight = box.scrollHeight;
        const prevTop = box.scrollTop;
        const chatId = state.chatId;
        const peer = state.peer;
        const oldest = state.chatOldestTs;

        try {
            const { data } = await state.sb
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .lt('created_at', oldest)
                .order('created_at', { ascending: false })
                .limit(100);
            const rows = (data || []).filter((row) => !row.deleted_for_all).slice().reverse();
            if (rows.length && state.chatId === chatId && state.peer === peer) {
                state.chatOldestTs = rows[0].created_at;
                const mapped = rows.map((row) => rowToMessage(row, peer));
                saveHistory(peer, mergeMessages(loadHistory(peer), mapped));
                renderMessages();
                box.scrollTop = box.scrollHeight - prevHeight + prevTop;
            }
        } catch (e) {
            /* transient */
        } finally {
            state.loadingOlder = false;
        }
    }

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
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: 'chat_id=eq.' + chatId,
            }, (payload) => {
                if (payload && payload.new) handleIncomingRow(payload.new, peerNick);
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'messages',
                filter: 'chat_id=eq.' + chatId,
            }, (payload) => {
                if (payload && payload.new) handleIncomingRow(payload.new, peerNick);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') supabaseSyncChat();
            });
    }

    function startChatSync() {
        clearInterval(state.syncTimer);
        state.syncTimer = setInterval(supabaseSyncChat, 15000);
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
        const unknown = data
            .map((row) => row.chat_id)
            .filter((chatId) => chatId && !known.has(chatId));
        if (!unknown.length) return;

        /* Two requests for all unknown chats instead of two per chat. */
        const { data: others } = await state.sb
            .from('chat_members')
            .select('chat_id,user_id')
            .in('chat_id', unknown)
            .neq('user_id', state.sbUid);
        const peerByChat = new Map();
        for (const row of others || []) {
            if (!peerByChat.has(row.chat_id)) peerByChat.set(row.chat_id, row.user_id);
        }

        const uids = [...new Set(peerByChat.values())];
        if (!uids.length) return;
        const { data: profiles } = await state.sb
            .from('profiles')
            .select('id,nick')
            .in('id', uids);
        const nickById = new Map((profiles || []).map((row) => [row.id, row.nick]));

        for (const [chatId, uid] of peerByChat) {
            const nick = nickById.get(uid);
            if (!nick || state.hiddenChats[nick]) continue;
            addChat(nick, uid);
            const chat = state.chats.find((item) => item.nick === nick);
            if (chat) chat.chatId = chatId;
        }
        saveChats();
    }
    function startAllChatSync() {
        clearInterval(state.syncAllTimer);
        state.syncAllTimer = setInterval(supabaseSyncAllChats, 30000);
        supabaseSyncAllChats().catch(() => {});
    }

    async function supabaseSyncAllChats() {
        if (!state.sb || !state.me || state.syncAllBusy) return;
        state.syncAllBusy = true;

        try {
            await discoverChats();

            const active = [];
            for (const chat of [...state.chats]) {
                if (!chat.uid || chat.nick === state.me.nick) continue;

                if (!chat.chatId) {
                    const { data, error } = await state.sb.rpc('create_direct_chat', { other_id: chat.uid });
                    if (!error && data) chat.chatId = data;
                }
                if (chat.chatId) active.push(chat);
            }

            if (active.length) {
                const ids = active.map((chat) => chat.chatId);
                const since = active.reduce((min, chat) => {
                    if (!chat.lastTs) return min;
                    return !min || chat.lastTs < min ? chat.lastTs : min;
                }, '');
                const byChat = new Map(active.map((chat) => [chat.chatId, chat]));

                /* One request for all chats instead of N sequential ones. */
                let query = state.sb.from('messages').select('*').in('chat_id', ids);
                if (since) query = query.gt('created_at', since);
                const { data, error } = await query
                    .order('created_at', { ascending: since ? true : false })
                    .limit(300);

                if (!error && data && data.length) {
                    state.batchSync = true;
                    try {
                        for (const row of data) {
                            const chat = byChat.get(row.chat_id);
                            if (!chat) continue;
                            if (row.created_at && (!chat.lastTs || row.created_at > chat.lastTs)) {
                                chat.lastTs = row.created_at;
                            }
                            handleIncomingRow(row, chat.nick);
                        }
                    } finally {
                        state.batchSync = false;
                    }
                    renderChats();
                    if (state.peer) renderMessages();
                }

                /* Empty chats should not force a full re-fetch every 30 s. */
                if (!error) {
                    const nowIso = new Date().toISOString();
                    const syncedAt = Date.now();
                    for (const chat of active) {
                        if (!chat.lastTs) chat.lastTs = nowIso;
                        chat.syncedAt = syncedAt;
                    }
                }
            }
            saveChats();
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
            const chat = state.chats.find((item) => item.nick === peerNick);
            if (chat && row.created_at && (!chat.lastTs || row.created_at > chat.lastTs)) {
                chat.lastTs = row.created_at;
            }
            if (peerNick === state.peer && row.created_at && (!state.chatLastTs || row.created_at > state.chatLastTs)) {
                state.chatLastTs = row.created_at;
            }
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
                if (!state.batchSync && state.peer === peerNick) renderMessages();
            }
            return;
        }

        const message = rowToMessage(row, peerNick);
        const existing = list.find((item) => item.id === message.id);
        let isNew = false;
        if (existing) {
            existing.ts = Date.parse(row.created_at) || existing.ts;
            existing.text = row.body || existing.text;
            if (row.id) existing.dbId = row.id;
            existing.status = 'sent';
            saveHistory(peerNick, list);
        } else {
            list.push(message);
            saveHistory(peerNick, list.sort((a, b) => a.ts - b.ts));
            isNew = true;
        }
        if (state.peer === peerNick) {
            if (!state.batchSync) renderMessages();
        } else if (isNew) {
            state.unread.set(peerNick, (state.unread.get(peerNick) || 0) + 1);
            if (!state.batchSync && message.from !== state.me.nick && !callLogInfo(message.text)) {
                notify('pps · ' + peerNick, previewText(message.text), 'msg-' + peerNick, peerNick);
                if (document.visibilityState !== 'visible' || !document.hasFocus()) beep(520, 0.07);
            }
        }
        if (!state.batchSync) renderChats();
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
        if (state.sbJwtExp) {
            const left = state.sbJwtExp - Date.now();
            /* Never block a message on an Apps Script call: refresh in the
               background while the current token is still valid. */
            if (left < 0) await refreshSupabaseToken();
            else if (left < 60 * 1000) refreshSupabaseToken().catch(() => {});
        }
        await testDelay();
        if (!state.sb || !state.chatId) {
            message.status = 'failed';
            saveHistory(state.peer, loadHistory(state.peer));
            renderMessages();
            return;
        }

        message.status = 'sending';
        saveHistory(state.peer, loadHistory(state.peer));
        renderMessages();

        /* Turbo path: the recipient sees the message over the already-open
           socket while the durable row is being written. If the write fails,
           message-failed removes it on the other side. */
        const relayed = relaySend(message);
        if (!relayed && state.peerUid) {
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
                pending: true,
            }).catch(() => {});
        }

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

        if (error && !message.retried && (error.code === '42501' || error.code === '23503') && state.peerUid) {
            message.retried = true;
            const { data: fresh } = await state.sb.rpc('create_direct_chat', { other_id: state.peerUid });
            if (fresh) {
                state.chatId = fresh;
                const chat = state.chats.find((item) => item.nick === state.peer);
                if (chat) {
                    chat.chatId = fresh;
                    chat.lastTs = '';
                    saveChats();
                }
                return supabaseSend(message);
            }
        }

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
            if (state.peerUid) {
                sendUserEvent(state.peerUid, 'message-failed', {
                    clientId: message.id,
                    fromNick: state.me.nick,
                }).catch(() => {});
            }
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

    function schedulePendingCleanup(nick, clientId) {
        if (!nick || !clientId) return;
        setTimeout(() => {
            const list = loadHistory(nick);
            const pending = list.find((message) => message.id === clientId);
            if (!pending || pending.dbId) return;
            saveHistory(nick, list.filter((message) => message.id !== clientId));
            if (state.peer === nick) renderMessages();
            else if (state.unread.get(nick)) {
                state.unread.set(nick, Math.max(0, state.unread.get(nick) - 1));
            }
            renderChats();
        }, 15000);
    }

    function relayEnabled() {
        return !!(window.PPS_RELAY_URL && state.sbJwt && state.sbUid);
    }

    /* Warm DNS + TLS to the edge before the first chat is opened. */
    function relayPrewarm() {
        if (!window.PPS_RELAY_URL || !state.sbJwt) return;
        const base = String(window.PPS_RELAY_URL)
            .replace(/^ws/, 'http')
            .replace(/\/+$/, '');
        fetch(base + '/?cb=' + Math.random(), {
            cache: 'no-store',
            mode: 'no-cors',
        }).catch(() => {});
    }

    function relayClose() {
        if (state.relay) {
            try { state.relay.close(); } catch (e) { /* ignore */ }
        }
        state.relay = null;
        state.relayPeer = '';
        state.relayReady = false;
        state.relayQueue = [];
    }

    function relayConnect(peerUid) {
        if (!relayEnabled() || !peerUid) return;
        if (state.relay && state.relayPeer === peerUid && state.relay.readyState <= 1) return;
        if (state.relayPeer !== peerUid) state.relayRetry = 0;
        relayClose();

        const base = String(window.PPS_RELAY_URL).replace(/\/+$/, '');
        const url = base + '/ws?token=' + encodeURIComponent(state.sbJwt) +
            '&peer=' + encodeURIComponent(peerUid);
        let socket;
        try { socket = new WebSocket(url); } catch (e) { return; }

        state.relay = socket;
        state.relayPeer = peerUid;

        socket.onopen = () => {
            state.relayReady = true;
            state.relayRetry = 0;
            const queue = state.relayQueue.splice(0);
            for (const item of queue) {
                try { socket.send(item); } catch (e) { /* ignore */ }
            }
        };
        socket.onclose = () => {
            if (state.relay === socket) {
                state.relayReady = false;
                state.relay = null;
                /* A cold edge or a network blip should not kill the relay. */
                if (state.relayPeer === peerUid && state.relayRetry < 3) {
                    const attempt = state.relayRetry + 1;
                    state.relayRetry = attempt;
                    setTimeout(() => {
                        if (state.relayPeer === peerUid && !state.relay) relayConnect(peerUid);
                    }, 800 * attempt);
                }
            }
        };
        socket.onerror = () => {
            if (state.relay === socket) state.relayReady = false;
        };
        socket.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch (e) { return; }
            if (!data || !data.clientId) return;

            if (data.type === 'msg') {
                const nick = data.fromNick || state.peer;
                if (!nick || !data.fromUid) return;
                if (!state.chats.some((chat) => chat.nick === nick)) addChat(nick, data.fromUid);
                handleIncomingRow({
                    id: null,
                    sender_id: data.fromUid,
                    body: String(data.body || '').slice(0, 8000),
                    client_id: data.clientId,
                    created_at: data.createdAt || new Date().toISOString(),
                }, nick);
                schedulePendingCleanup(nick, data.clientId);
            } else if (data.type === 'failed') {
                handleDeleted({ clientId: data.clientId });
            }
        };
    }

    function relaySend(message) {
        if (!relayEnabled() || !state.relay) return false;
        const payload = JSON.stringify({
            type: 'msg',
            clientId: message.id,
            body: message.text,
            createdAt: serverNowIso(),
        });
        if (state.relay.readyState === 1) {
            try {
                state.relay.send(payload);
                return true;
            } catch (e) {
                return false;
            }
        }
        state.relayQueue.push(payload);
        return true;
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
        await testDelay();
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
        state.signalPollTimer = setInterval(pollSignals, 5000);
    }

    async function pollSignals() {
        if (document.hidden) return;
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
        if (state.sbJwtExp && Date.now() > state.sbJwtExp - 60 * 1000) {
            await refreshSupabaseToken();
        }
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
        relayClose();
        if (state.presenceChannel && state.sb) {
            try { state.sb.removeChannel(state.presenceChannel); } catch (e) { /* ignore */ }
        }
        if (state.chatChannel && state.sb) {
            try { state.sb.removeChannel(state.chatChannel); } catch (e) { /* ignore */ }
        }
        if (state.signalRowChannel && state.sb) {
            try { state.sb.removeChannel(state.signalRowChannel); } catch (e) { /* ignore */ }
        }
        localStorage.removeItem('nkse-session');
        localStorage.removeItem(LS.user);
        localStorage.removeItem(LS.token);
        localStorage.removeItem('pps.sbJwt');
        localStorage.removeItem('pps.chatsOwner');
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
