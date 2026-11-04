-- Fix for the only failing part of the first schema run:
-- INSERT into public.signals was rejected by RLS.
-- Run this in Supabase SQL Editor, then test again.

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

grant select, insert, delete on public.signals to authenticated;

-- Security-definer helper: bypasses INSERT RLS for signalling.
create or replace function public.send_signal(p_to text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.signals (from_id, to_id, payload)
    values (public.current_uid(), p_to, p_payload);
end;
$$;

grant execute on function public.send_signal(text, jsonb) to authenticated;

-- Optional: inspect what exists.
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'signals';
