/**
 * Global message activity. One Realtime subscription receives every new message the user is
 * allowed to see (RLS filters per subscriber). It
 *   - keeps the unread summary (server dots, channel badges, DM counts) live, and
 *   - plays the DM / mention sound when the message lands somewhere the user isn't looking.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { playSound } from '../lib/sounds';
import { useSupabase } from '../lib/supabase';
import type { MemberRole, Message, PresenceStatus, UnreadRow } from '../types/db';

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
    const ch = sb
      .channel(`activity:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const m = payload.new as Message;
        const scopeId = m.channel_id ?? m.conversation_id;
        if (!scopeId) return;
        const mine = m.author_id === userId;
        const viewing = viewingRef.current === scopeId && document.hasFocus();
        const isDm = !!m.conversation_id;
        const mentioned =
          !mine && (m.mentions?.includes(userId) || m.mention_everyone || !!m.mention_roles?.some((id) => myRolesRef.current.has(id)));

        let known = false;
        qc.setQueryData<UnreadRow[]>(['unread'], (rows) =>
          rows?.map((r) => {
            if (r.scope_id !== scopeId) return r;
            known = true;
            if (mine || viewing) return { ...r, last_message_at: m.created_at, last_read_at: m.created_at };
            return {
              ...r,
              last_message_at: m.created_at,
              mention_count: Math.min(99, r.mention_count + (isDm || mentioned ? 1 : 0)),
            };
          }),
        );
        // New channel or conversation we haven't seen yet: refetch the summary (debounced).
        if (!known) {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => void qc.invalidateQueries({ queryKey: ['unread'] }), 800);
        }

        if (mine || viewing || statusRef.current === 'dnd') return;
        if (isDm) playSound('message');
        else if (mentioned) playSound('mention');
      })
      .subscribe();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void sb.removeChannel(ch);
    };
  }, [qc, sb, userId]);
}
