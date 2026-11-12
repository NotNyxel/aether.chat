/**
 * Global message activity. One Realtime subscription receives every new message the user is
 * allowed to see (RLS filters per subscriber). It
 *   - keeps the unread summary (server dots, channel badges, DM counts) live,
 *   - plays the DM / mention sound when the message lands somewhere the user isn't looking, and
 *   - shows a native desktop notification while the app isn't focused.
 * Per-scope notification settings (mute, level, @everyone suppression) and Do Not Disturb apply.
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { notify } from '../lib/desktop';
import { playSound } from '../lib/sounds';
import { useSupabase } from '../lib/supabase';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Conversation, MemberRole, Message, NotificationSetting, PresenceStatus, Server, UnreadRow, UserProfile } from '../types/db';
import { resolveNotify } from './useNotifications';
import { liveChannel } from '../lib/live';

type SupabaseLike = ReturnType<typeof useSupabase>;

async function profileName(qc: QueryClient, sb: SupabaseLike, id: string | null): Promise<string> {
  if (!id) return 'Someone';
  const p = await qc
    .fetchQuery({
      queryKey: ['profile', id],
      staleTime: 5 * 60_000,
      queryFn: async () => (await sb.from('users').select('*').eq('id', id).maybeSingle()).data as UserProfile | null,
    })
    .catch(() => null);
  return p?.display_name || p?.username || 'Someone';
}

function channelTitle(qc: QueryClient, channelId: string): { title: string; serverId: string | null } {
  for (const [, list] of qc.getQueriesData<Channel[]>({ queryKey: ['channels'] })) {
    const ch = list?.find((c) => c.id === channelId);
    if (ch) {
      let server: Server | undefined;
      for (const [, servers] of qc.getQueriesData<Server[]>({ queryKey: ['servers'] })) server ??= servers?.find((s) => s.id === ch.server_id);
      return { title: server ? `#${ch.name} (${server.name})` : `#${ch.name}`, serverId: ch.server_id };
    }
  }
  return { title: 'New message', serverId: null };
}

function preview(m: Message, show: boolean): string {
  if (!show) return 'New message';
  if (m.content?.trim()) return m.content.length > 180 ? `${m.content.slice(0, 177)}…` : m.content;
  if (m.poll) return `📊 ${m.poll.question}`;
  if (m.attachments?.length) return `📎 ${m.attachments.length === 1 ? m.attachments[0]!.name : `${m.attachments.length} files`}`;
  return 'New message';
}

export function useActivityFeed(userId: string, viewingScopeId: string | null, status: PresenceStatus | undefined) {
  const sb = useSupabase();
  const qc = useQueryClient();
  // Every role I hold in any server, so @role mentions can count as mentions of me.
  const { data: myRoles = [] } = useQuery({
    queryKey: ['my-roles', userId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('member_roles').select('*').eq('user_id', userId);
      if (error) throw new Error(error.message);
      return data as MemberRole[];
    },
  });
  const myRolesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    myRolesRef.current = new Set(myRoles.map((r) => r.role_id));
  }, [myRoles]);
  const viewingRef = useRef(viewingScopeId);
  const statusRef = useRef(status);
  useEffect(() => {
    viewingRef.current = viewingScopeId;
    statusRef.current = status;
  }, [viewingScopeId, status]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const stop = liveChannel(sb, `activity:${userId}`, (c) =>
      c
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const m = payload.new as Message;
        const scopeId = m.channel_id ?? m.conversation_id;
        if (!scopeId) return;
        const mine = m.author_id === userId;
        const focused = document.hasFocus();
        const viewing = viewingRef.current === scopeId && focused;
        const isDm = !!m.conversation_id;

        const settings = new Map((qc.getQueryData<NotificationSetting[]>(['notification-settings']) ?? []).map((r) => [r.scope_id, r]));
        let serverId: string | null = null;
        if (!isDm) {
          serverId = qc.getQueryData<UnreadRow[]>(['unread'])?.find((r) => r.scope_id === scopeId)?.server_id ?? channelTitle(qc, scopeId).serverId;
        }
        const rule = resolveNotify(settings, isDm ? { kind: 'conversation', id: scopeId } : { kind: 'channel', id: scopeId, serverId });
        const direct = !mine && (m.mentions?.includes(userId) || !!m.mention_roles?.some((id) => myRolesRef.current.has(id)));
        const mentioned = direct || (!mine && m.mention_everyone && !rule.suppressEveryone);
        const counts = rule.level !== 'none' && (isDm || mentioned);

        let known = false;
        qc.setQueryData<UnreadRow[]>(['unread'], (rows) =>
          rows?.map((r) => {
            if (r.scope_id !== scopeId) return r;
            known = true;
            if (mine || viewing) return { ...r, last_message_at: m.created_at, last_read_at: m.created_at };
            return { ...r, last_message_at: m.created_at, mention_count: Math.min(99, r.mention_count + (counts ? 1 : 0)) };
          }),
        );
        // New channel or conversation we haven't seen yet: refetch the summary (debounced).
        if (!known) {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => void qc.invalidateQueries({ queryKey: ['unread'] }), 800);
        }

        // Message requests (DMs from non-friends waiting for you to accept) stay quiet.
        const pendingRequest =
          isDm &&
          !!qc.getQueryData<Conversation[]>(['conversations'])?.find((c) => c.id === scopeId)?.conversation_members.find((x) => x.user_id === userId)?.request_pending;
        if (mine || viewing || statusRef.current === 'dnd' || rule.muted || rule.level === 'none' || pendingRequest) return;
        const wanted = isDm || rule.level === 'all' || mentioned;
        if (!wanted) return;

        if (isDm) playSound('message');
        else if (mentioned) playSound('mention');

        const prefs = useSettingsStore.getState().notifications;
        if (!prefs.desktop || focused) return;
        void (async () => {
          const author = await profileName(qc, sb, m.author_id);
          let title = author;
          if (!isDm) title = `${author} in ${channelTitle(qc, scopeId).title}`;
          else {
            const conv = qc.getQueryData<Conversation[]>(['conversations'])?.find((c) => c.id === scopeId);
            if (conv?.type === 'group') title = `${author} in ${conv.name || 'your group'}`;
          }
          await notify(title, preview(m, prefs.showPreview), () =>
            useUiStore.getState().goTo({ serverId: isDm ? null : serverId, scopeId, messageId: m.id }),
          );
        })();
      }),
      () => {
        // Back from sleep / background / offline: refresh unread badges, DMs, the inbox and servers.
        for (const k of [['unread'], ['conversations'], ['friendships'], ['servers'], ['mentions']]) void qc.invalidateQueries({ queryKey: k });
      },
    );
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      stop();
    };
  }, [qc, sb, userId]);
}
