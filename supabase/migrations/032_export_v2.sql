-- 032: "Download my data" also covers everything added since it was written: saved and scheduled
-- messages, drafts, favourite GIFs, chat folders / pins / archive / sounds, reminders, quiet hours
-- and your own bug reports. The original export (008) is kept as is and extended.

create or replace function public.export_my_data_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(u) from public.users u where u.id = auth.uid()),
    'privacy', (select to_jsonb(p) from public.privacy_settings p where p.user_id = auth.uid()),
    'notification_settings', (select coalesce(jsonb_agg(n), '[]') from public.notification_settings n where n.user_id = auth.uid()),
    'servers', (select coalesce(jsonb_agg(jsonb_build_object('server_id', m.server_id, 'server_name', s.name, 'owner', s.owner_id = auth.uid(),
                                                            'nickname', m.nickname, 'joined_at', m.joined_at, 'bio', m.bio)), '[]')
                  from public.server_members m join public.servers s on s.id = m.server_id where m.user_id = auth.uid()),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('user_id', case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
                                                             'status', f.status, 'since', coalesce(f.accepted_at, f.created_at))), '[]')
                  from public.friendships f where auth.uid() in (f.requester_id, f.addressee_id)),
    'blocked', (select coalesce(jsonb_agg(b.blocked_id), '[]') from public.user_blocks b where b.blocker_id = auth.uid()),
    'notes', (select coalesce(jsonb_agg(n), '[]') from public.user_notes n where n.owner_id = auth.uid()),
    'conversations', (select coalesce(jsonb_agg(jsonb_build_object('conversation_id', c.id, 'type', c.type, 'name', c.name, 'joined_at', cm.joined_at)), '[]')
                        from public.conversation_members cm join public.conversations c on c.id = cm.conversation_id where cm.user_id = auth.uid()),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'channel_id', m.channel_id, 'conversation_id', m.conversation_id,
                                                              'content', m.content, 'attachments', m.attachments, 'created_at', m.created_at,
                                                              'edited_at', m.edited_at) order by m.created_at), '[]')
                   from public.messages m where m.author_id = auth.uid()),
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('message_id', r.message_id, 'emoji', r.emoji)), '[]')
                    from public.message_reactions r where r.user_id = auth.uid()),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('reason', r.reason, 'details', r.details, 'status', r.status, 'created_at', r.created_at)), '[]')
                        from public.reports r where r.reporter_id = auth.uid()),
    'event_rsvps', (select coalesce(jsonb_agg(e.event_id), '[]') from public.event_rsvps e where e.user_id = auth.uid())
  )
$$;

create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.export_my_data_v1() || jsonb_build_object(
    'saved_messages', (select coalesce(jsonb_agg(jsonb_build_object('message_id', s.message_id, 'saved_at', s.saved_at)), '[]') from public.saved_messages s where s.user_id = auth.uid()),
    'scheduled_messages', (select coalesce(jsonb_agg(jsonb_build_object('channel_id', s.channel_id, 'conversation_id', s.conversation_id, 'content', s.content,
                                                                        'attachments', s.attachments, 'send_at', s.send_at, 'created_at', s.created_at)), '[]')
                             from public.scheduled_messages s where s.user_id = auth.uid()),
    'drafts', (select coalesce(jsonb_agg(jsonb_build_object('scope_id', d.scope_id, 'content', d.content, 'updated_at', d.updated_at)), '[]') from public.message_drafts d where d.user_id = auth.uid()),
    'favorite_gifs', (select coalesce(jsonb_agg(jsonb_build_object('url', g.url, 'title', g.title, 'created_at', g.created_at)), '[]') from public.gif_favorites g where g.user_id = auth.uid()),
    'chat_folders', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'emoji', f.emoji, 'position', f.position)), '[]') from public.chat_folders f where f.user_id = auth.uid()),
    'chat_settings', (select coalesce(jsonb_agg(jsonb_build_object('chat_id', p.scope_id, 'pinned_at', p.pinned_at, 'archived', p.archived, 'folder_id', p.folder_id, 'sound', p.sound)), '[]')
                        from public.chat_prefs p where p.user_id = auth.uid()),
    'reminders', (select coalesce(jsonb_agg(jsonb_build_object('message_id', r.message_id, 'note', r.note, 'remind_at', r.remind_at, 'done_at', r.done_at)), '[]') from public.reminders r where r.user_id = auth.uid()),
    'quiet_hours', (select jsonb_build_object('from', q.start_at, 'to', q.end_at, 'time_zone', q.tz) from public.quiet_hours q where q.user_id = auth.uid()),
    'bug_reports', (select coalesce(jsonb_agg(jsonb_build_object('description', b.description, 'status', b.status, 'created_at', b.created_at)), '[]') from public.bug_reports b where b.user_id = auth.uid())
  )
$$;

revoke all on function public.export_my_data_v1() from public, anon, authenticated;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
