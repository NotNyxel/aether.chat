/** Saved messages: your private bookmarks (message menu → Save message; Inbox → Saved). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '../lib/supabase';
import type { Message } from '../types/db';

export interface SavedRow {
  message_id: string;
  saved_at: string;
  messages: Message | null;
}

export function useSavedMessages(enabled = true) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['saved-messages'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('saved_messages').select('message_id, saved_at, messages(*)').order('saved_at', { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      return data as unknown as SavedRow[];
    },
  });
}

export function useToggleSaved() {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ message, saved }: { message: Message; saved: boolean }) => {
      const { error } = saved ? await sb.from('saved_messages').delete().eq('message_id', message.id) : await sb.from('saved_messages').insert({ message_id: message.id });
      if (error) throw new Error(error.message);
    },
    onMutate: ({ message, saved }) =>
      qc.setQueryData<SavedRow[]>(['saved-messages'], (d) =>
        saved ? (d ?? []).filter((r) => r.message_id !== message.id) : [{ message_id: message.id, saved_at: new Date().toISOString(), messages: message }, ...(d ?? [])],
      ),
    onError: () => void qc.invalidateQueries({ queryKey: ['saved-messages'] }),
  });
}
