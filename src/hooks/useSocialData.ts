/** Friends, blocks, DM / group DM conversations and calls, plus the Realtime feed that keeps them live. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useSupabase } from '../lib/supabase';
import type { Call, Conversation, Friendship, UserBlock } from '../types/db';
import { unwrap } from './useChatData';

// ── Friends & blocks ───────────────────────────────────────────────────────────────────────

export function useFriendships() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['friendships'],
    queryFn: async () => unwrap(await sb.from('friendships').select('*').order('created_at')) as Friendship[],
  });
}

export function useBlocks() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['blocks'],
    queryFn: async () => unwrap(await sb.from('user_blocks').select('*')) as UserBlock[],
  });
}

/** Ids of accepted friends for the given user. */
export function friendIds(friendships: Friendship[] | undefined, me: string): string[] {
  return (friendships ?? [])
    .filter((f) => f.status === 'accepted')
    .map((f) => (f.requester_id === me ? f.addressee_id : f.requester_id));
}

export function useFriendActions() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['friendships'] });
    void qc.invalidateQueries({ queryKey: ['blocks'] });
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => unwrap(await sb.rpc(fn, args));

  return {
    send: useMutation({
      mutationFn: async (username: string) => (await rpc('send_friend_request', { p_username: username })) as string,
      onSuccess: refresh,
    }),
    accept: useMutation({ mutationFn: (userId: string) => rpc('accept_friend_request', { p_user_id: userId }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (userId: string) => rpc('remove_friend', { p_user_id: userId }), onSuccess: refresh }),
    block: useMutation({ mutationFn: (userId: string) => rpc('block_user', { p_user_id: userId }), onSuccess: refresh }),
    unblock: useMutation({ mutationFn: (userId: string) => rpc('unblock_user', { p_user_id: userId }), onSuccess: refresh }),
  };
}

// ── Conversations ──────────────────────────────────────────────────────────────────────────

export function useConversations() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['conversations'],
    queryFn: async () =>
      unwrap(
        await sb.from('conversations').select('*, conversation_members(*)').order('last_message_at', { ascending: false }),
      ) as Conversation[],
  });
}

export function useConversationActions() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['conversations'] });
  const rpc = async (fn: string, args: Record<string, unknown>) => unwrap(await sb.rpc(fn, args));

  return {
    openDm: useMutation({ mutationFn: async (userId: string) => (await rpc('open_dm', { p_user_id: userId })) as string, onSuccess: refresh }),
    createGroup: useMutation({
      mutationFn: async ({ userIds, name }: { userIds: string[]; name?: string }) =>
        (await rpc('create_group_dm', { p_user_ids: userIds, p_name: name ?? null })) as string,
      onSuccess: refresh,
    }),
    addMember: useMutation({
      mutationFn: ({ conversationId, userId }: { conversationId: string; userId: string }) =>
        rpc('add_group_member', { p_conversation_id: conversationId, p_user_id: userId }),
      onSuccess: refresh,
    }),
    leave: useMutation({ mutationFn: (conversationId: string) => rpc('leave_conversation', { p_conversation_id: conversationId }), onSuccess: refresh }),
    rename: useMutation({
      mutationFn: async ({ conversationId, name }: { conversationId: string; name: string | null }) => {
        const { error } = await sb.from('conversations').update({ name }).eq('id', conversationId);
        if (error) throw new Error(error.message);
      },
      onSuccess: refresh,
    }),
    markRead: useMutation({
      mutationFn: (conversationId: string) => rpc('mark_conversation_read', { p_conversation_id: conversationId }),
      onSuccess: refresh,
    }),
  };
}

// ── Calls ──────────────────────────────────────────────────────────────────────────────────

export function useActiveCalls() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['calls', 'active'],
    queryFn: async () => unwrap(await sb.from('calls').select('*').is('ended_at', null)) as Call[],
  });
}

export function useCallActions() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['calls', 'active'] });
  return {
    start: useMutation({
      mutationFn: async (conversationId: string) => unwrap(await sb.rpc('start_call', { p_conversation_id: conversationId })) as string,
      onSuccess: refresh,
    }),
    end: useMutation({
      mutationFn: async (conversationId: string) => unwrap(await sb.rpc('end_call', { p_conversation_id: conversationId })),
      onSuccess: refresh,
    }),
  };
}

// ── Realtime feed ──────────────────────────────────────────────────────────────────────────

/**
 * One Realtime channel that keeps friends, conversations and calls fresh. RLS filters
 * postgres_changes per subscriber, so we only receive rows we may see. `onIncomingCall`
 * fires for new calls started by someone else, which drives the ringing UI.
 */
export function useSocialRealtime(userId: string, onIncomingCall: (call: Call) => void) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const callbackRef = useRef(onIncomingCall);
  useEffect(() => {
    callbackRef.current = onIncomingCall;
  }, [onIncomingCall]);

  useEffect(() => {
    const invalidate = (key: string[]) => () => void qc.invalidateQueries({ queryKey: key });
    const ch = sb
      .channel(`social:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, invalidate(['friendships']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, invalidate(['conversations']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, invalidate(['conversations']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, (payload) => {
        void qc.invalidateQueries({ queryKey: ['calls', 'active'] });
        if (payload.eventType === 'INSERT') {
          const call = payload.new as Call;
          if (call.started_by !== userId) callbackRef.current(call);
        }
      })
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [qc, sb, userId]);
}

/** Accept (move into DMs) or ignore (hide) a message request. */
export function useRespondRequest() {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) =>
      unwrap(await sb.rpc('respond_message_request', { p_conversation_id: id, p_accept: accept })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['unread'] });
    },
  });
}
