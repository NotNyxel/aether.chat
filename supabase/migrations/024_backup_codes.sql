-- Aether 1.9.1: two-factor backup codes. Run after 023.
--
-- Eight single-use codes (like K7QM2-XRP9T) for when you can't use your authenticator app. The
-- server makes them and only keeps a SHA-256 fingerprint of each; you see the codes once. Using
-- one (through the mfa-recover Edge Function) removes two-factor from the account so you can get
-- in, after which the app asks you to set it up again. At most 5 tries per 15 minutes.

create table if not exists public.mfa_backup_codes (
  user_id    uuid not null references auth.users (id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, code_hash)
);
alter table public.mfa_backup_codes enable row level security;
-- No policies: nobody reads these directly. The functions below are the only way in.
revoke all on public.mfa_backup_codes from anon, authenticated;

create table if not exists public.mfa_recover_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists mfa_recover_attempts_user on public.mfa_recover_attempts (user_id, at desc);
alter table public.mfa_recover_attempts enable row level security;
revoke all on public.mfa_recover_attempts from anon, authenticated;

create or replace function public.backup_code_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex')
$$;

-- New set of 8 codes (replaces any old ones). Only while fully signed in with two-factor (aal2).
create or replace function public.generate_backup_codes() returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  idx constant int[] := array[0, 1, 2, 3, 4, 5, 9, 10, 11, 12]; -- random bytes of a v4 uuid
  codes text[] := '{}';
  b bytea;
  c text;
  i int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Turn on two-factor authentication first.' using errcode = '42501';
  end if;
  delete from public.mfa_backup_codes where user_id = auth.uid();
  for n in 1..8 loop
    b := uuid_send(gen_random_uuid());
    c := '';
    foreach i in array idx loop
      c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    insert into public.mfa_backup_codes (user_id, code_hash) values (auth.uid(), public.backup_code_hash(c));
    codes := codes || (substr(c, 1, 5) || '-' || substr(c, 6, 5));
  end loop;
  return codes;
end;
$$;

create or replace function public.backup_codes_remaining() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.mfa_backup_codes where user_id = auth.uid() and used_at is null
$$;

-- Server only (the mfa-recover function): checks and uses up a code.
create or replace function public.use_backup_code(p_user uuid, p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  if (select count(*) from public.mfa_recover_attempts where user_id = p_user and at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many tries. Wait 15 minutes and try again.' using errcode = '54000';
  end if;
  insert into public.mfa_recover_attempts (user_id) values (p_user);
  update public.mfa_backup_codes set used_at = now()
   where user_id = p_user and code_hash = public.backup_code_hash(p_code) and used_at is null
  returning true into ok;
  if coalesce(ok, false) then
    delete from public.mfa_backup_codes where user_id = p_user; -- two-factor is being removed; the rest are void
    delete from public.mfa_recover_attempts where user_id = p_user;
  end if;
  return coalesce(ok, false);
end;
$$;

revoke all on function public.generate_backup_codes(), public.backup_codes_remaining(), public.use_backup_code(uuid, text), public.backup_code_hash(text) from public, anon, authenticated;
grant execute on function public.generate_backup_codes(), public.backup_codes_remaining() to authenticated;
grant execute on function public.use_backup_code(uuid, text) to service_role;

-- ── Two-factor is enforced by the database, not just the app ─────────────────────────────────
-- A password sign-in is "aal1". If the account has a verified two-factor method, its session must
-- be "aal2" (the code was entered) to read or change anything. Before this, the check lived only in
-- the app, so someone with just your password could skip it by calling the API directly.
-- Every table with row-level security gets this as a restrictive policy. New tables must add it too
-- (the database test checks that none is missing).
create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or auth.uid() is null
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified')
$$;
revoke all on function public.mfa_ok() from public;
grant execute on function public.mfa_ok() to anon, authenticated;

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
  end loop;
end;
$$;
