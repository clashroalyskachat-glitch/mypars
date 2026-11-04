-- Cleanup after the smoke test:
--   profiles: smoke-a / smoke-b
--   one direct chat and one message
-- Run in Supabase SQL Editor.

delete from public.messages
where chat_id in (
    select chat_id from public.chat_members
    where user_id like 'u-smoke-%' or user_id like 'u-test-%'
);

delete from public.chats
where id in (
    select chat_id from public.chat_members
    where user_id like 'u-smoke-%' or user_id like 'u-test-%'
);

delete from public.profiles
where id like 'u-smoke-%' or id like 'u-test-%';
