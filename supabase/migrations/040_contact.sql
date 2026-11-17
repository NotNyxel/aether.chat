-- 040: Contact us (2.2). Messages from the website's contact form. The contact edge function
-- (service role) stores each one and emails it to the team; app admins can read them in the
-- database. Nobody else can read or write this table. Kept for 180 days.

create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  email      text not null check (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  topic      text not null check (topic in ('question', 'bug', 'idea', 'account', 'safety', 'other')),
  message    text not null check (char_length(btrim(message)) between 10 and 4000),
  -- SHA-256 of the sender's IP, only for rate limiting.
  ip_hash    text not null,
  emailed    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists contact_messages_ip on public.contact_messages (ip_hash, created_at desc);

alter table public.contact_messages enable row level security;
drop policy if exists mfa_required on public.contact_messages;
create policy mfa_required on public.contact_messages as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
drop policy if exists not_banned on public.contact_messages;
create policy not_banned on public.contact_messages as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()));
drop policy if exists admins_read on public.contact_messages;
create policy admins_read on public.contact_messages for select to authenticated using (public.is_app_admin());
revoke all on public.contact_messages from anon, authenticated;
grant select on public.contact_messages to authenticated;

create or replace function public.purge_old_contact_messages()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.contact_messages where created_at < now() - interval '180 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_old_contact_messages() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'aether-purge-contact';
    perform cron.schedule('aether-purge-contact', '57 4 * * *', 'select public.purge_old_contact_messages()');
  end if;
end;
$$;
