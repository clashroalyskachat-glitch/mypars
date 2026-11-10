# Supabase setup for pps

## 1. Create the project

Recommended values in the Supabase wizard:

| Field | Value |
|---|---|
| Organization | `nkselove` (Free) |
| Project name | `nkselove-messenger` |
| Database password | click **Generate**, save it in a password manager |
| Region | **Europe (Frankfurt)** or the closest EU region |
| GitHub | skip for now |
| Enable Data API | **ON** (supabase-js uses it) |
| Automatically expose new tables | **OFF** (we grant explicitly) |
| Enable automatic RLS | **ON** |

Wait until the project is provisioned (1–2 minutes).

## 2. What to send me

From **Project Settings → API**:

- **Project URL**: `https://<project-ref>.supabase.co`
- **anon public** key

These are public client credentials. Send them in chat.

**Never send** the database password, `service_role` key, or JWT secret.

## 3. SQL schema

Open **SQL Editor**, paste [`schema.sql`](schema.sql), run it.

It creates:

- `profiles` — nick, uid, last_seen;
- `chats`, `chat_members` — 1:1 and future groups;
- `messages` — text/ciphertext, unique client id for dedupe;
- `signals` — ephemeral WebRTC offer/answer/ICE;
- RLS policies and `create_direct_chat(other_uid)`;
- Realtime publication for `messages`, `signals`, `profiles`.

If a `alter publication` line says the table is already in the publication,
ignore that line; the rest is idempotent except policies are recreated.

## 3b. Speed pack

After the schema, run [`speed.sql`](speed.sql) once. It is idempotent and adds:

- soft delete for messages (`deleted_at`, `deleted_for_all`) + update policy;
- `delete_direct_chat(other_id)` for deleting a chat for both;
- Storage bucket `media` (public read, owner-only write);
- `pg_trgm` index for nick search;
- a `(chat_id, created_at)` index and Realtime publication.

Without it the messenger still works, but deletes go through Apps Script (~3 s),
chat deletion for both is unavailable, and files go to Google Drive.

## 4. JWT bridge in Apps Script

The existing college auth lives in `library/backend/Code.gs` and stores sessions
in the `AUTH_SESS` sheet.

1. Open the Apps Script project bound to that backend.
2. Add the functions from [`apps-script-jwt.gs`](apps-script-jwt.gs).
3. Add a Script Property:
   - **Project Settings → Script Properties → Add**:
   - `SUPABASE_JWT_SECRET` = the **JWT Secret** from
     **Supabase → Project Settings → API → JWT Settings**.
4. In `authDispatch_`, add the `op === 'supabase'` branch shown in the snippet.
5. **Deploy → Manage deployments → Edit → New version → Deploy.**
   Without a new version the `/exec` URL keeps running the old code.

The endpoint then accepts:

```json
{ "board": "auth", "op": "supabase", "token": "<nkse-session token>" }
```

and returns a Supabase JWT with:

```json
{ "sub": "u-...", "role": "authenticated", "nick": "demo" }
```

## 5. Client integration

The messenger will:

1. read the existing `nkse-session` token from `localStorage`;
2. call the Apps Script endpoint to exchange it for a Supabase JWT;
3. call `supabase.realtime.setAuth(jwt)` and use the JWT for REST requests;
4. keep WebRTC signalling in the `signals` table.

This preserves the existing nick/password registration: no second account.

## Notes

- If Supabase shows only asymmetric JWT signing keys and no legacy HS256
  secret, stop and tell me — we will switch to a Supabase Edge Function or
  Supabase Auth instead.
- The project was created with an ES256 current key and an HS256 **previous**
  key, so the Legacy JWT Secret path is available. Do not revoke it until the
  messenger is migrated.
- Free projects pause after 7 days without activity. A daily GitHub Action
  ping keeps it alive; we can add it later.
- Do not put the JWT secret into `messenger/`, GitHub, or the browser.
