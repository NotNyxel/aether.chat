-- Aether 2.0: security and performance hardening (from the 2.0 bug hunt). Run after 026.
--
-- 1. Internal helpers could be called directly by anyone signed in, because Supabase grants
--    EXECUTE to `authenticated` separately from `public` (so earlier "revoke … from public, anon"
--    left them open). Two of them let a user write fake audit-log entries; others let anyone look
--    up another person's warning points, standing, privacy settings, or whether two other people
--    are friends or have blocked each other. They only ever need to run inside other database
--    functions (which run as the owner), so nobody needs to call them directly.
-- 2. Trigger functions were callable directly too (harmless, since they error, but untidy).
-- 3. From now on, new functions are private by default: each migration grants what the app uses.
-- 4. Indexes for foreign keys that had none (faster deletes and lookups), a primary key for the
--    backup-code attempts table, and one access rule that was re-evaluated for every row.

-- 1. Internal helpers: only the database itself.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('write_audit', 'admin_log', 'warning_points', 'danger_level', 'privacy_of', 'is_blocked_between',
                         'shares_server', 'are_friends', 'extract_mentions', 'extract_role_mentions', 'automod_invite_match',
                         'automod_caps_match', 'automod_keyword_match', 'automod_link_match', 'backup_code_hash')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

-- 2. Trigger functions: never called directly.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

-- 3. Private by default for functions created from now on.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- 4a. Foreign keys without an index: add one (single-column keys).
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col, c.conrelid::regclass::text as tname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
       and not exists (
         select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
       )
  loop
    execute format('create index if not exists %I on %s (%I)', left('fk_' || replace(r.tname, 'public.', '') || '_' || r.col, 63), r.tbl, r.col);
  end loop;
end;
$$;

-- 4b. A primary key for the backup-code attempts table.
alter table public.mfa_recover_attempts add column if not exists id bigint generated always as identity;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.mfa_recover_attempts'::regclass and contype = 'p') then
    alter table public.mfa_recover_attempts add primary key (id);
  end if;
end;
$$;

-- 4c. Evaluate auth.uid() once per query, not once per row.
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
