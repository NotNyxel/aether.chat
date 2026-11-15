-- Aether 1.8.3: remove sign-ups that never confirmed their email, so they don't hold on to usernames
-- and email addresses forever. Run after 021_e2e.sql.
--
-- Removed: accounts created from 2026-11-15 on (when email confirmation came back), still unconfirmed
-- 7 days later. Never touched: confirmed accounts, older accounts, and accounts an admin created
-- (they may be left unverified on purpose).

create or replace function public.purge_unconfirmed_accounts(p_since timestamptz default timestamptz '2026-11-15 00:00:00+00')
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.users u
   where u.email_confirmed_at is null
     and u.created_at < now() - interval '7 days'
     and u.created_at >= p_since
     and coalesce(u.raw_app_meta_data ->> 'created_by_admin', 'false') <> 'true';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.purge_unconfirmed_accounts(timestamptz) from public, anon, authenticated;

-- Once a day (the hosted database has pg_cron; local test databases may not).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'aether-purge-unconfirmed';
    perform cron.schedule('aether-purge-unconfirmed', '17 3 * * *', 'select public.purge_unconfirmed_accounts()');
  end if;
end;
$$;
