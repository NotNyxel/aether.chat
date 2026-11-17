/**
 * Shared lists (2.1): checklists that live in a chat. Anyone who can read the chat sees them;
 * anyone who can post there can add, tick and edit items. Live over Realtime.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { liveChannel } from '../lib/live';
import { useSupabase } from '../lib/supabase';

export interface SharedList {
  id: string;
  scope_id: string;
  title: string;
  created_by: string | null;
  created_at: string;
}
export interface SharedListItem {
  id: string;
  list_id: string;
  body: string;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  position: number;
  created_by: string | null;
}

export function useSharedLists(scopeId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const lists = useQuery({
    queryKey: ['shared-lists', scopeId],
    queryFn: async () => {
      const { data, error } = await sb.from('shared_lists').select('*').eq('scope_id', scopeId).order('created_at');
      if (error) throw new Error(error.message);
      return data as SharedList[];
    },
  });
  const items = useQuery({
    queryKey: ['shared-list-items', scopeId],
    queryFn: async () => {
      const { data, error } = await sb.from('shared_list_items').select('id, list_id, body, done, done_by, done_at, position, created_by').eq('scope_id', scopeId).order('position').limit(2000);
      if (error) throw new Error(error.message);
      return data as SharedListItem[];
    },
  });
  useEffect(() => {
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ['shared-lists', scopeId] });
      void qc.invalidateQueries({ queryKey: ['shared-list-items', scopeId] });
    };
    return liveChannel(
      sb,
      `lists:${scopeId}`,
      (c) =>
        c
          .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_lists', filter: `scope_id=eq.${scopeId}` }, refresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_list_items', filter: `scope_id=eq.${scopeId}` }, refresh),
      refresh,
    );
  }, [qc, sb, scopeId]);
  return { lists: lists.data ?? [], items: items.data ?? [], loading: lists.isLoading };
}

export function useListActions(scopeId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const itemsKey = ['shared-list-items', scopeId];
  const listsKey = ['shared-lists', scopeId];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: listsKey });
    void qc.invalidateQueries({ queryKey: itemsKey });
  };
  const check = <T>(r: { error: { message: string } | null; data?: unknown }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data as T;
  };
  return {
    createList: useMutation({
      mutationFn: async (title: string) => check<SharedList>(await sb.from('shared_lists').insert({ scope_id: scopeId, title }).select('*').single()),
      onSettled: refresh,
    }),
    renameList: useMutation({
      mutationFn: async ({ id, title }: { id: string; title: string }) => check(await sb.from('shared_lists').update({ title }).eq('id', id)),
      onSettled: refresh,
    }),
    deleteList: useMutation({
      mutationFn: async (id: string) => check(await sb.from('shared_lists').delete().eq('id', id)),
      onSettled: refresh,
    }),
    addItem: useMutation({
      mutationFn: async ({ listId, body }: { listId: string; body: string }) => check(await sb.from('shared_list_items').insert({ list_id: listId, body })),
      onSettled: refresh,
    }),
    toggleItem: useMutation({
      mutationFn: async ({ id, done }: { id: string; done: boolean }) => check(await sb.from('shared_list_items').update({ done }).eq('id', id)),
      onMutate: ({ id, done }) => qc.setQueryData<SharedListItem[]>(itemsKey, (rows) => rows?.map((r) => (r.id === id ? { ...r, done } : r))),
      onSettled: refresh,
    }),
    editItem: useMutation({
      mutationFn: async ({ id, body }: { id: string; body: string }) => check(await sb.from('shared_list_items').update({ body }).eq('id', id)),
      onSettled: refresh,
    }),
    deleteItem: useMutation({
      mutationFn: async (id: string) => check(await sb.from('shared_list_items').delete().eq('id', id)),
      onMutate: (id) => qc.setQueryData<SharedListItem[]>(itemsKey, (rows) => rows?.filter((r) => r.id !== id)),
      onSettled: refresh,
    }),
    clearDone: useMutation({
      mutationFn: async (listId: string) => check(await sb.from('shared_list_items').delete().eq('list_id', listId).eq('done', true)),
      onSettled: refresh,
    }),
  };
}
