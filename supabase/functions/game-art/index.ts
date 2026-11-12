// aether.chat game-art Edge Function
// GET /functions/v1/game-art?name=Counter-Strike%202
// Finds a game on the Steam store and returns its artwork: { name, appid, header, capsule, icon }.
// Used for "Playing …" activity cards and profile game widgets. Signed-in users only.
// Only ever contacts store.steampowered.com (fixed host, no user-supplied URLs). Cached 24 h.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const TTL = 24 * 3600_000;
const cache = new Map<string, { at: number; data: Art | null }>();

interface Art {
  name: string;
  appid: number;
  header: string;
  capsule: string;
  icon: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=86400' } });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

async function lookup(name: string): Promise<Art | null> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=US`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'aether.chat game-art' } });
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: { id: number; name: string; tiny_image?: string }[] };
  const items = data.items ?? [];
  if (!items.length) return null;
  // Prefer an exact (normalised) name match, then the first result.
  const want = norm(name);
  const hit = items.find((i) => norm(i.name) === want) ?? items.find((i) => norm(i.name).startsWith(want)) ?? items[0]!;
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${hit.id}`;
  return { name: hit.name, appid: hit.id, header: `${base}/header.jpg`, capsule: `${base}/capsule_231x87.jpg`, icon: hit.tiny_image ?? `${base}/capsule_sm_120.jpg` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'unauthorized' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) return json({ error: 'unauthorized' }, 401);

  const name = (new URL(req.url).searchParams.get('name') ?? '').trim().slice(0, 100);
  if (name.length < 2) return json({ error: 'name required' }, 400);
  const key = norm(name);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return json(hit.data);

  let art: Art | null = null;
  try {
    art = await lookup(name);
  } catch {
    art = null;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, { at: Date.now(), data: art });
  return json(art);
});
