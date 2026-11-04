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
            .map((chat) => (typeof chat === 'string' ? { nick: chat, uid: null } : chat))
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
        state.messages.set(nick, list.slice(-300));
        writeJson(historyKey(nick), state.messages.get(nick));
    }

    /* --------------------------------------------------------------- utils */

    const esc = (value) => String(value == null ? '' : value);
    const initial = (nick) => esc(nick).trim().charAt(0).toUpperCase() || '?';
    const isOnline = (nick) => state.online.has(String(nick).toLowerCase());

    function fmtTime(ts) {
        try {
            return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    function newId() {
        return (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(16).slice(2));
    }

    function send(payload) {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify(payload));
            return true;
        }
        return false;
    }

    function setConn(on) {
        $('conn-dot').classList.toggle('on', !!on);
        $('conn-dot').title = on ? 'соединение есть' : 'нет соединения';
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
        $('logout-btn').hidden = false;
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
        state.chats.push({ nick, uid: uid || null });
        writeJson(LS.chats, state.chats);
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

        addChat(target.nick, target.uid);
        state.peer = target.nick;
        state.peerUid = target.uid || null;
        state.unread.delete(target.nick);
        state.chatId = null;
        $('chat-view').hidden = false;
        $('empty').hidden = true;
        $('peer-nick').textContent = target.nick;
        $('peer-avatar').textContent = initial(target.nick);
        $('peer-status').textContent = isOnline(target.nick) ? 'в сети' : 'не в сети';
        $('app').classList.add('show-chat');
        $('search').value = '';
        $('search-results').hidden = true;
        loadHistory(target.nick);
        renderMessages();
        renderChats();

        if (USE_SUPABASE) {
            supabaseOpenChat(target);
        } else {
            send({ type: 'history', with: target.nick });
        }
        setTimeout(() => $('text').focus(), 40);
    }

    function closeChat() {
        $('app').classList.remove('show-chat');
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
            avatar.textContent = initial(nick);

            const meta = document.createElement('span');
            meta.className = 'meta';
            const name = document.createElement('b');
            name.textContent = nick;
            const preview = document.createElement('small');
            const last = lastMessage(nick);
            preview.textContent = last ? last.text : (isOnline(nick) ? 'в сети' : 'нет сообщений');
            meta.append(name, preview);

            button.append(avatar, meta);

            if (state.unread.get(nick)) {
                const dot = document.createElement('span');
                dot.className = 'unread';
                button.append(dot);
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
        box.replaceChildren();
        for (const message of loadHistory(state.peer)) {
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

            row.append(bubble, time);
            box.append(row);
        }
        box.scrollTop = box.scrollHeight;
    }

    function submitMessage(event) {
        event.preventDefault();
        const input = $('text');
        const text = input.value.trim();
        if (!text || !state.peer) return;

        const message = {
            id: newId(),
            from: state.me.nick,
            to: state.peer,
            text,
            ts: Date.now(),
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
            avatar.textContent = initial(user.nick);

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
        ],
    };

    function setCallStatus(text) {
        $('call-status').textContent = text;
    }

    function showCall(peer, media, incoming) {
        call.peer = peer;
        call.media = media;
        call.incoming = incoming || null;
        call.active = false;
        $('call-nick').textContent = peer;
        $('call-avatar').textContent = initial(peer);
        $('call-modal').hidden = false;
        $('videos').classList.toggle('on', media === 'video');
        $('call-accept').hidden = !incoming;
        $('call-reject').hidden = !incoming;
        $('call-hangup').hidden = !!incoming;
        $('call-mute').hidden = !!incoming;
        setCallStatus(incoming ? 'входящий звонок' : 'звоним…');
    }

    async function mediaFor(media) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Браузер не поддерживает звонки');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: media === 'video',
        });
        call.local = stream;
        $('local-video').srcObject = stream;
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
            if (pc.connectionState === 'connected') setCallStatus('в звонке');
            if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
                if (pc.connectionState === 'failed') setCallStatus('связь потеряна');
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
        } catch (e) {
            setCallStatus(e.message || 'нет доступа к камере/микрофону');
            setTimeout(endCall, 1200);
        }
    }

    async function acceptCall() {
        if (!call.incoming) return;
        call.active = true;
        $('call-accept').hidden = true;
        $('call-reject').hidden = true;
        $('call-hangup').hidden = false;
        $('call-mute').hidden = false;
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
            setTimeout(endCall, 1200);
        }
    }

    function rejectCall() {
        if (call.incoming) signal({ kind: 'reject' });
        cleanupCall();
    }

    function endCall() {
        if (call.pc) signal({ kind: 'end' });
        cleanupCall();
    }

    function cleanupCall() {
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
        state.pendingCall = null;
        $('local-video').srcObject = null;
        $('remote-video').srcObject = null;
        $('call-modal').hidden = true;
    }

    async function handleSignal(from, data, fromUid) {
        if (!data || !from) return;

        if (data.kind === 'offer') {
            if (call.active) {
                sendSignalReject(from, fromUid);
                return;
            }
            state.peerUid = fromUid || state.peerUid;
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
            if (call.peer === from) cleanupCall();
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

        $('qr-btn').addEventListener('click', openQr);
        $('empty-qr').addEventListener('click', openQr);
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
            $('call-mute').textContent = audio.enabled ? 'Микрофон' : 'Включить звук';
        });

        window.addEventListener('beforeunload', () => {
            if (call.active) signal({ kind: 'end' });
        });
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
            return JSON.parse(atob(padded));
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
        return response.json();
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
            showAuth('Не удалось связаться с сервером регистрации. Попробуй позже.');
        }
    }

    async function exchangeSession(token) {
        const data = await appsScriptCall({ board: 'auth', op: 'supabase', token });
        if (!data || !data.ok || !data.token) {
            throw new Error((data && data.error) || 'supabase token missing');
        }
        const payload = decodeJwt(data.token);
        const uid = payload.sub || (data.user && data.user.uid);
        const nick = payload.nick || (data.user && data.user.nick);
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

        const { error } = await client.from('profiles').upsert(
            { id: user.uid, nick: user.nick, last_seen: new Date().toISOString() },
            { onConflict: 'id' }
        );
        if (error) console.warn('profile upsert', error);

        for (const chat of state.chats) loadHistory(chat.nick);
        renderChats();
        subscribePresence();
        subscribeSignals();

        const add = new URLSearchParams(location.search).get('add');
        if (add) openChat({ nick: add, uid: null });
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
                handleSignal(payload.fromNick || payload.fromUid, payload.data, payload.fromUid);
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
        if (!state.sb) return;
        try {
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
            const { data: rows, error: loadError } = await state.sb
                .from('messages')
                .select('id,sender_id,body,client_id,created_at')
                .eq('chat_id', chatId)
                .order('created_at', { ascending: true })
                .limit(200);
            if (loadError) console.warn('messages', loadError);

            const mapped = (rows || []).map((row) => rowToMessage(row, peer.nick));
            saveHistory(peer.nick, mergeMessages(loadHistory(peer.nick), mapped));
            renderMessages();
            renderChats();
            subscribeChat(chatId, peer.nick);
        } catch (e) {
            console.warn(e);
            $('peer-status').textContent = 'ошибка чата';
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
            .subscribe();
    }

    function handleIncomingRow(row, peerNick) {
        const list = loadHistory(peerNick);

        if (row.sender_id === state.sbUid) {
            const found = list.find((message) => message.id === (row.client_id || row.id));
            if (found) {
                found.status = 'sent';
                saveHistory(peerNick, list);
                if (state.peer === peerNick) renderMessages();
            }
            return;
        }

        const message = rowToMessage(row, peerNick);
        if (!list.some((item) => item.id === message.id)) {
            list.push(message);
            saveHistory(peerNick, list.sort((a, b) => a.ts - b.ts));
        }
        if (state.peer === peerNick) renderMessages();
        else state.unread.set(peerNick, (state.unread.get(peerNick) || 0) + 1);
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
        if (!error && data && state.chatChannel) {
            state.chatChannel
                .send({ type: 'broadcast', event: 'message', payload: data })
                .catch(() => {});
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

    async function sendSignalTo(uid, data) {
        if (!state.sb || !uid) return;
        const { channel, ready } = signalChannelFor(uid);
        await ready;
        await channel.send({
            type: 'broadcast',
            event: 'signal',
            payload: { fromUid: state.sbUid, fromNick: state.me.nick, data },
        });
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
