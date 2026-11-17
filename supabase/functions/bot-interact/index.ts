// aether.chat slash commands for apps (2.1)
// POST /functions/v1/bot-interact  { channel_id, bot_id, command, args }   (signed-in user)
//
// 1. Checks, as the user, that they may post there and the command belongs to an app in that server.
// 2. Sends the app a signed POST to its interactions URL:
//      body: { type: "command", id, command, args, channel_id, server_id, user: { id, username, display_name } }
//      X-Aether-Timestamp: unix seconds
//      X-Aether-Signature: hex HMAC-SHA256(signing_secret, `${timestamp}.${body}`)
//    Apps should reject requests older than 5 minutes or with a bad signature.
// 3. If the app answers within 5 s with { "content": "..." }, posts it in the channel as the app.
//
// Safety: https only, public hosts only (DNS answers in private ranges refused), no redirects,
// 5 s timeout, at most 64 KB read.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== 'https:') throw new Error('The app’s interactions URL must use https.');
  if (url.port && url.port !== '443') throw new Error('The app’s interactions URL must use the standard port.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('The app’s interactions URL isn’t public.');
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) throw new Error('The app’s interactions URL isn’t public.');
    return;
  }
  const answers = [...(await Deno.resolveDns(host, 'A').catch(() => [] as string[])), ...(await Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]))];
  if (answers.length === 0) throw new Error('The app’s server can’t be found.');
  if (answers.some(isPrivateIp)) throw new Error('The app’s interactions URL isn’t public.');
}

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readLimited(res: Response, max = 64 * 1024): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const buf = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    const s = c.subarray(0, Math.max(0, buf.length - off));
    buf.set(s, off);
    off += s.length;
  }
  return new TextDecoder().decode(buf);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const auth = req.headers.get('authorization') ?? '';
  let input: { channel_id?: string; bot_id?: string; command?: string; args?: string };
  try {
    input = await req.json();
  } catch {
    return json({ error: 'Send JSON.' }, 400);
  }
  const { channel_id, bot_id, command } = input;
  const args = String(input.args ?? '').slice(0, 1000);
  if (!channel_id || !bot_id || !command || !/^[a-z0-9_-]{1,32}$/.test(command)) return json({ error: 'Bad request.' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await asUser.auth.getUser();
  if (!who.user) return json({ error: 'Sign in first.' }, 401);
  const check = await asUser.rpc('check_bot_command', { p_channel: channel_id, p_bot: bot_id, p_command: command });
  if (check.error) return json({ error: check.error.message }, 403);
  const serverId = check.data as string;

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: bot }, { data: profile }] = await Promise.all([
    admin.from('bots').select('id, name, interactions_url, signing_secret').eq('id', bot_id).single(),
    admin.from('users').select('id, username, display_name').eq('id', who.user.id).single(),
  ]);
  if (!bot?.interactions_url) return json({ error: `${bot?.name ?? 'This app'} isn’t set up to answer commands yet.` }, 409);

  let target: URL;
  try {
    target = new URL(bot.interactions_url);
    await assertPublicHost(target);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Bad interactions URL.' }, 409);
  }

  const body = JSON.stringify({ type: 'command', id: crypto.randomUUID(), command, args, channel_id, server_id: serverId, user: profile });
  const ts = Math.floor(Date.now() / 1000).toString();
  let reply: { content?: unknown } = {};
  try {
    const res = await fetch(target, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AetherBot/1.0', 'X-Aether-Timestamp': ts, 'X-Aether-Signature': await hmac(bot.signing_secret, `${ts}.${body}`) },
      body,
    });
    if (!res.ok) return json({ error: `${bot.name} answered with an error (${res.status}).` }, 502);
    const text = await readLimited(res);
    reply = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: `${bot.name} didn’t answer in time.` }, 504);
  }
  if (typeof reply.content !== 'string' || !reply.content.trim()) return json({ ok: true, posted: false });
  const posted = await admin.rpc('bot_reply', { p_bot: bot_id, p_channel: channel_id, p_invoker: who.user.id, p_command: command, p_content: reply.content.slice(0, 4000) });
  if (posted.error) return json({ error: posted.error.message }, 400);
  return json({ ok: true, posted: true, id: posted.data });
});
