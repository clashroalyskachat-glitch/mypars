/*
 * pps messenger — local development server.
 *
 * Serves the repository statically and exposes /ws for chat, presence and
 * WebRTC signalling. This is a dev-only backend: users and history live in
 * memory and disappear on restart. Production must use a real service
 * (Supabase Realtime / Firebase RTDB) or the future pps relay.
 *
 *   node messenger/dev-server.mjs
 *   http://127.0.0.1:8091/messenger/
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.PPS_PORT || 8091);
const NICK_RE = /^[A-Za-zА-Яа-яЁё0-9_-]{3,20}$/;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
};

const users = new Map();       // nickKey -> { nick, salt, hash, uid }
const sessions = new Map();    // token -> nickKey
const online = new Map();      // nickKey -> Set<ws>
const history = new Map();     // "a|b" -> message[]
const authHits = new Map();    // ip -> number[] (ms)

/* ------------------------------------------------------------------ helpers */

const nickKey = (nick) => nick.toLocaleLowerCase('ru');
const now = () => Date.now();
const uid = () => 'u-' + crypto.randomBytes(8).toString('hex');
const token = () => crypto.randomBytes(32).toString('hex');

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 32).toString('hex');
}

function checkPassword(user, password) {
    const actual = Buffer.from(hashPassword(password, user.salt), 'hex');
    const expected = Buffer.from(user.hash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function send(ws, payload) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function authRate(ip) {
    const t = now();
    const hits = (authHits.get(ip) || []).filter((x) => t - x < 60_000);
    hits.push(t);
    authHits.set(ip, hits);
    return hits.length <= 30;
}

function historyKey(a, b) {
    return [nickKey(a), nickKey(b)].sort().join('|');
}

function addHistory(message) {
    const key = historyKey(message.from, message.to);
    const list = history.get(key) || [];
    list.push(message);
    if (list.length > 300) list.splice(0, list.length - 300);
    history.set(key, list);
}

function setOnline(nick, ws) {
    const key = nickKey(nick);
    const set = online.get(key) || new Set();
    set.add(ws);
    online.set(key, set);
    broadcast({ type: 'presence', nick, online: true });
}

function setOffline(nick, ws) {
    const key = nickKey(nick);
    const set = online.get(key);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
        online.delete(key);
        broadcast({ type: 'presence', nick, online: false });
    }
}

function isOnline(nick) {
    return (online.get(nickKey(nick)) || new Set()).size > 0;
}

function socketsOf(nick) {
    return [...(online.get(nickKey(nick)) || new Set())];
}

function broadcast(payload) {
    for (const set of online.values()) {
        for (const ws of set) send(ws, payload);
    }
}

function publicUser(user) {
    return { nick: user.nick, uid: user.uid, online: isOnline(user.nick) };
}

/* --------------------------------------------------------------- static --- */

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/') {
        res.writeHead(302, { Location: '/messenger/' });
        res.end();
        return;
    }

    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    const file = path.resolve(ROOT, '.' + rel);
    if (!file.startsWith(ROOT + path.sep)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
    }

    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(data);
    });
});

/* ------------------------------------------------------------------- ws --- */

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
    ws.nick = null;
    ws.isAlive = true;
    const ip = req.socket.remoteAddress || 'unknown';

    const welcome = () => {
        send(ws, {
            type: 'welcome',
            users: [...users.values()].map(publicUser),
        });
    };

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(String(raw));
        } catch {
            return send(ws, { type: 'error', error: 'bad_json' });
        }

        switch (msg.type) {
            case 'register': {
                if (!authRate(ip)) return send(ws, { type: 'auth', ok: false, error: 'too_many' });
                const nick = String(msg.nick || '').trim();
                const password = String(msg.password || '');
                if (!NICK_RE.test(nick)) return send(ws, { type: 'auth', ok: false, error: 'bad_nick' });
                if (password.length < 6 || password.length > 100) {
                    return send(ws, { type: 'auth', ok: false, error: 'bad_pass' });
                }
                if (users.has(nickKey(nick))) {
                    return send(ws, { type: 'auth', ok: false, error: 'nick_taken' });
                }
                const salt = crypto.randomBytes(16).toString('hex');
                const user = { nick, salt, hash: hashPassword(password, salt), uid: uid() };
                users.set(nickKey(nick), user);
                const session = token();
                sessions.set(session, nickKey(nick));
                ws.nick = nick;
                setOnline(nick, ws);
                send(ws, { type: 'auth', ok: true, token: session, user: { nick, uid: user.uid } });
                welcome();
                break;
            }

            case 'login': {
                if (!authRate(ip)) return send(ws, { type: 'auth', ok: false, error: 'too_many' });
                const nick = String(msg.nick || '').trim();
                const password = String(msg.password || '');
                const user = users.get(nickKey(nick));
                if (!user || !checkPassword(user, password)) {
                    return send(ws, { type: 'auth', ok: false, error: 'wrong_pass' });
                }
                const session = token();
                sessions.set(session, nickKey(nick));
                ws.nick = user.nick;
                setOnline(user.nick, ws);
                send(ws, { type: 'auth', ok: true, token: session, user: { nick: user.nick, uid: user.uid } });
                welcome();
                break;
            }

            case 'resume': {
                const key = sessions.get(String(msg.token || ''));
                const user = key && users.get(key);
                if (!user) return send(ws, { type: 'auth', ok: false, error: 'no_session' });
                ws.nick = user.nick;
                setOnline(user.nick, ws);
                send(ws, { type: 'auth', ok: true, token: msg.token, user: { nick: user.nick, uid: user.uid } });
                welcome();
                break;
            }

            case 'search': {
                if (!ws.nick) return;
                const query = String(msg.query || '').trim().toLocaleLowerCase('ru');
                const result = [...users.values()]
                    .filter((u) => !query || u.nick.toLocaleLowerCase('ru').includes(query))
                    .slice(0, 20)
                    .map(publicUser);
                send(ws, { type: 'search', query: msg.query, users: result });
                break;
            }

            case 'history': {
                if (!ws.nick) return;
                const withNick = String(msg.with || '').trim();
                if (!users.has(nickKey(withNick))) return;
                send(ws, {
                    type: 'history',
                    with: withNick,
                    messages: history.get(historyKey(ws.nick, withNick)) || [],
                });
                break;
            }

            case 'message': {
                if (!ws.nick) return;
                const to = String(msg.to || '').trim();
                const text = String(msg.text || '').trim();
                if (!users.has(nickKey(to)) || !text || text.length > 4000) return;
                const message = {
                    id: String(msg.id || crypto.randomUUID()),
                    from: ws.nick,
                    to: users.get(nickKey(to)).nick,
                    text,
                    ts: now(),
                };
                addHistory(message);
                send(ws, { type: 'ack', id: message.id, ts: message.ts });
                for (const target of socketsOf(message.to)) send(target, { type: 'message', message });
                break;
            }

            case 'signal': {
                if (!ws.nick) return;
                const to = String(msg.to || '').trim();
                if (!users.has(nickKey(to))) return send(ws, { type: 'signal-error', to, error: 'no_user' });
                if (!isOnline(to)) return send(ws, { type: 'signal-error', to, error: 'offline' });
                for (const target of socketsOf(to)) {
                    send(target, { type: 'signal', from: ws.nick, data: msg.data });
                }
                break;
            }

            default:
                send(ws, { type: 'error', error: 'unknown_type' });
        }
    });

    ws.on('close', () => {
        if (ws.nick) setOffline(ws.nick, ws);
    });
});

setInterval(() => {
    for (const ws of wss.clients) {
        if (!ws.isAlive) {
            ws.terminate();
            continue;
        }
        ws.isAlive = false;
        ws.ping();
    }
}, 30_000).unref();

server.listen(PORT, () => {
    console.log(`pps messenger dev: http://127.0.0.1:${PORT}/messenger/`);
    console.log('dev backend: in-memory, no persistence');
});
