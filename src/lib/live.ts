/**
 * Self-healing Realtime subscriptions, so every device stays in sync.
 *
 * A plain supabase.channel(...).subscribe() goes quiet when the connection drops: a phone or iPad
 * backgrounding the tab, a laptop sleeping, a network switch. Messages sent meanwhile never show
 * up. liveChannel():
 *   - gives each subscription a unique topic, so two parts of the app watching the same chat
 *     never collide;
 *   - rejoins with backoff after an error, timeout or close;
 *   - calls `onResync` (refetch what may have been missed) whenever it reconnects, and whenever
 *     the app comes back (tab visible again, window focused, network back online).
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

let seq = 0;
const resyncers = new Set<() => void>();
let lastWake = 0;

function wake() {
  const now = Date.now();
  if (now - lastWake < 1500) return;
  lastWake = now;
  for (const r of resyncers) r();
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  window.addEventListener('pageshow', wake);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
}

export function liveChannel(
  sb: SupabaseClient,
  name: string,
  build: (ch: RealtimeChannel) => RealtimeChannel,
  onResync: () => void,
): () => void {
  let current: RealtimeChannel | null = null;
  let stopped = false;
  let joinedOnce = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const drop = () => {
    const old = current;
    current = null;
    if (old) void sb.removeChannel(old);
  };

  const open = () => {
    if (stopped) return;
    const mine = build(sb.channel(`${name}#${++seq}`));
    current = mine;
    mine.subscribe((status) => {
      if (stopped || current !== mine) return;
      if (status === 'SUBSCRIBED') {
        if (joinedOnce) onResync(); // back after a gap: catch up
        joinedOnce = true;
        attempt = 0;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        drop();
        clearTimeout(timer);
        timer = setTimeout(open, Math.min(30_000, 1_000 * 2 ** attempt++));
      }
    });
  };

  const resync = () => {
    if (stopped) return;
    if (current?.state === 'joined') {
      onResync();
    } else {
      // Not connected (or stuck joining): reconnect now instead of waiting for the backoff.
      clearTimeout(timer);
      drop();
      attempt = 0;
      joinedOnce = true;
      open();
    }
  };

  open();
  resyncers.add(resync);
  return () => {
    stopped = true;
    clearTimeout(timer);
    resyncers.delete(resync);
    drop();
  };
}
