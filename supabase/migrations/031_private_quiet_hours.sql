-- 031: quiet hours move to their own owner-only table.
-- 030 put them on public.users, whose rows every signed-in user can read, so anyone could see
-- when someone sleeps and in which time zone. Nothing used those columns yet.

create table if not exists public.quiet_hours (
  user_id    uuid primary key default auth.uid() references public.users (id) on delete cascade,
  start_at   time not null,
  end_at     time not null,
  tz         text not null default 'UTC' check (char_length(tz) between 1 and 64),
  updated_at timestamptz not null default now(),
  check (start_at <> end_at)
);
alter table public.quiet_hours enable row level security;
drop policy if exists own on public.quiet_hours;
create policy own on public.quiet_hours for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists mfa_required on public.quiet_hours;
create policy mfa_required on public.quiet_hours as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
drop policy if exists not_banned on public.quiet_hours;
create policy not_banned on public.quiet_hours as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()));
revoke all on public.quiet_hours from anon, authenticated;
grant select, insert, update, delete on public.quiet_hours to authenticated;

create or replace function public.in_quiet_hours(p_user uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_s time; v_e time; v_tz text; v_now time;
begin
  select q.start_at, q.end_at, q.tz into v_s, v_e, v_tz from public.quiet_hours q where q.user_id = p_user;
  if v_s is null then return false; end if;
  begin
    v_now := (now() at time zone v_tz)::time;
  exception when others then
    v_now := (now() at time zone 'UTC')::time;
  end;
  return case when v_s < v_e then v_now >= v_s and v_now < v_e else v_now >= v_s or v_now < v_e end;
end;
$$;
revoke all on function public.in_quiet_hours(uuid) from public, anon, authenticated;
grant execute on function public.in_quiet_hours(uuid) to service_role;

alter table public.users drop column if exists quiet_start, drop column if exists quiet_end, drop column if exists quiet_tz;
