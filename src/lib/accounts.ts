/**
 * Switch Accounts: remembers every account signed in on this device (its refresh token plus name
 * and avatar for the list) so you can hop between them without typing passwords again.
 * Nothing leaves the device. Signing out of an account removes it from the list.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SavedAccount {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  refresh_token: string;
}

const KEY = 'aether.accounts';
const AUTH_KEY = 'aether.auth';

export function savedAccounts(): SavedAccount[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedAccount[];
    return Array.isArray(v) ? v.filter((a) => a && typeof a.id === 'string' && typeof a.refresh_token === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: SavedAccount[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 5)));
  } catch {
    // storage full or blocked: switching just won't remember accounts
  }
  window.dispatchEvent(new Event('aether-accounts'));
}

function upsert(patch: Partial<SavedAccount> & { id: string }) {
  const list = savedAccounts();
  const i = list.findIndex((a) => a.id === patch.id);
  if (i >= 0) list[i] = { ...list[i]!, ...patch };
  else if (patch.refresh_token) list.unshift({ username: '', display_name: null, avatar_url: null, refresh_token: '', ...patch });
  write(list);
}

export function forgetAccount(id: string) {
  write(savedAccounts().filter((a) => a.id !== id));
}

/** Keeps the active account's refresh token current. Returns an unsubscribe. */
export function trackAccounts(sb: SupabaseClient): () => void {
  let current: string | null = null;
  const { data } = sb.auth.onAuthStateChange((event, session) => {
    if (session) {
      current = session.user.id;
      upsert({ id: session.user.id, refresh_token: session.refresh_token });
    } else if (event === 'SIGNED_OUT' && current) {
      forgetAccount(current);
      current = null;
    }
  });
  return () => data.subscription.unsubscribe();
}

/** Stores the name and avatar shown in the account switcher. */
export function rememberProfile(p: { id: string; username: string; display_name: string | null; avatar_url: string | null }) {
  const a = savedAccounts().find((x) => x.id === p.id);
  if (a && (a.username !== p.username || a.display_name !== p.display_name || a.avatar_url !== p.avatar_url))
    upsert({ id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url });
}

export async function switchAccount(sb: SupabaseClient, id: string): Promise<void> {
  const acc = savedAccounts().find((a) => a.id === id);
  if (!acc) throw new Error('That account isn’t saved on this device.');
  const { error } = await sb.auth.refreshSession({ refresh_token: acc.refresh_token });
  if (error) {
    forgetAccount(id);
    throw new Error('That account was signed out. Sign in to it again.');
  }
  location.reload();
}

/** Opens the sign-in screen while keeping the current account saved for switching back. */
export function addAccount() {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    // ignore
  }
  location.reload();
}
