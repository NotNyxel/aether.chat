/** Shared display helpers for DMs and group DMs. */
import { useNotes } from '../hooks/useAccount';
import { useQueries } from '@tanstack/react-query';
import { useProfile } from '../hooks/useChatData';
import { PresenceDot, usePresenceOf } from '../hooks/usePresence';
import { useSupabase } from '../lib/supabase';
import type { Conversation, UserProfile } from '../types/db';
import { UsersIcon } from './icons';
import { Avatar } from './ProfileCard';

export function otherMemberIds(conv: Conversation, me: string): string[] {
  return conv.conversation_members.map((m) => m.user_id).filter((id) => id !== me);
}

export function isUnread(conv: Conversation, me: string): boolean {
  const mine = conv.conversation_members.find((m) => m.user_id === me);
  return !!mine && new Date(conv.last_message_at).getTime() > new Date(mine.last_read_at).getTime() + 500;
}

/** Profiles for a set of user ids (each cached under ['profile', id], shared with useProfile). */
export function useProfiles(ids: string[]): (UserProfile | null | undefined)[] {
  const sb = useSupabase();
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['profile', id],
      staleTime: 5 * 60_000,
      queryFn: async () => {
        const { data, error } = await sb.from('users').select('*').eq('id', id).maybeSingle();
        if (error) throw new Error(error.message);
        return data as UserProfile | null;
      },
    })),
  }).map((q) => q.data);
}

export function useConversationTitle(conv: Conversation, me: string): string {
  const others = otherMemberIds(conv, me);
  const profiles = useProfiles(others);
  const { data: notes = [] } = useNotes();
  if (conv.type === 'group' && conv.name) return conv.name;
  // Your private friend nicknames win over display names.
  const names = profiles.map((p, i) => notes.find((n) => n.target_id === others[i])?.nickname || p?.display_name || p?.username || '…');
  if (names.length === 0) return conv.type === 'group' ? 'Empty group' : 'Unknown user';
  return names.join(', ');
}

export function ConversationAvatar({ conv, me, size = 32 }: { conv: Conversation; me: string; size?: number }) {
  const others = otherMemberIds(conv, me);
  const { data: other } = useProfile(conv.type === 'dm' ? others[0] : null);
  const status = usePresenceOf(conv.type === 'dm' ? others[0] : null);

  if (conv.type === 'group') {
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-ae-accent text-ae-on-accent" style={{ width: size, height: size }}>
        {conv.icon_url ? <img src={conv.icon_url} alt="" className="h-full w-full rounded-full object-cover" /> : <UsersIcon size={size * 0.5} />}
      </span>
    );
  }
  return (
    <span className="relative shrink-0">
      <Avatar profile={other} size={size} showFrame={false} />
      <PresenceDot status={status} size={Math.max(10, size * 0.34)} className="absolute -right-0.5 -bottom-0.5 z-10" />
    </span>
  );
}
