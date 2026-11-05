-- pps: delete messages and delete a direct chat for both participants.
-- Run once in Supabase SQL Editor.

alter table public.messages
    add column if not exists deleted_at timestamptz;

alter table public.messages
    add column if not exists deleted_for_all boolean not null default false;

grant update on public.messages to authenticated;

drop policy if exists "messages update own" on public.messages;
create policy "messages update own"
    on public.messages for update
    to authenticated
    using (sender_id = public.current_uid())
    with check (sender_id = public.current_uid());

-- Delete a 1:1 chat for both members. Cascades to chat_members and messages.
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
