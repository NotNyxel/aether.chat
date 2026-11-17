-- 043: clip sharing (2.4). Clips live on people's devices. Sharing one uploads it to a temporary
-- relay (bucket "clips", in ≤45 MB parts) and posts a message card; recipients' apps fetch it
-- directly from the sender's PC when they can (peer-to-peer) and from the relay otherwise, then
-- keep it locally. The relay copy is deleted as soon as everyone has it, or after 72 hours.
-- Thumbnails (full resolution) stay 30 days so the card still shows something.

create table if not exists public.clip_shares (
  id               uuid primary key default gen_random_uuid(),
  scope_id         uuid not null,
  sender_id        uuid not null default auth.uid() references public.users (id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 1 and 120),
  game             text check (game is null or char_length(game) <= 120),
  detail           text check (detail is null or char_length(detail) <= 160),
  duration         real not null check (duration >= 0),
  size_bytes       bigint not null check (size_bytes > 0),
  width            integer not null default 0,
  height           integer not null default 0,
  fps              real not null default 0,
  chunk_size       integer not null check (chunk_size between 1048576 and 47185920),
  chunks           integer not null check (chunks between 1 and 100000),
  sha256           text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  e2e              boolean not null default false,
  thumb_path       text,
  status           text not null default 'uploading' check (status in ('uploading', 'ready', 'gone')),
  created_at       timestamptz not null default now(),
  relay_expires_at timestamptz not null default now() + interval '72 hours'
);
create index if not exists clip_shares_scope on public.clip_shares (scope_id, created_at desc);
create index if not exists clip_shares_sender on public.clip_shares (sender_id);
create index if not exists clip_shares_status on public.clip_shares (status, relay_expires_at);

create table if not exists public.clip_receipts (
  share_id    uuid not null references public.clip_shares (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.users (id) on delete cascade,
  via         text not null default 'relay' check (via in ('relay', 'p2p')),
  received_at timestamptz not null default now(),
  primary key (share_id, user_id)
);
create index if not exists clip_receipts_user on public.clip_receipts (user_id);

-- Proof that a peer-to-peer request really comes from that user (the sender checks the nonce).
create table if not exists public.clip_p2p_requests (
  id         uuid primary key default gen_random_uuid(),
  share_id   uuid not null references public.clip_shares (id) on delete cascade,
  requester  uuid not null default auth.uid() references public.users (id) on delete cascade,
  nonce      text not null check (char_length(nonce) between 16 and 64),
  created_at timestamptz not null default now()
);
create index if not exists clip_p2p_requests_share on public.clip_p2p_requests (share_id, nonce);
create index if not exists clip_p2p_requests_requester on public.clip_p2p_requests (requester);

alter table public.messages add column if not exists clip_id uuid references public.clip_shares (id) on delete set null;
create index if not exists messages_clip on public.messages (clip_id) where clip_id is not null;
grant insert (clip_id) on public.messages to authenticated;

-- Who may see a share: the sender, anyone who can read its chat, and app admins.
create or replace function public.clip_visible(p_share uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clip_shares c
     where c.id = p_share
       and (c.sender_id = auth.uid() or public.can_read_scope(c.scope_id) or public.is_app_admin())
  )
$$;
revoke all on function public.clip_visible(uuid) from public, anon;
grant execute on function public.clip_visible(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['clip_shares', 'clip_receipts', 'clip_p2p_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
    execute format('drop policy if exists not_banned on public.%I', t);
    execute format('create policy not_banned on public.%I as restrictive for all to authenticated using ((select not public.is_banned())) with check ((select not public.is_banned()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

drop policy if exists see on public.clip_shares;
create policy see on public.clip_shares for select to authenticated
  using (sender_id = (select auth.uid()) or public.can_read_scope(scope_id) or public.is_app_admin());
drop policy if exists share on public.clip_shares;
create policy share on public.clip_shares for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.can_write_scope(scope_id) and status = 'uploading');
drop policy if exists own_update on public.clip_shares;
create policy own_update on public.clip_shares for update to authenticated
  using (sender_id = (select auth.uid())) with check (sender_id = (select auth.uid()) and status in ('uploading', 'ready', 'gone'));
drop policy if exists own_delete on public.clip_shares;
create policy own_delete on public.clip_shares for delete to authenticated using (sender_id = (select auth.uid()));
grant select, delete on public.clip_shares to authenticated;
grant insert (scope_id, title, game, detail, duration, size_bytes, width, height, fps, chunk_size, chunks, sha256, e2e, thumb_path) on public.clip_shares to authenticated;
grant update (status, thumb_path, sha256) on public.clip_shares to authenticated;

drop policy if exists see on public.clip_receipts;
create policy see on public.clip_receipts for select to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.clip_shares c where c.id = share_id and c.sender_id = (select auth.uid())));
drop policy if exists mark on public.clip_receipts;
create policy mark on public.clip_receipts for insert to authenticated
  with check (user_id = (select auth.uid()) and public.clip_visible(share_id));
grant select on public.clip_receipts to authenticated;
grant insert (share_id, via) on public.clip_receipts to authenticated;

drop policy if exists see on public.clip_p2p_requests;
create policy see on public.clip_p2p_requests for select to authenticated
  using (requester = (select auth.uid()) or exists (select 1 from public.clip_shares c where c.id = share_id and c.sender_id = (select auth.uid())));
drop policy if exists ask on public.clip_p2p_requests;
create policy ask on public.clip_p2p_requests for insert to authenticated
  with check (requester = (select auth.uid()) and public.clip_visible(share_id));
grant select on public.clip_p2p_requests to authenticated;
grant insert (share_id, nonce) on public.clip_p2p_requests to authenticated;

-- The relay: <sender>/<share>/part-0000…, thumb.jpg. Parts are ≤45 MB (the free plan's cap is 50).
insert into storage.buckets (id, name, public, file_size_limit)
values ('clips', 'clips', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
drop policy if exists "storage: clips upload own" on storage.objects;
create policy "storage: clips upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'clips' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "storage: clips delete own" on storage.objects;
create policy "storage: clips delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "storage: clips read shared" on storage.objects;
create policy "storage: clips read shared" on storage.objects for select to authenticated
  using (bucket_id = 'clips' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.clip_visible(public.try_uuid((storage.foldername(name))[2]))
  ));

-- Has everyone the share went to got it? (DM/group: every member; channel: everyone who can see it.)
create or replace function public.clip_fully_delivered(p_share uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare c public.clip_shares%rowtype; v_missing integer;
begin
  select * into c from public.clip_shares where id = p_share;
  if not found then return true; end if;
  if exists (select 1 from public.conversations where id = c.scope_id) then
    select count(*) into v_missing from public.conversation_members m
     where m.conversation_id = c.scope_id and m.user_id <> c.sender_id
       and not exists (select 1 from public.clip_receipts r where r.share_id = p_share and r.user_id = m.user_id);
  else
    select count(*) into v_missing from public.server_members sm
      join public.channels ch on ch.id = c.scope_id and ch.server_id = sm.server_id
     where sm.user_id <> c.sender_id
       and (public.channel_permissions(c.scope_id, sm.user_id) & public.permission_bit('VIEW_CHANNEL')) <> 0
       and not exists (select 1 from public.clip_receipts r where r.share_id = p_share and r.user_id = sm.user_id);
  end if;
  return v_missing = 0;
end;
$$;
revoke all on function public.clip_fully_delivered(uuid) from public, anon, authenticated;

-- What the clip-cleanup function should delete now (service role only).
create or replace function public.clip_cleanup_targets()
returns table (id uuid, prefix text, parts boolean, thumb boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.sender_id::text || '/' || c.id::text,
         c.status <> 'gone' and (c.relay_expires_at < now()
                                 or (c.status = 'uploading' and c.created_at < now() - interval '1 day')
                                 or (c.status = 'ready' and public.clip_fully_delivered(c.id))),
         c.thumb_path is not null and c.created_at < now() - interval '30 days'
    from public.clip_shares c
   where (c.status <> 'gone' or (c.thumb_path is not null and c.created_at < now() - interval '30 days'))
   limit 200
$$;
revoke all on function public.clip_cleanup_targets() from public, anon, authenticated;
grant execute on function public.clip_cleanup_targets() to service_role;
grant execute on function public.clip_fully_delivered(uuid) to service_role;

-- Every 10 minutes the database asks the clip-cleanup function to tidy up (same secret as push).
create or replace function public.clip_cleanup_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  delete from public.clip_p2p_requests where created_at < now() - interval '1 hour';
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  v_secret := public.push_secret();
  if v_secret is null then return; end if;
  execute 'select net.http_post($1, $2, ''{}''::jsonb, $3, 20000)'
    using 'https://pyjvnbjsjtbogrmoimwf.supabase.co/functions/v1/clip-cleanup',
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret);
exception when others then
  return;
end;
$$;
revoke all on function public.clip_cleanup_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'aether-clip-cleanup';
    perform cron.schedule('aether-clip-cleanup', '*/10 * * * *', 'select public.clip_cleanup_tick()');
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clip_shares') then
    alter publication supabase_realtime add table public.clip_shares;
  end if;
end;
$$;
