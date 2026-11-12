/**
 * Friends → "Search for someone" (find anyone on aether.chat and message them; strangers' first
 * messages arrive as a request, limited until accepted) and → "Message requests" (accept, ignore,
 * block, or block and report as spam).
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { unwrap, useProfile } from '../hooks/useChatData';
import { useMessages } from '../hooks/useChatData';
import { useConversationActions, useConversations, useFriendActions, useRespondRequest } from '../hooks/useSocialData';
import { useSupabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import type { Conversation } from '../types/db';
import { ask } from './ConfirmDialog';
import { otherMemberIds } from './ConversationBits';
import { BlockIcon, CheckIcon, CloseIcon, FlagIcon, InboxIcon, MessageIcon, SearchIcon, UserPlusIcon } from './icons';
import { Avatar } from './ProfileCard';
import { toast } from './Toaster';

interface PersonHit {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_frame: string | null;
  accent_color: string | null;
  is_friend: boolean;
  mutual_servers: number;
}

export function SearchPeople() {
  const sb = useSupabase();
  const [q, setQ] = useState('');
  const term = q.trim();
  const convo = useConversationActions();
  const friend = useFriendActions();
  const openHome = useUiStore((s) => s.openHome);
  const showProfile = useUiStore((s) => s.showProfile);
  const { data: limit = 3 } = useQuery({
    queryKey: ['app-config', 'message_request_limit'],
    staleTime: 5 * 60_000,
    queryFn: async () => Number((unwrap(await sb.from('app_config').select('value').eq('key', 'message_request_limit').maybeSingle()) as { value: number } | null)?.value ?? 3),
  });
  const results = useQuery({
    queryKey: ['search-users', term.toLowerCase()],
    enabled: term.length >= 2,
    staleTime: 30_000,
    queryFn: async () => unwrap(await sb.rpc('search_users', { p_query: term, p_limit: 30 })) as PersonHit[],
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Search for someone</h2>
        <p className="text-sm text-ae-muted">
          Find anyone on aether.chat by username or name. If you&apos;re not friends, your first {limit} message{limit === 1 ? '' : 's'} arrive as a message request
          until they accept.
        </p>
      </div>
      <div className="relative">
        <SearchIcon size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ae-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by username or display name"
          className="ae-input h-12 w-full pl-10 text-base"
        />
      </div>
      {term.length < 2 ? (
        <Empty icon={<SearchIcon size={40} />} text="Type at least two characters." />
      ) : results.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="ae-skeleton h-14" />
          ))}
        </div>
      ) : (results.data ?? []).length === 0 ? (
        <Empty icon={<SearchIcon size={40} />} text="Nobody found. They may have turned off being found in search." />
      ) : (
        <ul className="space-y-1">
          {results.data!.map((h) => (
            <li key={h.id} className="ae-enter group flex items-center gap-3 rounded-ae border border-transparent px-3 py-2 hover:border-ae-border hover:bg-ae-hover">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => showProfile(h.id)}>
                <Avatar profile={{ username: h.username, display_name: h.display_name, avatar_url: h.avatar_url, avatar_frame: h.avatar_frame, accent_color: h.accent_color }} size={40} showFrame={false} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{h.display_name || h.username}</span>
                  <span className="block truncate text-xs text-ae-muted">
                    @{h.username}
                    {h.is_friend ? ' · Friend' : h.mutual_servers ? ` · ${h.mutual_servers} mutual server${h.mutual_servers === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
              </button>
              <button
                type="button"
                data-tip="Message"
                className="ae-press grid h-9 w-9 place-items-center rounded-full bg-ae-surface text-ae-muted hover:text-ae-text"
                onClick={() => convo.openDm.mutate(h.id, { onSuccess: (id) => openHome(id), onError: (e) => toast.error(e.message) })}
              >
                <MessageIcon size={17} />
              </button>
              {!h.is_friend && (
                <button
                  type="button"
                  data-tip="Add friend"
                  className="ae-press grid h-9 w-9 place-items-center rounded-full bg-ae-surface text-ae-muted hover:text-ae-success"
                  onClick={() => friend.send.mutate(h.username, { onSuccess: () => toast.success('Friend request sent.'), onError: (e) => toast.error(e.message) })}
                >
                  <UserPlusIcon size={17} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center text-ae-muted">
      <span className="opacity-60">{icon}</span>
      <p className="text-sm">{text}</p>
    </div>
  );
}

function RequestCard({ conv, me }: { conv: Conversation; me: string }) {
  const other = otherMemberIds(conv, me)[0] ?? null;
  const { data: p } = useProfile(other);
  const { data: pages } = useMessages({ kind: 'conversation', id: conv.id });
  const preview = (pages?.pages.flat() ?? []).filter((m) => m.author_id === other).slice(0, 3).reverse();
  const respond = useRespondRequest();
  const friend = useFriendActions();
  const openHome = useUiStore((s) => s.openHome);
  const sb = useSupabase();
  const btn = 'ae-press flex items-center gap-1.5 rounded-ae px-3 py-1.5 text-xs font-semibold';

  const blockAnd = async (report: boolean) => {
    if (!other) return;
    if (!(await ask(report ? `Block ${p?.display_name || p?.username} and report this as spam?` : `Block ${p?.display_name || p?.username}?`))) return;
    if (report) {
      const first = preview[0];
      await sb.from('reports').insert(first ? { message_id: first.id, reason: 'spam', details: 'Reported from message requests' } : { target_user_id: other, reason: 'spam', details: 'Reported from message requests' });
    }
    friend.block.mutate(other, {
      onSuccess: () => respond.mutate({ id: conv.id, accept: false }, { onSuccess: () => toast.success(report ? 'Blocked and reported.' : 'Blocked.') }),
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <li className="ae-enter space-y-3 rounded-ae border border-ae-border bg-ae-surface/40 p-4">
      <div className="flex items-center gap-3">
        <Avatar profile={p} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{p?.display_name || p?.username || '…'}</p>
          <p className="truncate text-xs text-ae-muted">@{p?.username} · not your friend</p>
        </div>
      </div>
      {preview.length > 0 ? (
        <div className="space-y-1 rounded-ae bg-ae-sunken px-3 py-2 text-sm">
          {preview.map((m) => (
            <p key={m.id} className="line-clamp-2 break-words">
              {m.content || 'Attachment'}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ae-muted italic">No messages yet.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${btn} bg-ae-accent text-ae-on-accent`} onClick={() => respond.mutate({ id: conv.id, accept: true }, { onSuccess: () => (toast.success('Request accepted.'), openHome(conv.id)) })}>
          <CheckIcon size={14} /> Accept
        </button>
        <button type="button" className={`${btn} bg-ae-surface hover:bg-ae-hover`} onClick={() => respond.mutate({ id: conv.id, accept: false })}>
          <CloseIcon size={14} /> Ignore
        </button>
        <button type="button" className={`${btn} text-ae-danger hover:bg-ae-hover`} onClick={() => void blockAnd(false)}>
          <BlockIcon size={14} /> Block
        </button>
        <button type="button" className={`${btn} text-ae-danger hover:bg-ae-hover`} onClick={() => void blockAnd(true)}>
          <FlagIcon size={14} /> Block &amp; report spam
        </button>
      </div>
    </li>
  );
}

export function useRequestConversations(me: string) {
  const { data: conversations = [] } = useConversations();
  return conversations.filter((c) => {
    const mine = c.conversation_members.find((m) => m.user_id === me);
    return mine?.request_pending && !mine.hidden;
  });
}

export function MessageRequests({ me }: { me: string }) {
  const requests = useRequestConversations(me);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Message requests</h2>
        <p className="text-sm text-ae-muted">Messages from people who aren&apos;t your friends. They can&apos;t tell whether you&apos;ve read them.</p>
      </div>
      {requests.length === 0 ? (
        <Empty icon={<InboxIcon size={40} />} text="No message requests." />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {requests.map((c) => (
            <RequestCard key={c.id} conv={c} me={me} />
          ))}
        </ul>
      )}
    </div>
  );
}
