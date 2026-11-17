// aether.chat bot API (2.1)
//   GET  /functions/v1/bot-api/me                         → { id, name, servers: [{ id, name, channels: [{ id, name }] }] }
//   POST /functions/v1/bot-api/channels/<id>/messages     { "content": "..." } → { id }
// Authorization: Bot <token>   (from Settings → Developer; only its hash is stored)
// An app can post in text channels of servers it has been added to, 30 messages a minute.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bot\s+(aeb_[0-9a-f]{64})$/i.exec(auth.trim())?.[1];
  if (!token) return json({ error: 'Send your app token as "Authorization: Bot <token>".' }, 401);

  const path = new URL(req.url).pathname.replace(/^.*\/bot-api/, '');
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });

  if (req.method === 'GET' && path === '/me') {
    const { data, error } = await sb.rpc('bot_me', { p_token: token });
    return error ? json({ error: error.message }, error.code === '42501' ? 401 : 400) : json(data);
  }

  const m = /^\/channels\/([^/]+)\/messages$/.exec(path);
  if (req.method === 'POST' && m) {
    if (!UUID.test(m[1]!)) return json({ error: 'Unknown channel.' }, 404);
    let body: { content?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Send JSON: { "content": "..." }' }, 400);
    }
    if (typeof body.content !== 'string' || !body.content.trim()) return json({ error: '"content" must be a non-empty string.' }, 400);
    const { data, error } = await sb.rpc('bot_post', { p_token: token, p_channel: m[1], p_content: body.content.slice(0, 4000) });
    if (error) return json({ error: error.message }, error.code === '42501' ? 403 : error.code === 'P0001' ? 429 : 400);
    return json({ id: data }, 201);
  }

  return json({ error: 'Not found. Try GET /me or POST /channels/<id>/messages.' }, 404);
});
