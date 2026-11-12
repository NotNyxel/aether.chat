// aether.chat webhook Edge Function
// POST /functions/v1/webhook/<id>/<token>  with JSON { "content": "...", "username"?: "...", "avatar_url"?: "..." }
// Discord-compatible: tools that post to Discord webhooks can post here. Anyone with the URL can
// post, so keep it secret; public.webhook_post checks the token and allows 30 messages a minute.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const [id, token] = parts.slice(-2);
  if (!id || !token || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Unknown webhook.' }, 404);

  let body: { content?: string; username?: string; avatar_url?: string; embeds?: { title?: string; description?: string }[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Send JSON.' }, 400);
  }
  // Fold simple Discord embeds into text so common integrations still say something.
  const embedText = (body.embeds ?? []).map((e) => [e.title && `**${e.title}**`, e.description].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
  const content = [body.content, embedText].filter(Boolean).join('\n\n');

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc('webhook_post', {
    p_id: id,
    p_token: token,
    p_content: content,
    p_username: body.username ?? null,
    p_avatar: body.avatar_url ?? null,
  });
  if (error) return json({ error: error.message }, error.message.includes('Unknown') ? 404 : error.message.includes('Slow') ? 429 : 400);
  return json({ id: data });
});
