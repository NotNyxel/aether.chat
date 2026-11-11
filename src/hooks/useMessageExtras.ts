/**
 * Batch 1 data hooks: pins, polls, message search, forwarding, link previews, jump-to-message
 * loading, and per-channel / per-DM unread state.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useSupabase } from '../lib/supabase';
import type { Attachment, Message, MessageScope, PollVote, UnreadRow } from '../types/db';
import { unwrap } from './useChatData';

const scopeColumn = (scope: MessageScope) => (scope.kind === 'channel' ? 'channel_id' : 'conversation_id');

// ── Pins ───────────────────────────────────────────────────────────────────────────────────

export function usePinnedMessages(scope: MessageScope, enabled: boolean) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['pins', scope.id],
    enabled,
    queryFn: async () =>
      unwrap(
        await sb.from('messages').select('*').eq(scopeColumn(scope), scope.id).eq('pinned', true).order('pinned_at', { ascending: false }).limit(50),
      ) as Message[],
  });
}

export function useTogglePin(scope: MessageScope) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) =>
      unwrap(await sb.from('messages').update({ pinned }).eq('id', id).select('*').single()) as Message,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pins', scope.id] }),
  });
}

// ── Polls ──────────────────────────────────────────────────────────────────────────────────

/** Every poll vote in a scope, kept live. */
export function usePollVotes(scope: MessageScope) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['poll-votes', scope.id],
    staleTime: Infinity,
    queryFn: async () => unwrap(await sb.from('poll_votes').select('*').eq('scope_id', scope.id).limit(10_000)) as PollVote[],
  });

  useEffect(() => {
    const key = ['poll-votes', scope.id];
    const ch = sb
      .channel(`poll-votes:${scope.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes', filter: `scope_id=eq.${scope.id}` }, () =>
        void qc.invalidateQueries({ queryKey: key }),
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'poll_votes' }, () => void qc.invalidateQueries({ queryKey: key }))
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [qc, sb, scope.id]);

  return query;
}

export function useVotePoll(scope: MessageScope, userId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, optionIds }: { messageId: string; optionIds: number[] }) =>
      unwrap(await sb.rpc('vote_poll', { p_message_id: messageId, p_option_ids: optionIds })),
    onMutate: ({ messageId, optionIds }) => {
      qc.setQueryData<PollVote[]>(['poll-votes', scope.id], (d) => [
        ...(d ?? []).filter((v) => !(v.message_id === messageId && v.user_id === userId)),
        ...optionIds.map((o) => ({ message_id: messageId, user_id: userId, option_id: o, scope_id: scope.id, created_at: new Date().toISOString() })),
      ]);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['poll-votes', scope.id] }),
  });
}

export interface PollDraft {
  question: string;
  options: { text: string; emoji?: string | null }[];
  multi: boolean;
  duration_hours: 1 | 4 | 8 | 24 | 72 | 168;
}

// ── Forwarding ─────────────────────────────────────────────────────────────────────────────

export function useForwardMessage() {
  const sb = useSupabase();
  return useMutation({
    mutationFn: async ({ message, target, comment }: { message: Message; target: MessageScope; comment: string }) => {
      const col = scopeColumn(target);
      unwrap(
        await sb
          .from('messages')
          .insert({
            [col]: target.id,
            content: message.content,
            attachments: message.attachments as Attachment[],
            forwarded_from: { message_id: message.id },
          })
          .select('id')
          .single(),
      );
      if (comment.trim()) unwrap(await sb.from('messages').insert({ [col]: target.id, content: comment.trim() }).select('id').single());
    },
  });
}

// ── Search ─────────────────────────────────────────────────────────────────────────────────

export interface SearchQuery {
  /** Where to search: one conversation, or every text channel id of a server. */
  scope: { kind: 'conversation'; id: string } | { kind: 'channels'; ids: string[] };
  raw: string;
}

/** Parses `from:user has:link|file|image|poll pinned:true before:2026-01-01 after:2025-12-01 free text`. */
export function parseSearch(raw: string) {
  const filters: { from?: string; has: string[]; before?: string; after?: string; pinned?: boolean } = { has: [] };
  const text = raw
    .replace(/\b(from|has|before|after|pinned):(\S+)/gi, (_, key: string, value: string) => {
      const k = key.toLowerCase();
      if (k === 'from') filters.from = value.replace(/^@/, '');
      else if (k === 'has') filters.has.push(value.toLowerCase());
      else if (k === 'before' || k === 'after') filters[k] = value;
      else if (k === 'pinned') filters.pinned = value.toLowerCase() !== 'false';
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { text, filters };
}

export function useMessageSearch(query: SearchQuery | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['search', query],
    enabled: !!query && query.raw.trim().length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { text, filters } = parseSearch(query!.raw);
      let q = sb.from('messages').select('*').order('created_at', { ascending: false }).limit(100);
      q = query!.scope.kind === 'conversation' ? q.eq('conversation_id', query!.scope.id) : q.in('channel_id', query!.scope.ids);
      if (text) q = q.textSearch('content', text, { type: 'websearch', config: 'simple' });
      if (filters.from) {
        const user = unwrap(await sb.from('users').select('id').eq('username', filters.from).maybeSingle()) as { id: string } | null;
        if (!user) return [] as Message[];
        q = q.eq('author_id', user.id);
      }
      if (filters.before) q = q.lt('created_at', new Date(filters.before).toISOString());
      if (filters.after) q = q.gt('created_at', new Date(filters.after).toISOString());
      if (filters.pinned) q = q.eq('pinned', true);
      if (filters.has.includes('link')) q = q.ilike('content', '%http%');
      if (filters.has.includes('poll')) q = q.not('poll', 'is', null);
      if (filters.has.includes('file') || filters.has.includes('image') || filters.has.includes('video')) q = q.neq('attachments', '[]');
      let rows = unwrap(await q) as Message[];
      if (filters.has.includes('image')) rows = rows.filter((m) => m.attachments.some((a) => a.content_type.startsWith('image/')));
      if (filters.has.includes('video')) rows = rows.filter((m) => m.attachments.some((a) => a.content_type.startsWith('video/')));
      return rows.slice(0, 50);
    },
  });
}

// ── Link previews ──────────────────────────────────────────────────────────────────────────

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  color: string | null;
}

export function useLinkPreview(url: string) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['link-preview', url],
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await sb.functions.invoke(`link-preview?url=${encodeURIComponent(url)}`, { method: 'GET' });
      if (error) return null;
      return (data ?? null) as LinkPreview | null;
    },
  });
}

// ── Unread state ───────────────────────────────────────────────────────────────────────────

export function useUnreadSummary() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['unread'],
    staleTime: 60_000,
    queryFn: async () => unwrap(await sb.rpc('unread_summary')) as UnreadRow[],
  });
}

export function isRowUnread(row: UnreadRow | undefined): boolean {
  return !!row?.last_message_at && (!row.last_read_at || new Date(row.last_message_at) > new Date(row.last_read_at));
}

/** Marks a channel or conversation read (optimistically clears its badge). */
export function useMarkRead() {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useCallback(
    (scope: MessageScope) => {
      const now = new Date().toISOString();
      qc.setQueryData<UnreadRow[]>(['unread'], (rows) =>
        rows?.map((r) => (r.scope_id === scope.id ? { ...r, last_read_at: now, mention_count: 0 } : r)),
      );
      const rpc = scope.kind === 'channel' ? 'mark_channel_read' : 'mark_conversation_read';
      const arg = scope.kind === 'channel' ? { p_channel_id: scope.id } : { p_conversation_id: scope.id };
      void sb.rpc(rpc, arg).then(() => {
        if (scope.kind === 'conversation') void qc.invalidateQueries({ queryKey: ['conversations'] });
      });
    },
    [qc, sb],
  );
}
