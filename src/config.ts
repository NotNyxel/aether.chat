/**
 * Built-in backend for Aether. The publishable key is designed to ship inside client apps:
 * it only grants what Row-Level Security allows a signed-in user to do. Never put a secret
 * (service_role / sb_secret_…) key here.
 *
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local override these for local development
 * against a different project.
 */
import type { BackendConfig } from './lib/supabase';

export const APP_NAME = 'Aether';

/** The web app (Vercel). Invite web links point here: WEB_APP_URL/inv/CODE. */
export const WEB_APP_URL = 'https://joinaether.vercel.app';
/** Earlier addresses of the web site; their links still work and are still recognised in chat. */
export const OLD_WEB_HOSTS = ['aether-chat-beta.vercel.app'];
/** Web Push public key (VAPID). Public by design; the private half lives only in Supabase secrets. */
export const VAPID_PUBLIC_KEY = 'BKQsG1sUNyVlsN-re2pHDe6vRUZE8sQUNuhagWzzlU2u4-Ds7MNZ1r40hKC1WF_0pDtfcfY4ZzCEfz6EFW0SL_c';
/** Always the newest Windows installer. */
export const DOWNLOAD_URL = 'https://github.com/NotNyxel/aether.chat-releases/releases/latest/download/Aether-Setup.exe';

export const BUILT_IN_BACKEND: BackendConfig = {
  url: 'https://pyjvnbjsjtbogrmoimwf.supabase.co',
  anonKey: 'sb_publishable_aW2Si2NQXIXREmYjBuFxhw_9112kqk4',
};
export const RELEASES_REPO = 'NotNyxel/aether.chat-releases';

/**
 * Cloudflare Turnstile site key (public by design). Empty = no bot check on sign-up and sign-in.
 * The matching secret goes in Supabase Auth → captcha (scripts/auth-config.mjs --captcha).
 */
export const TURNSTILE_SITE_KEY = '0x4AAAAAAF_ENSpjsctkBq4Q';
