-- aether.chat 1.5.1: group DM owners can remove members and hand over ownership.
-- Run after 013_platform.sql.

create or replace function public.remove_group_member(p_conversation_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.conversations;
begin
  select * into v from public.conversations where id = p_conversation_id for update;
  if v.id is null or v.type <> 'group' then raise exception 'Not a group.' using errcode = '22023'; end if;
  if v.owner_id is distinct from auth.uid() then raise exception 'Only the group owner can remove people.' using errcode = '42501'; end if;
  if p_user_id = auth.uid() then raise exception 'Use Leave group to leave it yourself.' using errcode = '22023'; end if;
  delete from public.conversation_members where conversation_id = p_conversation_id and user_id = p_user_id;
  if not found then raise exception 'They''re not in this group.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.transfer_group_owner(p_conversation_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.conversations;
begin
  select * into v from public.conversations where id = p_conversation_id for update;
  if v.id is null or v.type <> 'group' then raise exception 'Not a group.' using errcode = '22023'; end if;
  if v.owner_id is distinct from auth.uid() then raise exception 'Only the group owner can hand over the group.' using errcode = '42501'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = p_user_id) then
    raise exception 'They''re not in this group.' using errcode = 'P0002';
  end if;
  update public.conversations set owner_id = p_user_id where id = p_conversation_id;
end;
$$;

revoke all on function public.remove_group_member(uuid, uuid), public.transfer_group_owner(uuid, uuid) from public, anon;
grant execute on function public.remove_group_member(uuid, uuid), public.transfer_group_owner(uuid, uuid) to authenticated;
