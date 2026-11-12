// aether.chat admin-user Edge Function
// POST /functions/v1/admin-user  { user_id, email?, password? }
// Lets app admins change another account's sign-in email or password. (Signing an account out
// everywhere is the admin_sign_out_user RPC.)
// These live in Supabase Auth, so they need the service role, which only exists here on the server.
// The caller must be signed in AND have users.is_admin; it can't target itself (use Settings) or
// another admin. Every change is written to the admin audit log.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Sign in first.' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: me, error: meErr } = await admin.auth.getUser(jwt);
  if (meErr || !me.user) return json({ error: 'Sign in first.' }, 401);
  const { data: caller } = await admin.from('users').select('is_admin').eq('id', me.user.id).maybeSingle();
  if (!caller?.is_admin) return json({ error: 'Admins only.' }, 403);

  let body: { user_id?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
  const target = String(body.user_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(target)) return json({ error: 'Pick a user.' }, 400);
  if (target === me.user.id) return json({ error: 'Change your own email or password in Settings → My Account.' }, 400);
  const { data: t } = await admin.from('users').select('id, username, is_admin').eq('id', target).maybeSingle();
  if (!t) return json({ error: "That account doesn't exist." }, 404);
  if (t.is_admin) return json({ error: 'That account is an admin. Remove their admin access first.' }, 403);

  const changes: { email?: string; email_confirm?: boolean; password?: string } = {};
  const logged: Record<string, unknown> = {};
  if (typeof body.email === 'string' && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return json({ error: "That email address doesn't look right." }, 400);
    changes.email = email;
    changes.email_confirm = true; // admins set it directly; no confirmation email round-trip
    logged.email = email;
  }
  if (typeof body.password === 'string' && body.password) {
    if (body.password.length < 8 || body.password.length > 72) return json({ error: 'Passwords need 8 to 72 characters.' }, 400);
    changes.password = body.password;
    logged.password = 'changed';
  }
  if (!changes.email && !changes.password) return json({ error: 'Nothing to change.' }, 400);

  const { error } = await admin.auth.admin.updateUserById(target, changes);
  if (error) return json({ error: error.message.includes('already') ? 'Another account already uses that email.' : error.message }, 400);

  await admin.from('admin_audit').insert({ actor_id: me.user.id, action: 'account_edited', target_id: target, target_name: t.username, details: logged });
  return json({ ok: true });
});
