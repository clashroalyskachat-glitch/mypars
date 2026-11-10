# pps edge relay (Cloudflare)

Optional turbo channel: delivers a message at the nearest Cloudflare edge
instead of waiting for the Supabase region. Supabase remains the source of truth.

```
client A ──wss──► Cloudflare edge (Durable Object) ──wss──► client B
       └────────► Supabase INSERT (durable row) ◄────────┘
```

- Delivery: nearest edge RTT (often 20–50 ms) instead of Supabase RTT (100–150 ms).
- If the relay is down, the app automatically uses Supabase Realtime.
- Durable Objects with SQLite are available on the **Workers Free** plan:
  - 100,000 requests/day (WebSocket messages count 20:1);
  - 13,000 GB-s/day duration;
  - 5 GB SQLite storage, 5M row reads/day, 100k row writes/day.

The relay does not store messages; it only forwards them. History and
durability stay in Postgres.

## Deploy

```bash
cd messenger/edge
npx wrangler login
npx wrangler secret put SUPABASE_JWT_SECRET
# paste the Legacy JWT Secret from Supabase → Project Settings → API
npx wrangler deploy
```

Wrangler prints a URL like:

```
https://pps-relay.<account>.workers.dev
```

Open `messenger/config.js` and set:

```js
window.PPS_RELAY_URL = 'wss://pps-relay.<account>.workers.dev';
```

Rebuild and deploy the site:

```bash
npm run build
npm run build:firebase
firebase deploy --only hosting
```

The app connects to the relay when a chat opens and falls back to Supabase
if the socket cannot connect.

## Security

- Every socket must present a valid Supabase JWT (HS256) signed with
  `SUPABASE_JWT_SECRET`. The secret is a Worker secret, never in the client.
- The room id is the sorted pair of user ids, so a third user cannot join
  a room between two other people.
- Rate limit: 60 messages per 10 seconds per socket.
- The relay does not verify chat membership in Postgres. A user who knows
  another user's uid can open a room with them; the recipient only sees it
  if they have that chat open. Keep RLS as the real access control for
  history and persistence.

## Limits

- Free plan: 100k requests/day. A WebSocket message counts as 1/20 request,
  so roughly 2M messages/day before the limit.
- Hibernation keeps idle sockets cheap; do not remove `acceptWebSocket`.
- If the limit is hit, the relay fails and the app falls back to Supabase.

## Test locally

```bash
cd messenger/edge
npx wrangler dev
```

Then set `PPS_RELAY_URL` to `ws://127.0.0.1:8787` in `config.js` for a local test.
