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

export const BUILT_IN_BACKEND: BackendConfig = {
  url: 'https://pyjvnbjsjtbogrmoimwf.supabase.co',
  anonKey: 'sb_publishable_aW2Si2NQXIXREmYjBuFxhw_9112kqk4',
};
