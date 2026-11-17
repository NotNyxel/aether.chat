// aether.chat clip relay cleanup (2.4)
// POST /functions/v1/clip-cleanup
// Deletes relay copies of shared clips once everyone has them or after 72 hours, and old
// thumbnails after 30 days. Called every 10 minutes by the database (x-push-secret) and by apps
// right after they finish downloading a clip (signed-in user), so space frees up quickly.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-push-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

  // Either the database's secret or a signed-in user.
  const secret = req.headers.get('x-push-secret');
  let allowed = false;
  if (secret) {
    const { data } = await admin.rpc('push_secret');
    allowed = !!data && data === secret;
  } else {
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('authorization') ?? '' } }, auth: { persistSession: false } });
    allowed = !!(await asUser.auth.getUser()).data.user;
  }
  if (!allowed) return json({ error: 'Not allowed.' }, 401);

  const { data: targets, error } = await admin.rpc('clip_cleanup_targets');
  if (error) return json({ error: error.message }, 500);
  let parts = 0;
  let thumbs = 0;
  for (const t of (targets ?? []) as { id: string; prefix: string; parts: boolean; thumb: boolean }[]) {
    const { data: files } = await admin.storage.from('clips').list(t.prefix, { limit: 1000 });
    const names = (files ?? []).map((f) => f.name);
    const remove = names.filter((n) => (t.parts && n.startsWith('part-')) || (t.thumb && n === 'thumb.jpg')).map((n) => `${t.prefix}/${n}`);
    for (let i = 0; i < remove.length; i += 100) await admin.storage.from('clips').remove(remove.slice(i, i + 100));
    if (t.parts) {
      await admin.from('clip_shares').update({ status: 'gone' }).eq('id', t.id);
      parts++;
    }
    if (t.thumb) {
      await admin.from('clip_shares').update({ thumb_path: null }).eq('id', t.id);
      thumbs++;
    }
  }
  return json({ ok: true, parts, thumbs });
});
