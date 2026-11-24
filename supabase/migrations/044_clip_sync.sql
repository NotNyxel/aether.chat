-- 044: clip sync (2.5). A clip "shared" to your own user id goes to your other devices: no chat
-- message, only you can see it (the sender policy), and the relay copy stays the full 72 hours
-- so every device can fetch it (devices also fetch it straight from the PC that has it).

drop policy if exists share on public.clip_shares;
create policy share on public.clip_shares for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (public.can_write_scope(scope_id) or scope_id = (select auth.uid()))
    and status = 'uploading'
  );

create or replace function public.clip_fully_delivered(p_share uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare c public.clip_shares%rowtype; v_missing integer;
begin
  select * into c from public.clip_shares where id = p_share;
  if not found then return true; end if;
  -- Synced to your own devices: kept until it expires.
  if c.scope_id = c.sender_id then return false; end if;
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
grant execute on function public.clip_fully_delivered(uuid) to service_role;
