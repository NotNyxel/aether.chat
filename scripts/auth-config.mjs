#!/usr/bin/env node
/**
 * Read or update the Supabase Auth configuration through the Management API.
 *   node scripts/auth-config.mjs            prints the settings aether.chat cares about
 *   node scripts/auth-config.mjs --apply    allows the app's redirect URLs (see below)
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

const REDIRECTS = ['aetherchat://auth', 'http://localhost:1420', 'http://localhost:1420/**'];
const KEYS = ['site_url', 'uri_allow_list', 'mailer_autoconfirm', 'mailer_secure_email_change_enabled', 'smtp_host', 'rate_limit_email_sent',
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
console.log(JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, cfg[k] ?? null])), null, 2));
