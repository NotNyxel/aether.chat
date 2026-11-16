/**
 * Your own organisation of chats (2.0): pinned chats stay on top, archived ones move out of the
 * list, folders group chats (Family, Friends…), and each chat can have its own notification sound.
 * Stored per account in chat_prefs / chat_folders (private to you), so it follows you everywhere.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSupabase } from '../lib/supabase';
import type { Conversation } from '../types/db';

export interface ChatPref {
  scope_id: string;
  pinned_at: string | null;
  archived: boolean;
  folder_id: string | null;
  sound: string | null;
}
export interface ChatFolder {
  id: string;
  name: string;
  emoji: string | null;
  position: number;
}

export function useChatPrefs() {
  const sb = useSupabase();
  const q = useQuery({
    queryKey: ['chat-prefs'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('chat_prefs').select('scope_id, pinned_at, archived, folder_id, sound');
      if (error) throw new Error(error.message);
      return data as ChatPref[];
    },
  });
  return new Map((q.data ?? []).map((p) => [p.scope_id, p]));
}

export function useChatFolders() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['chat-folders'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('chat_folders').select('id, name, emoji, position').order('position').order('name');
      if (error) throw new Error(error.message);
      return data as ChatFolder[];
    },
  }).data ?? [];
}

/** Change one chat's pin / archive / folder / sound. Applied instantly, saved in the background. */
export function useSetChatPref() {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scopeId, patch }: { scopeId: string; patch: Partial<Omit<ChatPref, 'scope_id'>> }) => {
      const { error } = await sb.from('chat_prefs').upsert({ scope_id: scopeId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id,scope_id' });
      if (error) throw new Error(error.message);
    },
    onMutate: ({ scopeId, patch }) => {
      qc.setQueryData<ChatPref[]>(['chat-prefs'], (rows = []) => {
        const cur = rows.find((r) => r.scope_id === scopeId) ?? { scope_id: scopeId, pinned_at: null, archived: false, folder_id: null, sound: null };
        return [...rows.filter((r) => r.scope_id !== scopeId), { ...cur, ...patch }];
      });
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['chat-prefs'] }),
  });
}

export function useFolderActions() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['chat-folders'] });
    void qc.invalidateQueries({ queryKey: ['chat-prefs'] });
  };
  return {
    create: useMutation({
      mutationFn: async ({ name, emoji }: { name: string; emoji?: string | null }) => {
        const { data, error } = await sb.from('chat_folders').insert({ name: name.trim().slice(0, 32), emoji: emoji ?? null }).select('id').single();
        if (error) throw new Error(error.message.includes('row-level') ? 'You can have up to 20 folders.' : error.message);
        return (data as { id: string }).id;
      },
      onSuccess: refresh,
    }),
    rename: useMutation({
      mutationFn: async ({ id, name }: { id: string; name: string }) => {
        const { error } = await sb.from('chat_folders').update({ name: name.trim().slice(0, 32) }).eq('id', id);
        if (error) throw new Error(error.message);
      },
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await sb.from('chat_folders').delete().eq('id', id);
        if (error) throw new Error(error.message);
      },
      onSuccess: refresh,
    }),
  };
}

/** Which slice of your chats is showing: everything, one folder, or the archive. Remembered per device. */
export const useChatFilter = create<{ filter: string; setFilter: (f: string) => void }>()(
  persist((set) => ({ filter: 'all', setFilter: (filter) => set({ filter }) }), { name: 'aether.chatFilter' }),
);

/** The chats to show for a filter, pinned first (most recently pinned on top), then by activity. */
export function organizeChats(convs: Conversation[], prefs: Map<string, ChatPref>, filter: string): Conversation[] {
  const pick = convs.filter((c) => {
    const p = prefs.get(c.id);
    if (filter === 'archived') return !!p?.archived;
    if (p?.archived) return false;
    if (filter === 'all') return true;
    return p?.folder_id === filter;
  });
  return pick.sort((a, b) => {
    const pa = prefs.get(a.id)?.pinned_at;
    const pb = prefs.get(b.id)?.pinned_at;
    if (pa && pb) return pb.localeCompare(pa);
    if (pa) return -1;
    if (pb) return 1;
    return (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '');
  });
}
