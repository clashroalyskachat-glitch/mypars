-- pps: один SQL для быстрых путей.
-- Вставить целиком в Supabase → SQL Editor → Run. Безопасно запускать повторно.

-- ---------------------------------------------------------------------------
-- 1. Удаление сообщения «у всех» без Apps Script (~150 мс вместо ~3 с)
-- ---------------------------------------------------------------------------

alter table public.messages
    add column if not exists deleted_at timestamptz;

alter table public.messages
    add column if not exists deleted_for_all boolean not null default false;

-- Пустой body при soft-delete не должен нарушать check.
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages
    add constraint messages_body_check check (char_length(body) between 0 and 8000);

grant update on public.messages to authenticated;

drop policy if exists "messages update own" on public.messages;
create policy "messages update own"
    on public.messages for update
    to authenticated
    using (sender_id = public.current_uid())
    with check (sender_id = public.current_uid());

-- ---------------------------------------------------------------------------
-- 2. Удаление чата «у обоих» без Apps Script (~150 мс вместо ~3 с)
-- ---------------------------------------------------------------------------

create or replace function public.delete_direct_chat(other_id text)
returns void
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

    select c.id into cid
    from public.chats c
    join public.chat_members m1 on m1.chat_id = c.id and m1.user_id = me
    join public.chat_members m2 on m2.chat_id = c.id and m2.user_id = other_id
    where c.kind = 'direct'
    limit 1;

    if cid is not null then
        delete from public.chats where id = cid;
    end if;
end;
$$;

grant execute on function public.delete_direct_chat(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Быстрые файлы: Storage-бакет media (1 ГБ бесплатно, отдача через CDN)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

drop policy if exists "media read" on storage.objects;
create policy "media read"
    on storage.objects for select
    using (bucket_id = 'media');

drop policy if exists "media insert own" on storage.objects;
create policy "media insert own"
    on storage.objects for insert
    to authenticated
    with check (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = public.current_uid()
    );

drop policy if exists "media delete own" on storage.objects;
create policy "media delete own"
    on storage.objects for delete
    to authenticated
    using (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = public.current_uid()
    );

-- ---------------------------------------------------------------------------
-- 4. Индексы под пагинацию и поиск по нику
-- ---------------------------------------------------------------------------

create index if not exists messages_chat_time_idx
    on public.messages (chat_id, created_at);

create extension if not exists pg_trgm;
create index if not exists profiles_nick_trgm
    on public.profiles using gin (nick gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 5. Realtime для сообщений (если ещё не включён)
-- ---------------------------------------------------------------------------

do $$
begin
    alter publication supabase_realtime add table public.messages;
exception
    when duplicate_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.signals;
exception
    when duplicate_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.profiles;
exception
    when duplicate_object then null;
end $$;
