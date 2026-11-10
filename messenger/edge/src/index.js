/*
 * pps edge relay — Cloudflare Worker + Durable Object.
 *
 * Purpose: deliver a message to the other participant at the nearest
 * Cloudflare edge instead of waiting for a round trip to the Supabase region.
 * Supabase stays the source of truth: the client still writes the durable row.
 *
 * Security: every WebSocket must carry a valid Supabase JWT (HS256).
 * The JWT secret is stored as a Worker secret, never in this file.
 */

function b64url(value) {
    const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
    const base64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/*
 * Validate the token through Supabase itself instead of storing the JWT
 * secret in the Worker. PostgREST accepts only tokens signed by the project,
 * so a 200/206 from a protected table means the token is genuine.
 */
async function validateToken(token, env) {
    if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    let payload;
    try {
        payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
    } catch (e) {
        return null;
    }
    if (!payload || !payload.sub) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    try {
        const response = await fetch(
            env.SUPABASE_URL + '/rest/v1/profiles?select=id&limit=1',
            {
                headers: {
                    apikey: env.SUPABASE_ANON_KEY,
                    Authorization: 'Bearer ' + token,
                },
                signal: AbortSignal.timeout(5000),
            },
        );
        if (response.status !== 200 && response.status !== 206) return null;
        await response.text();
    } catch (e) {
        return null;
    }

    return payload;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const cors = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }
        if (url.pathname === '/') {
            return new Response('pps relay ok', { status: 200, headers: cors });
        }
        if (url.pathname !== '/ws') {
            return new Response('not found', { status: 404, headers: cors });
        }

        const token = url.searchParams.get('token') || '';
        const peer = url.searchParams.get('peer') || '';
        const payload = await validateToken(token, env);
        if (!payload || !peer || peer === payload.sub) {
            return new Response('unauthorized', { status: 401 });
        }

        const pair = [payload.sub, peer].sort().join(':');
        const id = env.CHAT_ROOM.idFromName(pair);
        const stub = env.CHAT_ROOM.get(id);

        const headers = new Headers(request.headers);
        headers.set('X-Uid', payload.sub);
        headers.set('X-Nick', encodeURIComponent(payload.nick || ''));
        headers.set('X-Pair', pair);

        return stub.fetch(new Request('https://relay/room', { headers }));
    },
};

export class ChatRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request) {
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('expected websocket', { status: 426 });
        }

        const uid = request.headers.get('X-Uid') || '';
        const nick = decodeURIComponent(request.headers.get('X-Nick') || '');
        const pair = request.headers.get('X-Pair') || '';
        if (!uid) return new Response('unauthorized', { status: 401 });

        const [client, server] = Object.values(new WebSocketPair());
        this.state.acceptWebSocket(server);
        server.serializeAttachment({ uid, nick, pair, rate: { at: Date.now(), count: 0 } });
        try {
            server.send(JSON.stringify({ type: 'ready' }));
        } catch (e) {
            /* ignore */
        }
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws, raw) {
        const meta = ws.deserializeAttachment();
        if (!meta || !meta.uid) return;

        const now = Date.now();
        let rate = meta.rate || { at: now, count: 0 };
        if (now - rate.at > 10000) rate = { at: now, count: 0 };
        rate.count += 1;
        ws.serializeAttachment({ ...meta, rate });
        if (rate.count > 60) return;

        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            return;
        }
        if (!data || !data.clientId) return;

        const clientId = String(data.clientId).slice(0, 80);
        if (data.type === 'msg') {
            const body = String(data.body || '').slice(0, 8000);
            if (!body) return;
            this.broadcast(JSON.stringify({
                type: 'msg',
                fromUid: meta.uid,
                fromNick: meta.nick,
                clientId,
                body,
                createdAt: data.createdAt || new Date().toISOString(),
            }));
        } else if (data.type === 'failed') {
            this.broadcast(JSON.stringify({
                type: 'failed',
                fromUid: meta.uid,
                clientId,
            }));
        }
    }

    broadcast(payload) {
        for (const socket of this.state.getWebSockets()) {
            try {
                socket.send(payload);
            } catch (e) {
                /* ignore broken sockets */
            }
        }
    }

    async webSocketClose(ws) {
        try { ws.close(); } catch (e) { /* ignore */ }
    }

    async webSocketError(ws) {
        try { ws.close(); } catch (e) { /* ignore */ }
    }
}
