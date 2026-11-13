#!/usr/bin/env node
/**
 * Read or update the Supabase Auth configuration through the Management API.
 *   node scripts/auth-config.mjs            prints the settings aether.chat cares about
 *   node scripts/auth-config.mjs --apply    allows the app's redirect URLs (see below)
 *   node scripts/auth-config.mjs --captcha  turns on Cloudflare Turnstile with the secret in .secrets/turnstile.json
 *                                           ({ "siteKey": "...", "secret": "..." }; the site key also goes in src/config.ts)
 *   node scripts/auth-config.mjs --smtp     sends account emails through your SMTP provider (.secrets/smtp.json:
 *                                           { "host", "port", "user", "pass", "sender", "name" }), raises the email limit
 *                                           and turns sign-up confirmation back on
 * Needs a Supabase personal access token in .secrets/supabase.token (git-ignored).
 *
 * Account emails (password reset, email change, sign-up confirmation) contain a link. The app asks
 * Supabase to redirect that link to aetherchat://auth, which Windows hands to the desktop app
 * (deep link), so the link finishes signing you in right inside aether.chat. The web build uses
 * its own origin instead. Free-tier projects on the built-in email sender can't edit templates, so
 * links (not codes) are what we have to work with.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PROJECT_REF = 'pyjvnbjsjtbogrmoimwf';
const token = readFileSync(join(ROOT, '.secrets', 'supabase.token'), 'utf8').trim();
const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// The web app's address comes from src/config.ts (WEB_APP_URL).
const WEB_APP_URL = /WEB_APP_URL = '([^']+)'/.exec(readFileSync(join(ROOT, 'src', 'config.ts'), 'utf8'))?.[1];
const REDIRECTS = ['aetherchat://auth', 'http://localhost:1420', 'http://localhost:1420/**', ...(WEB_APP_URL ? [WEB_APP_URL, `${WEB_APP_URL}/**`] : [])];
const KEYS = ['site_url', 'uri_allow_list', 'mailer_autoconfirm', 'mailer_secure_email_change_enabled', 'smtp_host', 'smtp_admin_email', 'rate_limit_email_sent', 'security_captcha_enabled', 'security_captcha_provider',
  'mfa_totp_enroll_enabled', 'mfa_totp_verify_enabled', 'security_update_password_require_reauthentication'];

const get = async () => {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
};

let cfg = await get();
if (process.argv.includes('--apply')) {
  const current = String(cfg.uri_allow_list ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const merged = [...new Set([...current, ...REDIRECTS])].join(',');
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ uri_allow_list: merged }) });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exitCode = 1;
  } else {
    console.log('Applied.');
    cfg = await get();
  }
}
const patch = async (body, label) => {
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    console.error(`${label}: HTTP ${res.status}: ${await res.text()}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${label}: applied.`);
  cfg = await get();
};
const secret = (name) => JSON.parse(readFileSync(join(ROOT, '.secrets', name), 'utf8'));
if (process.argv.includes('--captcha')) {
  const t = secret('turnstile.json');
  await patch({ security_captcha_enabled: true, security_captcha_provider: 'turnstile', security_captcha_secret: t.secret }, 'Captcha');
}
if (process.argv.includes('--smtp')) {
  const m = secret('smtp.json');
  await patch(
    {
      smtp_host: m.host,
      smtp_port: String(m.port ?? 587),
      smtp_user: m.user,
      smtp_pass: m.pass,
      smtp_admin_email: m.sender,
      smtp_sender_name: m.name ?? 'Aether',
      rate_limit_email_sent: 100,
      mailer_autoconfirm: false,
    },
    'SMTP',
  );
}
console.log(JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, cfg[k] ?? null])), null, 2));
