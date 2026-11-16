-- Aether 1.9.0: automatic end-to-end encryption and device linking. Run after 022.
--
--   * conversation_keys.wrapper_pub: the public key the chat key was wrapped with, so a wrapped key
--     stays readable even if the person who wrapped it later resets their encryption.
--   * You can delete your own wrapped keys (used when you reset encryption, so the others in the
--     chat hand you the key again).
--   * conversations.e2e_declined: someone turned encryption off for this chat, so the app won't
--     turn it back on by itself.
--   * e2e_link_requests: a new device asks to be let in. It posts a one-time public key; one of your
--     signed-in devices approves it and writes back your identity key, encrypted so that only the new
--     device can read it. The server only ever sees ciphertext.

alter table public.conversation_keys add column if not exists wrapper_pub jsonb check (wrapper_pub is null or octet_length(wrapper_pub::text) <= 2000);
grant insert (conversation_id, user_id, wrapped_key, iv, wrapper_pub) on public.conversation_keys to authenticated;
drop policy if exists convkey_delete_own on public.conversation_keys;
create policy convkey_delete_own on public.conversation_keys for delete to authenticated using (user_id = (select auth.uid()));
grant delete on public.conversation_keys to authenticated;

alter table public.conversations add column if not exists e2e_declined boolean not null default false;

create or replace function public.set_conversation_e2e(p_conversation_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then
    raise exception 'You''re not in this chat.' using errcode = '42501';
  end if;
  if p_on and not exists (select 1 from public.conversation_keys where conversation_id = p_conversation_id and user_id = auth.uid()) then
    raise exception 'Set up the chat key first.' using errcode = '22023';
  end if;
  update public.conversations set e2e = p_on, e2e_declined = not p_on where id = p_conversation_id;
end;
$$;

create table if not exists public.e2e_link_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.users (id) on delete cascade,
  device_name  text not null check (char_length(device_name) between 1 and 80),
  request_pub  jsonb not null check (octet_length(request_pub::text) <= 2000),
  approver_pub jsonb check (approver_pub is null or octet_length(approver_pub::text) <= 2000),
  ciphertext   text check (ciphertext is null or char_length(ciphertext) <= 8000),
  iv           text check (iv is null or char_length(iv) <= 100),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at   timestamptz not null default now()
);
create index if not exists e2e_link_requests_user on public.e2e_link_requests (user_id, created_at desc);
alter table public.e2e_link_requests enable row level security;
drop policy if exists e2e_link_own on public.e2e_link_requests;
create policy e2e_link_own on public.e2e_link_requests for all to authenticated
  using (user_id = (select auth.uid()) and created_at > now() - interval '15 minutes')
  with check (user_id = (select auth.uid()));
grant select, delete on public.e2e_link_requests to authenticated;
grant insert (device_name, request_pub) on public.e2e_link_requests to authenticated;
grant update (approver_pub, ciphertext, iv, status) on public.e2e_link_requests to authenticated;
drop policy if exists not_banned on public.e2e_link_requests;
create policy not_banned on public.e2e_link_requests as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'e2e_link_requests') then
    alter publication supabase_realtime add table public.e2e_link_requests;
  end if;
end;
$$;

-- Old requests are useless after 15 minutes.
create or replace function public.purge_link_requests() returns void language sql security definer set search_path = '' as $$
  delete from public.e2e_link_requests where created_at < now() - interval '1 hour'
$$;
revoke all on function public.purge_link_requests() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'aether-purge-link-requests';
    perform cron.schedule('aether-purge-link-requests', '23 * * * *', 'select public.purge_link_requests()');
  end if;
end;
$$;

-- Encrypted text is longer than the message it holds, so let it be up to 6,000 characters. That
-- way encrypted messages can be as long as normal ones (4,000 characters of plain text).
do $$
declare c text;
begin
  for c in select con.conname from pg_constraint con
            where con.conrelid = 'public.messages'::regclass and con.contype = 'c'
              and pg_get_constraintdef(con.oid) ilike '%char_length(content)%4000%'
  loop
    execute format('alter table public.messages drop constraint %I', c);
  end loop;
end;
$$;
alter table public.messages drop constraint if exists messages_content_length;
alter table public.messages add constraint messages_content_length
  check (char_length(content) <= 4000 or (content like 'aether-e2e:%' and char_length(content) <= 6000));
