-- pps messenger — Supabase schema
-- Run in Supabase SQL Editor once, after creating the project.
-- Auth model: custom JWT from Google Apps Script.
--   sub  = existing Apps Script user id (text, e.g. "u-1a2b...")
--   role = "authenticated"
--   nick = nick from the college auth sheet

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
    id          text primary key,
    nick        text unique not null,
    created_at  timestamptz not null default now(),
    last_seen   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read"
    on public.profiles for select
    to authenticated
    using (true);

drop policy if exists "profiles insert self" on public.profiles;
create policy "profiles insert self"
    on public.profiles for insert
    to authenticated
    with check (id = (auth.jwt() ->> 'sub'));

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self"
    on public.profiles for update
    to authenticated
    using (id = (auth.jwt() ->> 'sub'))
    with check (id = (auth.jwt() ->> 'sub'));

-- ------------------------------------------------------------------ chats

create table if not exists public.chats (
    id          uuid primary key default gen_random_uuid(),
    kind        text not null default 'direct' check (kind in ('direct', 'group')),
    created_by  text not null,
    created_at  timestamptz not null default now()
);

create table if not exists public.chat_members (
    chat_id    uuid not null references public.chats(id) on delete cascade,
    user_id    text not null,
    joined_at  timestamptz not null default now(),
    primary key (chat_id, user_id)
);

alter table public.chats enable row level security;
alter table public.chat_members enable row level security;

create or replace function public.current_uid()
returns text
language sql
stable
as $$
    select coalesce(auth.jwt() ->> 'sub', '')
$$;

create or replace function public.is_chat_member(p_chat uuid, p_user text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.chat_members
        where chat_id = p_chat and user_id = p_user
    )
$$;

drop policy if exists "chats read member" on public.chats;
create policy "chats read member"
    on public.chats for select
    to authenticated
    using (public.is_chat_member(id, public.current_uid()));

drop policy if exists "chats insert self" on public.chats;
create policy "chats insert self"
    on public.chats for insert
    to authenticated
    with check (created_by = public.current_uid());

drop policy if exists "members read member" on public.chat_members;
create policy "members read member"
    on public.chat_members for select
    to authenticated
    using (public.is_chat_member(chat_id, public.current_uid()));

drop policy if exists "members insert creator" on public.chat_members;
create policy "members insert creator"
    on public.chat_members for insert
    to authenticated
    with check (
        exists (
            select 1 from public.chats
            where id = chat_id and created_by = public.current_uid()
        )
    );

-- Create (or reuse) a 1:1 chat. Security definer bypasses RLS inside.
create or replace function public.create_direct_chat(other_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    me  text := public.current_uid();
    cid uuid;
begin
    if me = '' or other_id = '' or me = other_id then
        raise exception 'bad_users';
    end if;
    if not exists (select 1 from public.profiles where id = other_id) then
        raise exception 'no_user';
    end if;

    select c.id into cid
    from public.chats c
    join public.chat_members m1 on m1.chat_id = c.id and m1.user_id = me
    join public.chat_members m2 on m2.chat_id = c.id and m2.user_id = other_id
    where c.kind = 'direct'
    limit 1;

    if cid is not null then
        return cid;
    end if;

    insert into public.chats (kind, created_by)
    values ('direct', me)
    returning id into cid;

    insert into public.chat_members (chat_id, user_id)
    values (cid, me), (cid, other_id);

    return cid;
end;
$$;

-- --------------------------------------------------------------- messages

create table if not exists public.messages (
    id          uuid primary key default gen_random_uuid(),
    chat_id     uuid not null references public.chats(id) on delete cascade,
    sender_id   text not null,
    body        text not null check (char_length(body) between 1 and 8000),
    client_id   text,
    created_at  timestamptz not null default now()
);

create unique index if not exists messages_client_unique
    on public.messages (sender_id, client_id)
    where client_id is not null;

create index if not exists messages_chat_time_idx
    on public.messages (chat_id, created_at);

alter table public.messages enable row level security;

drop policy if exists "messages read member" on public.messages;
create policy "messages read member"
    on public.messages for select
    to authenticated
    using (public.is_chat_member(chat_id, public.current_uid()));

drop policy if exists "messages insert member" on public.messages;
create policy "messages insert member"
    on public.messages for insert
    to authenticated
    with check (
        sender_id = public.current_uid()
        and public.is_chat_member(chat_id, public.current_uid())
    );

-- ---------------------------------------------------------------- signals
-- Ephemeral WebRTC signalling. Rows are deleted by the recipient.

create table if not exists public.signals (
    id          bigint generated by default as identity primary key,
    from_id     text not null,
    to_id       text not null,
    payload     jsonb not null,
    created_at  timestamptz not null default now()
);

create index if not exists signals_to_idx on public.signals (to_id, id);

alter table public.signals enable row level security;

drop policy if exists "signals insert self" on public.signals;
create policy "signals insert self"
    on public.signals for insert
    to authenticated
    with check (from_id = public.current_uid());

drop policy if exists "signals read recipient" on public.signals;
create policy "signals read recipient"
    on public.signals for select
    to authenticated
    using (to_id = public.current_uid());

drop policy if exists "signals delete recipient" on public.signals;
create policy "signals delete recipient"
    on public.signals for delete
    to authenticated
    using (to_id = public.current_uid());

-- ----------------------------------------------------------------- grants

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.chats, public.chat_members, public.messages to authenticated;
grant select, insert, delete on public.signals to authenticated;

grant execute on function public.current_uid() to authenticated;
grant execute on function public.is_chat_member(uuid, text) to authenticated;
grant execute on function public.create_direct_chat(text) to authenticated;

-- Realtime (Postgres Changes). Skip lines that already exist.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.signals;
alter publication supabase_realtime add table public.profiles;
