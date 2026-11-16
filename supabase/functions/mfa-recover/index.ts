// Aether mfa-recover Edge Function
// POST /functions/v1/mfa-recover  { code }
// For someone stuck at the two-factor step (signed in with their password, but without their
// authenticator): a valid backup code removes two-factor from the account so they can get in. The
// app then asks them to set it up again. Codes are checked and used up in the database
// (use_backup_code), which also limits guessing to 5 tries per 15 minutes.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Sign in first.' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: me, error: meErr } = await admin.auth.getUser(jwt);
  if (meErr || !me.user) return json({ error: 'Sign in first.' }, 401);

  let code = '';
  try {
    code = String((await req.json())?.code ?? '').slice(0, 40);
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
  if (!code.trim()) return json({ error: 'Enter a backup code.' }, 400);

  const { data: ok, error } = await admin.rpc('use_backup_code', { p_user: me.user.id, p_code: code });
  if (error) return json({ error: error.message }, error.code === '54000' ? 429 : 400);
  if (!ok) return json({ error: 'That backup code isn’t right, or it was already used.' }, 400);

  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: me.user.id });
  for (const f of factors?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ userId: me.user.id, id: f.id });
  return json({ ok: true });
});
