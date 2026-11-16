/**
 * Quiet hours (2.0): no message sounds, pop-ups or push notifications between two times of day,
 * in your own time zone. Calls still ring. Private to you (only you can read them).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '../lib/supabase';

export interface QuietHours {
  start_at: string; // "22:00:00"
  end_at: string;
  tz: string;
}

export function useQuietHours() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['quiet-hours'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('quiet_hours').select('start_at, end_at, tz').maybeSingle();
      if (error) throw new Error(error.message);
      return (data as QuietHours | null) ?? null;
    },
  });
}

export function useSaveQuietHours() {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (q: { start_at: string; end_at: string } | null) => {
      if (!q) {
        const { error } = await sb.from('quiet_hours').delete().not('user_id', 'is', null);
        if (error) throw new Error(error.message);
        return null;
      }
      const row = { ...q, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', updated_at: new Date().toISOString() };
      const { error } = await sb.from('quiet_hours').upsert(row, { onConflict: 'user_id' });
      if (error) throw new Error(error.message);
      return row;
    },
    onSuccess: (row) => qc.setQueryData(['quiet-hours'], row ? { start_at: row.start_at, end_at: row.end_at, tz: row.tz } : null),
  });
}

const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Is it quiet hours right now? Uses the time zone they were saved in. */
export function isQuietNow(q: QuietHours | null | undefined, now = new Date()): boolean {
  if (!q) return false;
  let hm: string;
  try {
    hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: q.tz }).format(now);
  } catch {
    hm = `${now.getUTCHours()}:${now.getUTCMinutes()}`;
  }
  const n = minutes(hm), s = minutes(q.start_at), e = minutes(q.end_at);
  if (s === e) return false;
  return s < e ? n >= s && n < e : n >= s || n < e;
}
