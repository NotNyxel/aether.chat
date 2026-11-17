// aether.chat Contact us (2.2)
// POST /functions/v1/contact  { name, email, topic, message, turnstile }  (from the website, no sign-in)
//
// 1. Checks the Cloudflare Turnstile token (bots) and the fields.
// 2. Rate limit: 3 messages per 10 minutes and 10 per day for each sender (by a hash of their IP).
// 3. Stores the message (public.contact_messages, readable by app admins), then emails it to
//    CONTACT_TO through Gmail SMTP (port 465, TLS; Supabase blocks 25 and 587), with Reply-To set to
//    the sender so a reply goes straight back to them.
// Secrets: TURNSTILE_SECRET, SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM, CONTACT_TO.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const TOPICS: Record<string, string> = { question: 'Question', bug: 'Bug report', idea: 'Idea', account: 'Account help', safety: 'Safety / report', other: 'Other' };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function sha256(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  let b: { name?: unknown; email?: unknown; topic?: unknown; message?: unknown; turnstile?: unknown; website?: unknown };
  try {
    b = await req.json();
  } catch {
    return json({ error: 'Send JSON.' }, 400);
  }
  // Honeypot field: people never fill it in.
  if (typeof b.website === 'string' && b.website) return json({ ok: true });
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
  const email = typeof b.email === 'string' ? b.email.trim().slice(0, 200) : '';
  const topic = typeof b.topic === 'string' && b.topic in TOPICS ? b.topic : 'other';
  const message = typeof b.message === 'string' ? b.message.trim().slice(0, 4000) : '';
  if (!name) return json({ error: 'Please tell us your name.' }, 400);
  if (!EMAIL.test(email)) return json({ error: 'Please enter an email address we can reply to.' }, 400);
  if (message.length < 10) return json({ error: 'Your message is a bit short. Tell us a little more.' }, 400);

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown';
  const secret = Deno.env.get('TURNSTILE_SECRET');
  if (!secret) return json({ error: 'The contact form isn’t set up yet.' }, 503);
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', typeof b.turnstile === 'string' ? b.turnstile : '');
  form.append('remoteip', ip);
  const check = (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then((r) => r.json()).catch(() => null)) as { success?: boolean } | null;
  if (!check?.success) return json({ error: 'Please complete the check that you’re human, then try again.' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const ipHash = await sha256(`aether-contact:${ip}`);
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const [{ count: recent }, { count: today }] = await Promise.all([
    admin.from('contact_messages').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gt('created_at', since(10 * 60_000)),
    admin.from('contact_messages').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gt('created_at', since(86_400_000)),
  ]);
  if ((recent ?? 0) >= 3 || (today ?? 0) >= 10) return json({ error: 'You’ve sent a few messages already. Please try again later.' }, 429);

  const { data: row, error } = await admin.from('contact_messages').insert({ name, email, topic, message, ip_hash: ipHash }).select('id').single();
  if (error) return json({ error: 'Something went wrong saving your message. Please try again.' }, 500);

  try {
    const mail = nodemailer.createTransport({
      host: Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: Deno.env.get('SMTP_USER')!, pass: Deno.env.get('SMTP_PASS')! },
    });
    await mail.sendMail({
      from: `"Aether contact form" <${Deno.env.get('SMTP_FROM') ?? Deno.env.get('SMTP_USER')}>`,
      to: Deno.env.get('CONTACT_TO')!,
      replyTo: `"${name.replace(/"/g, '')}" <${email}>`,
      subject: `[Aether] ${TOPICS[topic]}: ${message.split('\n')[0]!.slice(0, 60)}`,
      text: `${TOPICS[topic]} from ${name} <${email}>\n\n${message}\n\n— Sent from the Contact us form on the Aether website. Reply to this email to answer them.\nMessage id: ${row.id}`,
    });
    await admin.from('contact_messages').update({ emailed: true }).eq('id', row.id);
  } catch (e) {
    // Saved anyway; it can be read in the database.
    console.error('contact email failed', e instanceof Error ? e.message : e);
  }
  return json({ ok: true });
});
