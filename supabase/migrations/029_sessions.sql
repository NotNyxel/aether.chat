-- Aether 2.0: see where you're signed in, and sign a device out. Run after 028.
-- auth.sessions isn't reachable from the app, so two functions expose only your own sessions.
-- Ending a session stops it from refreshing; an app already open there is signed out within the
-- hour (when its current access token expires) or as soon as it next refreshes.

create or replace function public.my_sessions()
returns table (id uuid, created_at timestamptz, last_active timestamptz, user_agent text, ip text, aal text, current boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
    select s.id, s.created_at, coalesce(s.refreshed_at, s.updated_at, s.created_at), s.user_agent, host(s.ip)::text, s.aal::text,
           s.id::text = coalesce(auth.jwt() ->> 'session_id', '')
      from auth.sessions s
     where s.user_id = auth.uid()
     order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc
     limit 50;
end;
$$;

create or replace function public.end_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_session_id::text = coalesce(auth.jwt() ->> 'session_id', '') then
    raise exception 'Use Sign out to end this device''s session.' using errcode = '22023';
  end if;
  delete from auth.sessions where id = p_session_id and user_id = auth.uid();
end;
$$;

revoke all on function public.my_sessions(), public.end_session(uuid) from public, anon;
grant execute on function public.my_sessions(), public.end_session(uuid) to authenticated;
