/**
 * Threads, forum posts, announcement follows and per-channel permissions.
 *
 * Threads and forum posts are rows in `channels` with `thread_parent_id` set, so messages,
 * reactions, pins, search and unread tracking all work on them unchanged. Auto-archive is
 * computed from activity (no background job): a thread is archived when it was archived by hand or
 * has been quiet for longer than its auto-archive window.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toMask } from '../lib/permissions';
import { useSupabase } from '../lib/supabase';
import type { Channel, Message } from '../types/db';
import { unwrap } from './useChatData';

export function isArchived(t: Pick<Channel, 'thread_archived_at' | 'last_message_at' | 'created_at' | 'thread_auto_archive' | 'thread_locked'>, now = Date.now()): boolean {
  if (t.thread_archived_at) return true;
  const last = Date.parse(t.last_message_at ?? t.created_at);
  return now - last > t.thread_auto_archive * 60_000;
}

/** Threads (or forum posts) in a channel, most recently active first. */
export function useThreads(parentId: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['threads', parentId],
    enabled: !!parentId,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () =>
      unwrap(
        await sb.from('channels').select('*').eq('thread_parent_id', parentId!).order('last_message_at', { ascending: false, nullsFirst: false }).limit(200),
      ) as Channel[],
  });
}

/** One channel by id (used to resolve thread links and open the right parent). */
export function useChannelById(id: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['channel', id],
    enabled: !!id,
    staleTime: 30_000,
    queryFn: async () => unwrap(await sb.from('channels').select('*').eq('id', id!).maybeSingle()) as Channel | null,
  });
}

/** The viewer's effective permissions in one channel (overwrites, threads and announcement rules). */
export function useChannelPermissions(channelId: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['channel-permissions', channelId],
    enabled: !!channelId,
    staleTime: 60_000,
    queryFn: async () => toMask(unwrap(await sb.rpc('channel_permissions', { p_channel_id: channelId })) as number | string),
  });
}

/** Thread ids the viewer has joined. */
export function useMyThreadMemberships(userId: string) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['thread-memberships', userId],
    staleTime: 60_000,
    queryFn: async () => {
      const rows = unwrap(await sb.from('thread_members').select('thread_id').eq('user_id', userId)) as { thread_id: string }[];
      return new Set(rows.map((r) => r.thread_id));
    },
  });
}

/** First message of each forum post (title + preview + media). */
export function useForumStarters(threadIds: string[]) {
  const sb = useSupabase();
  const key = [...threadIds].sort().join(',');
  return useQuery({
    queryKey: ['forum-starters', key],
    enabled: threadIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = unwrap(
        await sb.from('messages').select('*').in('channel_id', threadIds).order('created_at', { ascending: true }).limit(threadIds.length * 3),
      ) as Message[];
      const first = new Map<string, Message>();
      for (const m of rows) if (m.channel_id && !first.has(m.channel_id)) first.set(m.channel_id, m);
      return first;
    },
  });
}

export function useThreadActions(parentId: string | null) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = (thread?: Channel) => {
    void qc.invalidateQueries({ queryKey: ['threads', thread?.thread_parent_id ?? parentId] });
    if (thread) qc.setQueryData(['channel', thread.id], thread);
    void qc.invalidateQueries({ queryKey: ['thread-memberships'] });
    void qc.invalidateQueries({ queryKey: ['unread'] });
  };
  return {
    create: useMutation({
      mutationFn: async (input: { parentId: string; name: string; messageId?: string | null; private?: boolean; tags?: string[]; autoArchive?: number }) =>
        unwrap(
          await sb
            .rpc('create_thread', {
              p_parent_id: input.parentId,
              p_name: input.name,
              p_message_id: input.messageId ?? null,
              p_private: input.private ?? false,
              p_tags: input.tags ?? [],
              p_auto_archive: input.autoArchive ?? 1440,
            })
            .single(),
        ) as Channel,
      onSuccess: (t) => {
        refresh(t);
        void qc.invalidateQueries({ queryKey: ['messages'] }); // starter message gains its thread chip
      },
    }),
    update: useMutation({
      mutationFn: async (input: { id: string; name?: string; archived?: boolean; locked?: boolean; tags?: string[]; autoArchive?: number }) =>
        unwrap(
          await sb
            .rpc('update_thread', {
              p_thread_id: input.id,
              p_name: input.name ?? null,
              p_archived: input.archived ?? null,
              p_locked: input.locked ?? null,
              p_tags: input.tags ?? null,
              p_auto_archive: input.autoArchive ?? null,
            })
            .single(),
        ) as Channel,
      onSuccess: (t) => refresh(t),
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await sb.rpc('delete_thread', { p_thread_id: id })),
      onSuccess: () => {
        refresh();
        void qc.invalidateQueries({ queryKey: ['messages'] });
      },
    }),
    join: useMutation({
      mutationFn: async ({ id, join }: { id: string; join: boolean }) => unwrap(await sb.rpc('join_thread', { p_thread_id: id, p_join: join })),
      onSuccess: () => refresh(),
    }),
    addMember: useMutation({
      mutationFn: async ({ id, userId }: { id: string; userId: string }) => unwrap(await sb.rpc('add_thread_member', { p_thread_id: id, p_user_id: userId })),
      onSuccess: () => refresh(),
    }),
  };
}

export function useAnnouncementActions() {
  const sb = useSupabase();
  const qc = useQueryClient();
  return {
    publish: useMutation({
      mutationFn: async (messageId: string) => unwrap(await sb.rpc('publish_message', { p_message_id: messageId })) as number,
      onSuccess: () => void qc.invalidateQueries({ queryKey: ['messages'] }),
    }),
    follow: useMutation({
      mutationFn: async ({ source, target, follow = true }: { source: string; target: string; follow?: boolean }) =>
        unwrap(await sb.rpc('follow_channel', { p_source_id: source, p_target_id: target, p_follow: follow })),
      onSuccess: () => void qc.invalidateQueries({ queryKey: ['channel-follows'] }),
    }),
  };
}
