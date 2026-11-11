// aether.chat link-preview Edge Function
// GET /functions/v1/link-preview?url=https://example.com/article
// Returns Open Graph metadata { url, title, description, image, siteName, color } for signed-in users.
//
// Safety:
//   - only http(s) URLs on public hosts; DNS answers in private, loopback or link-local ranges are refused (SSRF)
//   - redirects are followed manually (max 3) and every hop is re-checked
//   - 5 s timeout, reads at most 512 KB, HTML only
//   - results are cached in memory for 6 h per URL
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const CACHE_TTL_MS = 6 * 3600_000;
const MAX_BYTES = 512 * 1024;
const cache = new Map<string, { at: number; data: Preview | null }>();

interface Preview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  color: string | null;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } });
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('unsupported port');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('private host');
  }
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) throw new Error('private address');
    return;
  }
  const answers = [
    ...(await Deno.resolveDns(host, 'A').catch(() => [] as string[])),
    ...(await Deno.resolveDns(host, 'AAAA').catch(() => [] as string[])),
  ];
  if (answers.length === 0) throw new Error('unresolvable host');
  if (answers.some(isPrivateIp)) throw new Error('private address');
}

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const buf = new Uint8Array(Math.min(total, MAX_BYTES));
  let offset = 0;
  for (const c of chunks) {
    const slice = c.subarray(0, Math.max(0, buf.length - offset));
    buf.set(slice, offset);
    offset += slice.length;
  }
  return new TextDecoder().decode(buf);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function meta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
      'i',
    );
    const m = re.exec(html);
    const value = m?.[1] ?? m?.[2];
    if (value?.trim()) return decodeEntities(value.trim());
  }
  return null;
}

function absoluteHttps(raw: string | null, base: URL): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, base);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

async function fetchPreview(target: URL): Promise<Preview | null> {
  let current = target;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(current);
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; aether.chat-link-preview/1.0; +https://github.com/NotNyxel/aether.chat-releases)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      current = new URL(res.headers.get('location')!, current);
      continue;
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) {
      await res.body?.cancel();
      return null;
    }
    const html = await readLimited(res);
    const head = html.slice(0, html.search(/<\/head>/i) > 0 ? html.search(/<\/head>/i) : html.length);
    const title = meta(head, ['og:title', 'twitter:title']) ?? (/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1]?.trim() || null);
    const preview: Preview = {
      url: current.toString(),
      title: title ? decodeEntities(title).slice(0, 256) : null,
      description: meta(head, ['og:description', 'twitter:description', 'description'])?.slice(0, 500) ?? null,
      image: absoluteHttps(meta(head, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']), current),
      siteName: meta(head, ['og:site_name', 'application-name'])?.slice(0, 100) ?? current.hostname.replace(/^www\./, ''),
      color: meta(head, ['theme-color']),
    };
    if (preview.color && !/^#[0-9a-f]{3,8}$/i.test(preview.color)) preview.color = null;
    return preview.title || preview.description || preview.image ? preview : null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  // Only signed-in aether.chat users may use the fetcher.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'unauthorized' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) return json({ error: 'unauthorized' }, 401);

  let target: URL;
  try {
    target = new URL(new URL(req.url).searchParams.get('url') ?? '');
  } catch {
    return json({ error: 'invalid url' }, 400);
  }
  target.hash = '';
  const key = target.toString();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return json(hit.data, 200, { 'Cache-Control': 'private, max-age=21600' });

  let preview: Preview | null = null;
  try {
    preview = await fetchPreview(target);
  } catch {
    preview = null;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), data: preview });
  return json(preview, 200, { 'Cache-Control': 'private, max-age=21600' });
});
