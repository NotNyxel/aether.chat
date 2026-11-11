/** "X is typing…" over a private Realtime broadcast topic per channel or conversation. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useSupabase } from '../lib/supabase';

const SEND_THROTTLE_MS = 3_000;
const DISPLAY_TTL_MS = 5_000;

export function useTyping(scopeId: string, userId: string) {
  const sb = useSupabase();
  const [typers, setTypers] = useState<string[]>([]);
  const expiriesRef = useRef(new Map<string, number>());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let ch: RealtimeChannel | null = null;
    const expiries = expiriesRef.current;
    const publish = () => {
      const now = Date.now();
      for (const [id, until] of expiries) if (until < now) expiries.delete(id);
      setTypers([...expiries.keys()]);
    };

    void (async () => {
      await sb.realtime.setAuth();
      if (cancelled) return;
      ch = sb.channel(`typing:${scopeId}`, { config: { private: true, broadcast: { self: false } } });
      channelRef.current = ch;
      ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
        const id = (payload as { userId?: unknown }).userId;
        if (typeof id !== 'string' || id === userId) return;
        expiries.set(id, Date.now() + DISPLAY_TTL_MS);
        publish();
      });
      ch.on('broadcast', { event: 'stop' }, ({ payload }) => {
        const id = (payload as { userId?: unknown }).userId;
        if (typeof id === 'string' && expiries.delete(id)) publish();
      });
      ch.subscribe();
    })();

    const sweep = setInterval(publish, 1_000);
    return () => {
      cancelled = true;
      clearInterval(sweep);
      expiries.clear();
      setTypers([]);
      channelRef.current = null;
      if (ch) void sb.removeChannel(ch);
    };
  }, [sb, scopeId, userId]);

  /** Call on every keystroke; sends at most one broadcast per 3 s. */
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastSentRef.current < SEND_THROTTLE_MS) return;
    lastSentRef.current = now;
    void channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId } });
  }, [userId]);

  /** Call after sending a message so the indicator disappears immediately for others. */
  const notifyStopped = useCallback(() => {
    lastSentRef.current = 0;
    void channelRef.current?.send({ type: 'broadcast', event: 'stop', payload: { userId } });
  }, [userId]);

  return { typers, notifyTyping, notifyStopped };
}
