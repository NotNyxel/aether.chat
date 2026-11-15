-- Aether 1.8.3: end-to-end encrypted DMs and groups (optional per chat).
-- Run after 020_levels.sql.
--
-- How it works (the server only ever stores things it can't read):
--   * Everyone who sets it up has an identity key pair (ECDH P-256). The public half is in
--     e2e_public_keys; the private half never leaves devices except as a backup encrypted with a
--     passphrase only the user knows (e2e_key_backups), so a new device can unlock it.
--   * An encrypted chat has a random AES-256 key. It is "wrapped" (encrypted) separately for each
--     member with a key only that member and the wrapper can derive (ECDH), and stored in
--     conversation_keys. Messages are then encrypted in the app with AES-GCM before they're sent.

create table if not exists public.e2e_public_keys (
  user_id    uuid primary key default auth.uid() references public.users (id) on delete cascade,
  public_key jsonb not null check (octet_length(public_key::text) <= 2000),
  created_at timestamptz not null default now()
);
alter table public.e2e_public_keys enable row level security;
drop policy if exists e2e_pub_read on public.e2e_public_keys;
create policy e2e_pub_read on public.e2e_public_keys for select to authenticated using (true);
drop policy if exists e2e_pub_own on public.e2e_public_keys;
create policy e2e_pub_own on public.e2e_public_keys for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists e2e_pub_update on public.e2e_public_keys;
create policy e2e_pub_update on public.e2e_public_keys for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.e2e_public_keys to authenticated;
grant insert (public_key), update (public_key) on public.e2e_public_keys to authenticated;

create table if not exists public.e2e_key_backups (
  user_id    uuid primary key default auth.uid() references public.users (id) on delete cascade,
  ciphertext text not null check (char_length(ciphertext) <= 8000),
  salt       text not null check (char_length(salt) <= 100),
  iv         text not null check (char_length(iv) <= 100),
  updated_at timestamptz not null default now()
);
alter table public.e2e_key_backups enable row level security;
drop policy if exists e2e_backup_own on public.e2e_key_backups;
create policy e2e_backup_own on public.e2e_key_backups for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, delete on public.e2e_key_backups to authenticated;
grant insert (ciphertext, salt, iv), update (ciphertext, salt, iv, updated_at) on public.e2e_key_backups to authenticated;

alter table public.conversations add column if not exists e2e boolean not null default false;

create table if not exists public.conversation_keys (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  wrapped_key     text not null check (char_length(wrapped_key) <= 500),
  iv              text not null check (char_length(iv) <= 100),
  wrapped_by      uuid not null default auth.uid() references public.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.conversation_keys enable row level security;
drop policy if exists convkey_own on public.conversation_keys;
create policy convkey_own on public.conversation_keys for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists convkey_share on public.conversation_keys;
-- You can hand a chat's key to a member of that chat (including yourself), never to outsiders.
create policy convkey_share on public.conversation_keys for insert to authenticated
  with check (wrapped_by = (select auth.uid())
              and exists (select 1 from public.conversation_members m where m.conversation_id = conversation_keys.conversation_id and m.user_id = (select auth.uid()))
              and exists (select 1 from public.conversation_members m where m.conversation_id = conversation_keys.conversation_id and m.user_id = conversation_keys.user_id));
grant select on public.conversation_keys to authenticated;
grant insert (conversation_id, user_id, wrapped_key, iv) on public.conversation_keys to authenticated;

-- Members of the chat who don't have its key yet (new group members): whoever has it shares it.
create or replace function public.e2e_missing_members(p_conversation_id uuid)
returns table (user_id uuid, has_identity boolean)
language sql stable security definer set search_path = '' as $$
  select m.user_id, exists (select 1 from public.e2e_public_keys k where k.user_id = m.user_id)
    from public.conversation_members m
   where m.conversation_id = p_conversation_id
     and not exists (select 1 from public.conversation_keys ck where ck.conversation_id = p_conversation_id and ck.user_id = m.user_id)
     and exists (select 1 from public.conversation_members me where me.conversation_id = p_conversation_id and me.user_id = auth.uid())
$$;

-- Turn encryption on or off for a chat you're in. On requires that you've shared the key with
-- yourself (so the chat isn't locked by mistake).
create or replace function public.set_conversation_e2e(p_conversation_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then
    raise exception 'You''re not in this chat.' using errcode = '42501';
  end if;
  if p_on and not exists (select 1 from public.conversation_keys where conversation_id = p_conversation_id and user_id = auth.uid()) then
    raise exception 'Set up the chat key first.' using errcode = '22023';
  end if;
  update public.conversations set e2e = p_on where id = p_conversation_id;
end;
$$;
revoke all on function public.e2e_missing_members(uuid), public.set_conversation_e2e(uuid, boolean) from public, anon;
grant execute on function public.e2e_missing_members(uuid), public.set_conversation_e2e(uuid, boolean) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['e2e_public_keys', 'e2e_key_backups', 'conversation_keys'] loop
    execute format('drop policy if exists not_banned on public.%I', t);
    execute format('create policy not_banned on public.%I as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()))', t);
  end loop;
end;
$$;
