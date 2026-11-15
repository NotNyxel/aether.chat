/**
 * "Seen" under your latest message in DMs and groups. Uses conversation_reads(), which only shares
 * read times when both people have read receipts on (Settings → Privacy & Safety).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useProfile } from '../hooks/useChatData';
import { liveChannel } from '../lib/live';
import { useSupabase } from '../lib/supabase';
import type { Message } from '../types/db';
import { Avatar } from './ProfileCard';

export interface ReadState {
  user_id: string;
  last_read_at: string | null;
}

export function useConversationReads(conversationId: string | null) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const key = ['conversation-reads', conversationId];
  const q = useQuery({
    queryKey: key,
    enabled: !!conversationId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await sb.rpc('conversation_reads', { p_conversation_id: conversationId });
      return (data ?? []) as ReadState[];
    },
  });
  // Someone reading the chat updates their row: refresh right away.
  useEffect(() => {
    if (!conversationId) return;
    return liveChannel(sb, `reads:${conversationId}`, (c) =>
      c.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${conversationId}` }, () =>
        void qc.invalidateQueries({ queryKey: ['conversation-reads', conversationId] }),
      ),
      () => void qc.invalidateQueries({ queryKey: ['conversation-reads', conversationId] }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, sb]);
  return q.data ?? [];
}

function Face({ userId }: { userId: string }) {
  const { data } = useProfile(userId);
  return (
    <span className="rounded-full ring-2 ring-ae-bg" title={data?.display_name || data?.username}>
      <Avatar profile={data} size={16} showFrame={false} />
    </span>
  );
}

/** The line under your newest message, or nothing. */
export function SeenLine({ newest, me, reads, group }: { newest: Message | undefined; me: string; reads: ReadState[]; group: boolean }) {
  if (!newest || newest.author_id !== me || (newest as { pending?: boolean }).pending) return null;
  const at = new Date(newest.created_at).getTime();
  const seen = reads.filter((r) => r.last_read_at && new Date(r.last_read_at).getTime() >= at);
  if (!seen.length) return null;
  return (
    <li className="flex items-center justify-end gap-1.5 px-4 pt-1 text-[11px] text-ae-muted" aria-live="polite">
      {group ? (
        <>
          <span className="flex -space-x-1">
            {seen.slice(0, 5).map((r) => (
              <Face key={r.user_id} userId={r.user_id} />
            ))}
          </span>
          Seen by {seen.length}
        </>
      ) : (
        'Seen'
      )}
    </li>
  );
}
