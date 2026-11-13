/**
 * Opens instantly: a copy of what you saw last time (your chats, servers, profiles and the latest
 * messages of your recent chats) is kept on this device and shown right away on the next start,
 * while fresh data loads in the background and replaces it.
 *
 * Only small, recent pieces are kept (the newest 40 messages of up to 15 chats), per account, and
 * the copy is dropped when you sign out or after a week.
 */
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';

const VERSION = 1;
const MAX_AGE = 7 * 24 * 3600_000;
const MAX_CHATS = 15;
const MAX_MESSAGES = 40;
const storeKey = (userId: string) => `aether.cache.${userId}`;

interface Saved {
  v: number;
  at: number;
  q: { k: QueryKey; d: unknown; t: number }[];
}

const KEEP = new Set(['profile', 'conversations', 'servers', 'channels', 'friendships', 'blocks', 'my-moderation', 'app-config', 'unread', 'notification-settings']);

function keep(key: QueryKey): boolean {
  return typeof key[0] === 'string' && (KEEP.has(key[0]) || key[0] === 'messages');
}

/** Puts last session's copy into the cache, marked as old so everything refreshes when shown. */
export function hydrateCache(qc: QueryClient, userId: string): void {
  let saved: Saved | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(storeKey(userId)) ?? 'null') as Saved | null;
  } catch {
    return;
  }
  if (!saved || saved.v !== VERSION || Date.now() - saved.at > MAX_AGE) return;
  for (const { k, d, t } of saved.q) {
    if (qc.getQueryData(k) !== undefined) continue;
    qc.setQueryData(k, d, { updatedAt: t });
    void qc.invalidateQueries({ queryKey: k, exact: true, refetchType: 'none' });
  }
}

function snapshot(qc: QueryClient): Saved {
  const all = qc.getQueryCache().getAll().filter((q) => q.state.status === 'success' && keep(q.queryKey));
  const msgs = all
    .filter((q) => q.queryKey[0] === 'messages')
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
    .slice(0, MAX_CHATS);
  const rest = all.filter((q) => q.queryKey[0] !== 'messages');
  const q: Saved['q'] = rest.map((x) => ({ k: x.queryKey, d: x.state.data, t: x.state.dataUpdatedAt }));
  for (const x of msgs) {
    const data = x.state.data as InfiniteData<{ pending?: boolean }[], unknown> | undefined;
    const first = data?.pages?.[0];
    if (!first) continue;
    q.push({ k: x.queryKey, d: { pages: [first.filter((m) => !m.pending).slice(0, MAX_MESSAGES)], pageParams: [data.pageParams[0] ?? null] }, t: x.state.dataUpdatedAt });
  }
  return { v: VERSION, at: Date.now(), q };
}

/** Keeps the on-device copy up to date (a couple of seconds after things change). Returns a stop function. */
export function persistCache(qc: QueryClient, userId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    timer = undefined;
    const data = snapshot(qc);
    try {
      localStorage.setItem(storeKey(userId), JSON.stringify(data));
    } catch {
      // Storage full: keep only the lists, without messages.
      try {
        localStorage.setItem(storeKey(userId), JSON.stringify({ ...data, q: data.q.filter((x) => x.k[0] !== 'messages') }));
      } catch {
        /* no room at all: the app just loads from the server as before */
      }
    }
  };
  const unsub = qc.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || !keep(e.query.queryKey)) return;
    timer ??= setTimeout(save, 2500);
  });
  const flush = () => document.visibilityState === 'hidden' && timer && (clearTimeout(timer), save());
  document.addEventListener('visibilitychange', flush);
  return () => {
    unsub();
    document.removeEventListener('visibilitychange', flush);
    if (timer) clearTimeout(timer);
  };
}

export function clearCache(userId: string | null): void {
  if (!userId) return;
  try {
    localStorage.removeItem(storeKey(userId));
  } catch {
    /* nothing stored */
  }
}
