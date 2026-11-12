-- aether.chat 1.0: invites
--   * codes are matched case-insensitively (aether.chat/inv/Aether == aether.chat/inv/aether)
--   * friendlier join errors, and joining a server you're already in just returns it
--   * invite_details(): rich preview for invite cards and the join dialog
-- Run after 009_final.sql.

create unique index if not exists server_invites_code_ci_idx on public.server_invites (lower(code));

create or replace function public.join_server(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_invite public.server_invites%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_invite from public.server_invites where lower(code) = lower(btrim(p_code)) for update;
  if not found then raise exception 'That invite doesn''t exist. Check the code or link.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.server_members m where m.server_id = v_invite.server_id and m.user_id = v_uid) then
    return v_invite.server_id;
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'That invite has expired.' using errcode = 'P0001';
  end if;
  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'That invite has been used up.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.server_bans b where b.server_id = v_invite.server_id and b.user_id = v_uid) then
    raise exception 'You''re banned from this server.' using errcode = '42501';
  end if;
  insert into public.server_members (server_id, user_id) values (v_invite.server_id, v_uid) on conflict do nothing;
  update public.server_invites set uses = uses + 1 where code = v_invite.code;
  return v_invite.server_id;
end;
$$;

create or replace function public.invite_details(p_code text)
returns table (code text, server_id uuid, name text, description text, icon_url text, banner_url text,
               member_count integer, online_hint integer, is_member boolean, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.code, s.id, s.name, s.description, s.icon_url, s.banner_url,
         (select count(*)::integer from public.server_members m where m.server_id = s.id),
         (select count(*)::integer from public.voice_states v where v.server_id = s.id and v.updated_at > now() - interval '90 seconds'),
         exists (select 1 from public.server_members m where m.server_id = s.id and m.user_id = auth.uid()),
         i.expires_at
    from public.server_invites i join public.servers s on s.id = i.server_id
   where lower(i.code) = lower(btrim(p_code))
     and (i.expires_at is null or i.expires_at > now())
     and (i.max_uses is null or i.uses < i.max_uses)
$$;

revoke all on function public.invite_details(text) from public, anon;
grant execute on function public.invite_details(text) to authenticated;
