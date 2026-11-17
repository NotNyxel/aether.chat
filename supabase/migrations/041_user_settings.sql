-- 041: settings sync (2.3). App settings that used to live only on one device (theme, layout,
-- accessibility, sounds, notifications, keybinds, activity, language, call volumes…) are kept per
-- account, so every device you sign in on looks and behaves the same.
--
-- data = { "<section>": { "v": <value>, "at": <ms timestamp> }, ... }. save_settings() merges a
-- patch section by section and keeps whichever copy of each section is newer, so two devices
-- changing different settings never overwrite each other.

create table if not exists public.user_settings (
  user_id    uuid primary key default auth.uid() references public.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 200000),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
drop policy if exists own on public.user_settings;
create policy own on public.user_settings for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists mfa_required on public.user_settings;
create policy mfa_required on public.user_settings as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
drop policy if exists not_banned on public.user_settings;
create policy not_banned on public.user_settings as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()));
revoke all on public.user_settings from anon, authenticated;
grant select on public.user_settings to authenticated;

-- Merge sections into your settings; a section only replaces the stored one if it's newer.
create or replace function public.save_settings(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := auth.uid();
  v_data jsonb;
  k      text;
  v      jsonb;
begin
  if v_me is null or public.is_banned() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'Bad settings.' using errcode = '22023'; end if;
  insert into public.user_settings (user_id) values (v_me) on conflict (user_id) do nothing;
  select data into v_data from public.user_settings where user_id = v_me for update;
  for k, v in select * from jsonb_each(p_patch) loop
    continue when k !~ '^[a-z][a-zA-Z0-9]{0,31}$' or jsonb_typeof(v) <> 'object' or coalesce(jsonb_typeof(v -> 'at'), '') <> 'number';
    if v_data -> k is null or coalesce((v_data -> k ->> 'at')::numeric, 0) < (v ->> 'at')::numeric then
      v_data := v_data || jsonb_build_object(k, jsonb_build_object('v', v -> 'v', 'at', v -> 'at'));
    end if;
  end loop;
  update public.user_settings set data = v_data, updated_at = now() where user_id = v_me;
  return v_data;
end;
$$;
revoke all on function public.save_settings(jsonb) from public, anon;
grant execute on function public.save_settings(jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_settings') then
    alter publication supabase_realtime add table public.user_settings;
  end if;
end;
$$;
