(function () {
    'use strict';

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
        signalChannel: null,
        signalOut: new Map(),
        sb: null,
        sbJwt: '',
        sbUid: '',
        chatMeta: readJson('pps.chatmeta', {}) || {},
        hiddenChats: readJson('pps.hidden', {}) || {},
        settings: (function () {
            const saved = readJson('pps.settings', null) || {};
            const defaults = {
                notifications: false,
                dnd: false,
                silent: true,
                contactsOnly: false,
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
        callStartedAt: 0,
        chatLastTs: '',
        messages: new Map(),
        online: new Set(),
        unread: new Map(),
        search: [],
        searchTimer: 0,
        authMode: 'login',
        retry: 0,
        call: null,
        pendingCall: null,
    };

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

    function setConn(on) {
        const dot = $('conn-dot');
        if (dot) dot.classList.toggle('on', !!on);
        const side = $('conn-dot-side');
        if (side) side.classList.toggle('on', !!on);
    }

    function showAuth(message) {
        $('auth-modal').hidden = false;
        if (message) {
            $('auth-error').textContent = message;
            $('auth-error').hidden = false;
        }
        setTimeout(() => $('auth-nick').focus(), 30);
    }

    function hideAuth() {
        $('auth-modal').hidden = true;
        $('auth-error').hidden = true;
    }

    function setMe(user) {
        state.me = user;
        state.sbUid = user.uid || state.sbUid;
        writeJson(LS.user, user);
        $('me-bar').hidden = false;
        $('me-nick').textContent = user.nick;
        $('me-status').textContent = 'в сети';
        $('me-avatar').textContent = initial(user.nick);
        $('logout-btn').hidden = true;
        paintAvatar($('settings-avatar'), user.nick);
        $('settings-nick').textContent = user.nick;
        $('settings-status').textContent = 'в сети';
        $('search').disabled = false;
        $('peer-count').textContent = state.online.size + ' онлайн';
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
    }

    function notify(title, body, tag) {
        if (!state.settings.notifications || state.settings.dnd) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        if (document.visibilityState === 'visible' && document.hasFocus()) return;
        try {
            new Notification(title, { body, tag, icon: '../library/icon.svg' });
        } catch (e) { /* ignore */ }
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
        };
        ring();
        state.ringTimer = setInterval(ring, 1600);
    }

    function stopRing() {
        if (state.ringTimer) clearInterval(state.ringTimer);
        state.ringTimer = 0;
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

    function chatAction(action) {
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
            if (confirm('Удалить чат «' + nick + '»? История на этом устройстве исчезнет.')) {
                state.chats = state.chats.filter((chat) => chat.nick !== nick);
                writeJson(LS.chats, state.chats);
                localStorage.removeItem(historyKey(nick));
                state.messages.delete(nick);
                delete state.chatMeta[nick];
                hideChat(nick);
                saveChatMeta();
                state.unread.delete(nick);

                clearInterval(state.syncTimer);
                if (state.chatChannel && state.sb) {
                    try { state.sb.removeChannel(state.chatChannel); } catch (e) { /* ignore */ }
                }
                state.chatChannel = null;
                state.chatId = null;
                state.chatLastTs = '';
                state.peer = null;
                state.peerUid = null;

                $('chat-view').hidden = true;
                $('empty').hidden = false;
                $('messages').replaceChildren();
                $('app').classList.remove('show-chat');
                renderChats();
            }
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
        $('peer-status').textContent = isOnline(target.nick) ? 'в сети' : 'не в сети';
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
            preview.textContent = last ? last.text : (isOnline(nick) ? 'в сети' : 'нет сообщений');
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

        $('peer-count').textContent = state.online.size + ' онлайн';
    }

    function lastMessage(nick) {
        const list = state.messages.get(nick) || [];
        return list.length ? list[list.length - 1] : null;
    }

    function renderPresence() {
        renderChats();
        if (state.peer) $('peer-status').textContent = isOnline(state.peer) ? 'в сети' : 'не в сети';
        if (!$('search-results').hidden) renderSearch();
        $('peer-count').textContent = state.online.size + ' онлайн';
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

            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            bubble.textContent = message.text;

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
                status.className = 'status';
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

    function submitMessage(event) {
        event.preventDefault();
        const input = $('text');
        const text = input.value.trim();
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
        input.value = '';
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

    /* -------------------------------------------------------------- search */

    function onSearch() {
        clearTimeout(state.searchTimer);
        const query = $('search').value.trim();
        if (!query) {
            $('search-results').hidden = true;
            return;
        }
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
            empty.textContent = 'Никто не найден';
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
            status.textContent = user.online ? 'в сети' : 'не в сети';

            button.append(avatar, name, status);
            button.addEventListener('click', () => openChat({ nick: user.nick, uid: user.uid }));
            box.append(button);
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
        $('remote-video').volume = 1;
        $('remote-video').muted = false;
        setCallStatus(incoming ? 'входящий звонок' : 'звоним…');

        if (incoming) {
            startRing();
            notify('Входящий звонок', peer, 'call-' + peer);
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
            $('remote-video').srcObject = event.streams[0];
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

        $('qr-btn').addEventListener('click', openQr);
        $('empty-qr').addEventListener('click', openQr);
        $('empty-search').addEventListener('click', () => {
            $('search').focus();
            $('search').select();
        });
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

        document.querySelectorAll('.tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                state.authMode = tab.dataset.mode;
                document.querySelectorAll('.tab').forEach((t) => {
                    const active = t === tab;
                    t.classList.toggle('is-active', active);
                    t.setAttribute('aria-selected', String(active));
                });
                $('auth-submit').textContent = state.authMode === 'login' ? 'Войти' : 'Создать аккаунт';
                $('auth-pass').autocomplete = state.authMode === 'login' ? 'current-password' : 'new-password';
            });
        });

        $('auth-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const nick = $('auth-nick').value.trim();
            const password = $('auth-pass').value;
            $('auth-error').hidden = true;
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
        $('back-btn').addEventListener('click', closeChat);
        $('messages').addEventListener('scroll', updateScrollButton);
        $('scroll-bottom').addEventListener('click', () => {
            $('messages').scrollTop = $('messages').scrollHeight;
            updateScrollButton();
        });

        document.addEventListener('keydown', (event) => {
            const tag = document.activeElement && document.activeElement.tagName;
            const typing = tag === 'INPUT' || tag === 'TEXTAREA';
            if (event.key === '/' && !typing) {
                event.preventDefault();
                $('search').focus();
            }
            if (event.key === 'Escape') {
                if (!$('settings-modal').hidden) $('settings-modal').hidden = true;
                else if (!$('qr-modal').hidden) $('qr-modal').hidden = true;
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
            $('remote-video').volume = value;
            $('remote-video').muted = value === 0;
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
            Object.keys(snapshot).forEach((key) => {
                for (const entry of snapshot[key] || []) {
                    if (entry && entry.nick && entry.uid !== state.sbUid) {
                        next.add(String(entry.nick).toLowerCase());
                    }
                }
            });
            state.online = next;
            renderPresence();
        });

        channel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await channel.track({ uid: state.sbUid, nick: state.me.nick });
            }
        });

        state.presenceChannel = channel;
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
            renderSearch();
            return;
        }
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
                .select('id,sender_id,body,client_id,created_at')
                .eq('chat_id', chatId)
                .order('created_at', { ascending: true })
                .limit(200);
            if (loadError) console.warn('messages', loadError);

            const mapped = (rows || []).map((row) => rowToMessage(row, peer.nick));
            state.chatLastTs = rows && rows.length
                ? rows[rows.length - 1].created_at
                : new Date(0).toISOString();
            if (chatRecord && state.chatLastTs) chatRecord.lastTs = state.chatLastTs;
            saveHistory(peer.nick, mergeMessages(loadHistory(peer.nick), mapped));
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
                .select('id,sender_id,body,client_id,created_at')
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
                    .select('id,sender_id,body,client_id,created_at')
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
                notify('pps · ' + peerNick, message.text, 'msg-' + peerNick);
                if (document.visibilityState !== 'visible' || !document.hasFocus()) beep(520, 0.07);
            }
        }
        renderChats();
    }

    function rowToMessage(row, peerNick) {
        const own = row.sender_id === state.sbUid;
        return {
            id: row.client_id || row.id,
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
            .select('id,sender_id,body,client_id,created_at')
            .single();

        message.status = error ? 'failed' : 'sent';
        if (error) console.warn('send message', error);
        if (!error && data) {
            message.ts = Date.parse(data.created_at) || message.ts;
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
            await state.sb.rpc('send_signal', { p_to: uid, p_payload: payload });
        } catch (e) {
            /* SQL bridge may not be installed yet; Broadcast already tried. */
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
