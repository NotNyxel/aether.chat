/**
 * Built-in backend for aether.chat. The publishable key is designed to ship inside client apps:
 * it only grants what Row-Level Security allows a signed-in user to do. Never put a secret
 * (service_role / sb_secret_…) key here.
 *
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local override these for local development
 * against a different project.
 */
import type { BackendConfig } from './lib/supabase';

export const APP_NAME = 'aether.chat';

/** The web app (Vercel). Invite web links point here: WEB_APP_URL/inv/CODE. */
export const WEB_APP_URL = 'https://aether-chat-beta.vercel.app';
/** Web Push public key (VAPID). Public by design; the private half lives only in Supabase secrets. */
export const VAPID_PUBLIC_KEY = 'BKQsG1sUNyVlsN-re2pHDe6vRUZE8sQUNuhagWzzlU2u4-Ds7MNZ1r40hKC1WF_0pDtfcfY4ZzCEfz6EFW0SL_c';
/** Always the newest Windows installer. */
export const DOWNLOAD_URL = 'https://github.com/NotNyxel/aether.chat-releases/releases/latest/download/aether.chat-Setup.exe';

export const BUILT_IN_BACKEND: BackendConfig = {
  url: 'https://pyjvnbjsjtbogrmoimwf.supabase.co',
  anonKey: 'sb_publishable_aW2Si2NQXIXREmYjBuFxhw_9112kqk4',
};
