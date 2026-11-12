// aether.chat push Edge Function
// Called by the database (trigger public.push_on_message, via pg_net) when a DM or an @mention is
// posted. Works out who should hear about it (not the author, not muted, not Do Not Disturb, not a
// pending message request) and sends a Web Push to each of their subscribed devices.
// Only our database can call it: it must send the shared secret from Supabase Vault.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: secret } = await sb.rpc('push_secret');
  if (!secret || req.headers.get('x-push-secret') !== secret) return json({ error: 'Forbidden.' }, 403);

  let messageId = '';
  try {
    messageId = String((await req.json()).message_id ?? '');
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
  const { data: m } = await sb
    .from('messages')
    .select('id, author_id, content, attachments, channel_id, conversation_id, mentions, mention_roles, is_bot')
    .eq('id', messageId)
    .maybeSingle();
  if (!m || m.is_bot || !m.author_id) return json({ sent: 0 });

  const { data: author } = await sb.from('users').select('display_name, username').eq('id', m.author_id).maybeSingle();
  const name = author?.display_name || author?.username || 'Someone';

  // Who to notify, and the title.
  let recipients: string[] = [];
  let title = name;
  let scopeId = m.conversation_id ?? m.channel_id;
  let serverId: string | null = null;
  if (m.conversation_id) {
    const { data: conv } = await sb.from('conversations').select('type, name').eq('id', m.conversation_id).maybeSingle();
    const { data: members } = await sb.from('conversation_members').select('user_id, request_pending').eq('conversation_id', m.conversation_id);
    recipients = (members ?? []).filter((x) => x.user_id !== m.author_id && !x.request_pending).map((x) => x.user_id);
    if (conv?.type === 'group') title = `${name} in ${conv.name || 'your group'}`;
  } else {
    const { data: ch } = await sb.from('channels').select('name, server_id').eq('id', m.channel_id).maybeSingle();
    serverId = ch?.server_id ?? null;
    const direct = new Set<string>(m.mentions ?? []);
    if ((m.mention_roles ?? []).length) {
      const { data: holders } = await sb.from('member_roles').select('user_id').in('role_id', m.mention_roles);
      for (const h of holders ?? []) direct.add(h.user_id);
    }
    direct.delete(m.author_id);
    recipients = [...direct];
    const { data: srv } = serverId ? await sb.from('servers').select('name').eq('id', serverId).maybeSingle() : { data: null };
    title = `${name} in #${ch?.name ?? 'channel'}${srv ? ` (${srv.name})` : ''}`;
  }
  if (!recipients.length) return json({ sent: 0 });

  // Respect Do Not Disturb and mutes.
  const { data: people } = await sb.from('users').select('id, presence_status').in('id', recipients);
  const dnd = new Set((people ?? []).filter((p) => p.presence_status === 'dnd').map((p) => p.id));
  const scopes = [scopeId, serverId].filter(Boolean) as string[];
  const { data: settings } = await sb.from('notification_settings').select('user_id, scope_id, level, muted_until').in('user_id', recipients).in('scope_id', scopes);
  const muted = new Set(
    (settings ?? []).filter((s) => s.level === 'none' || (s.muted_until && new Date(s.muted_until) > new Date())).map((s) => s.user_id),
  );
  recipients = recipients.filter((id) => !dnd.has(id) && !muted.has(id));
  if (!recipients.length) return json({ sent: 0 });

  const { data: subs } = await sb.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', recipients);
  if (!subs?.length) return json({ sent: 0 });

  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
  const text = (m.content || '').replace(/<@&?[0-9a-f-]+>|<#[0-9a-f-]+>/g, '@…').slice(0, 180) || ((m.attachments ?? []).length ? 'Sent an attachment' : 'New message');
  const payload = JSON.stringify({ title, body: text, tag: scopeId, data: { serverId, scopeId, messageId: m.id } });

  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.id); // the device unsubscribed
      }
    }),
  );
  if (gone.length) await sb.from('push_subscriptions').delete().in('id', gone);
  return json({ sent });
});
