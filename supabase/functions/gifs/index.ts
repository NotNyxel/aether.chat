// Aether gifs Edge Function: GIF search for the GIF picker, through GIPHY.
// GET /functions/v1/gifs?q=cats&offset=0        search
// GET /functions/v1/gifs?offset=0               trending
// Signed-in users only. The GIPHY key stays here (Supabase secret GIPHY_API_KEY), never in the app.
// Results are cached in memory for 10 minutes per query and page.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const cache = new Map<string, { at: number; body: string }>();
const TTL = 10 * 60_000;

function json(body: unknown, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

interface GiphyImage {
  url?: string;
  webp?: string;
  mp4?: string;
  width?: string;
  height?: string;
}
interface GiphyGif {
  id: string;
  title: string;
  images: Record<string, GiphyImage>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Sign in first.' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) return json({ error: 'Sign in first.' }, 401);

  const key = Deno.env.get('GIPHY_API_KEY');
  if (!key) return json({ error: 'GIF search isn’t set up on this server yet.', setup: true }, 503);

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 50);
  const offset = Math.max(0, Math.min(4900, Number(url.searchParams.get('offset')) || 0));
  const cacheKey = `${q.toLowerCase()}|${offset}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL) return json(hit.body);

  const api = new URL(q ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending');
  api.searchParams.set('api_key', key);
  api.searchParams.set('limit', '30');
  api.searchParams.set('offset', String(offset));
  api.searchParams.set('rating', 'pg-13');
  api.searchParams.set('bundle', 'messaging_non_clips');
  if (q) api.searchParams.set('q', q);
  const res = await fetch(api, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!res?.ok) return json({ error: 'GIF search is unavailable right now.' }, 502);
  const body = (await res.json()) as { data: GiphyGif[]; pagination?: { total_count?: number } };

  const gifs = body.data
    .map((g) => {
      const full = g.images.original ?? g.images.downsized;
      const small = g.images.fixed_width ?? g.images.fixed_width_downsampled ?? full;
      if (!full?.mp4 && !full?.url) return null;
      return {
        id: g.id,
        title: g.title || 'GIF',
        // In chat: the MP4 when there is one (much smaller than the .gif), otherwise the GIF.
        url: full.mp4 ?? full.url,
        type: full.mp4 ? 'video/mp4' : 'image/gif',
        width: Number(full.width) || 480,
        height: Number(full.height) || 270,
        preview: small?.webp ?? small?.url ?? full.url,
        previewWidth: Number(small?.width) || 200,
        previewHeight: Number(small?.height) || 112,
      };
    })
    .filter(Boolean);
  const out = JSON.stringify({ gifs, next: offset + 30 < (body.pagination?.total_count ?? 0) ? offset + 30 : null });
  cache.set(cacheKey, { at: Date.now(), body: out });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return json(out);
});
