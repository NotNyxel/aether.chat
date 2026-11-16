/**
 * Batch 1 data hooks: pins, polls, message search, forwarding, link previews, jump-to-message
 * loading, and per-channel / per-DM unread state.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useSupabase } from '../lib/supabase';
import type { Attachment, Message, MessageScope, PollVote, UnreadRow } from '../types/db';
import { unwrap } from './useChatData';
import { liveChannel } from '../lib/live';

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
    const stop = liveChannel(sb, `poll-votes:${scope.id}`, (c) =>
      c
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes', filter: `scope_id=eq.${scope.id}` }, () =>
        void qc.invalidateQueries({ queryKey: key }),
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'poll_votes' }, () => void qc.invalidateQueries({ queryKey: key })),
      () => void qc.invalidateQueries({ queryKey: key }),
    );
    return () => {
      stop();
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
  scope: { kind: 'conversation'; id: string } | { kind: 'channels'; ids: string[]; names?: Record<string, string> };
  raw: string;
  /** Encrypted chats: decrypts a message so it can be searched here, on the device. */
  decrypt?: (content: string) => Promise<string | null>;
}

export const HAS_KINDS = ['link', 'image', 'video', 'file', 'voice', 'sticker', 'poll'] as const;

export interface SearchFilters {
  from?: string;
  mentions?: string;
  in?: string;
  has: string[];
  before?: string;
  after?: string;
  during?: string;
  pinned?: boolean;
  oldest?: boolean;
}

/**
 * Parses `from:user mentions:user in:channel has:link|image|video|file|voice|sticker|poll pinned:true
 * before:2026-01-01 after:2025-12-01 during:2026-01-15 order:oldest free text`.
 */
export function parseSearch(raw: string) {
  const filters: SearchFilters = { has: [] };
  const text = raw
    .replace(/\b(from|mentions|in|has|before|after|during|pinned|order):(\S+)/gi, (_, key: string, value: string) => {
      const k = key.toLowerCase();
      const v = value.replace(/^[@#]/, '');
      if (k === 'from' || k === 'mentions' || k === 'in') filters[k] = v;
      else if (k === 'has') filters.has.push(v.toLowerCase());
      else if (k === 'before' || k === 'after' || k === 'during') filters[k] = v;
      else if (k === 'pinned') filters.pinned = v.toLowerCase() !== 'false';
      else if (k === 'order') filters.oldest = v.toLowerCase() === 'oldest';
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { text, filters };
}

const PAGE = 50;
const isType = (m: Message, prefix: string) => m.attachments.some((a) => a.content_type.startsWith(prefix) && !a.sticker);
const day = (d: string) => {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t;
};

/** Filters that are checked on the device (encrypted chats, and types the database can't tell apart). */
function matchesLocally(m: Message, text: string, f: SearchFilters, plain: string): boolean {
  if (text) {
    const hay = plain.toLowerCase();
    if (!text.toLowerCase().split(/\s+/).every((w) => hay.includes(w.replace(/^"|"$/g, '')))) return false;
  }
  if (f.has.includes('link') && !/https?:\/\//i.test(plain)) return false;
  if (f.has.includes('image') && !isType(m, 'image/')) return false;
  if (f.has.includes('video') && !isType(m, 'video/')) return false;
  if (f.has.includes('voice') && !isType(m, 'audio/')) return false;
  if (f.has.includes('sticker') && !m.attachments.some((a) => a.sticker)) return false;
  if (f.has.includes('file') && !m.attachments.some((a) => !a.sticker)) return false;
  return true;
}

export function useMessageSearch(query: SearchQuery | null, pages = 1) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['search', query?.scope, query?.raw, !!query?.decrypt, pages],
    enabled: !!query && query.raw.trim().length > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<{ rows: Message[]; more: boolean }> => {
      const { text, filters: f } = parseSearch(query!.raw);
      const local = !!query!.decrypt;
      // Encrypted chats can't be searched on the server: look through the latest messages here.
      const limit = local ? 1500 : PAGE * pages + 1;
      let q = sb.from('messages').select('*').order('created_at', { ascending: !!f.oldest }).limit(limit);
      if (query!.scope.kind === 'conversation') q = q.eq('conversation_id', query!.scope.id);
      else {
        let ids = query!.scope.ids;
        if (f.in) {
          const names = query!.scope.names ?? {};
          ids = ids.filter((id) => (names[id] ?? '').toLowerCase() === f.in!.toLowerCase());
          if (!ids.length) return { rows: [], more: false };
        }
        q = q.in('channel_id', ids);
      }
      if (text && !local) q = q.textSearch('content', text, { type: 'websearch', config: 'simple' });
      for (const key of ['from', 'mentions'] as const) {
        if (!f[key]) continue;
        const user = unwrap(await sb.from('users').select('id').ilike('username', f[key]!).maybeSingle()) as { id: string } | null;
        if (!user) return { rows: [], more: false };
        q = key === 'from' ? q.eq('author_id', user.id) : q.contains('mentions', [user.id]);
      }
      const before = f.before && day(f.before);
      const after = f.after && day(f.after);
      const during = f.during && day(f.during);
      if (before) q = q.lt('created_at', before.toISOString());
      if (after) q = q.gt('created_at', after.toISOString());
      if (during) q = q.gte('created_at', during.toISOString()).lt('created_at', new Date(during.getTime() + 86_400_000).toISOString());
      if (f.pinned) q = q.eq('pinned', true);
      if (f.has.includes('link') && !local) q = q.ilike('content', '%http%');
      if (f.has.includes('poll')) q = q.not('poll', 'is', null);
      if (f.has.some((h) => ['file', 'image', 'video', 'voice', 'sticker'].includes(h))) q = q.neq('attachments', '[]');
      const fetched = unwrap(await q) as Message[];
      const out: Message[] = [];
      for (const m of fetched) {
        const plain = local && m.content ? ((await query!.decrypt!(m.content)) ?? '') : m.content;
        if (matchesLocally(m, local ? text : '', f, plain)) out.push(m);
      }
      const want = PAGE * pages;
      return { rows: out.slice(0, want), more: out.length > want || (!local && fetched.length > want) };
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
