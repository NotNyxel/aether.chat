/** Home sidebar: Friends entry and the Direct Messages list (DMs + group DMs) with unread and call markers. */
import { useState } from 'react';
import { useActiveCalls, useConversationActions, useConversations, useFriendships } from '../hooks/useSocialData';
import { useUiStore } from '../stores/uiStore';
import type { Conversation } from '../types/db';
import { ConversationAvatar, isUnread, useConversationTitle } from './ConversationBits';
import { GroupDialog } from './GroupDialog';
import { CloseIcon, PhoneIcon, PlusIcon, UsersIcon } from './icons';
import { UserPanel } from './UserPanel';

function ConversationRow({ conv, me, active, inCall }: { conv: Conversation; me: string; active: boolean; inCall: boolean }) {
  const openHome = useUiStore((s) => s.openHome);
  const actions = useConversationActions();
  const title = useConversationTitle(conv, me);
  const unread = isUnread(conv, me);
  const memberCount = conv.conversation_members.length;

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => openHome(conv.id)}
        className={`flex w-full items-center gap-3 rounded-ae px-2 py-1.5 text-left ${
          active ? 'bg-ae-surface text-ae-text' : unread ? 'text-ae-text hover:bg-ae-hover' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'
        }`}
      >
        <ConversationAvatar conv={conv} me={me} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${unread ? 'font-semibold' : ''}`}>{title}</span>
          {conv.type === 'group' && <span className="block truncate text-xs text-ae-muted">{memberCount} members</span>}
        </span>
        {inCall && <PhoneIcon size={14} className="text-ae-success" />}
        {unread && !active && <span className="h-2 w-2 shrink-0 rounded-full bg-ae-text" aria-label="Unread" />}
      </button>
      <button
        type="button"
        title={conv.type === 'group' ? 'Leave group' : 'Close DM'}
        className="absolute top-1/2 right-2 hidden -translate-y-1/2 text-ae-muted group-hover:block hover:text-ae-text"
        onClick={() => {
          if (conv.type === 'group' && !window.confirm('Leave this group? You will need to be re-added to return.')) return;
          actions.leave.mutate(conv.id);
          if (active) openHome('friends');
        }}
      >
        <CloseIcon size={14} />
      </button>
    </li>
  );
}

export function HomeSidebar({ userId }: { userId: string }) {
  const homeTarget = useUiStore((s) => s.homeTarget);
  const openHome = useUiStore((s) => s.openHome);
  const { data: conversations = [] } = useConversations();
  const { data: friendships = [] } = useFriendships();
  const { data: activeCalls = [] } = useActiveCalls();
  const [groupOpen, setGroupOpen] = useState(false);

  const pending = friendships.filter((f) => f.status === 'pending' && f.addressee_id === userId).length;
  const visible = conversations.filter((c) => !c.conversation_members.find((m) => m.user_id === userId)?.hidden);
  const callIds = new Set(activeCalls.map((c) => c.conversation_id));

  return (
    <aside className="ae-panel flex w-60 shrink-0 flex-col border-r border-ae-border">
      <header className="flex h-12 items-center border-b border-ae-border px-4">
        <h2 className="font-semibold">Home</h2>
      </header>

      <div className="ae-scroll flex-1 overflow-y-auto px-2 py-3">
        <button
          type="button"
          onClick={() => openHome('friends')}
          className={`flex w-full items-center gap-3 rounded-ae px-2 py-2 text-left text-sm ${
            homeTarget === 'friends' ? 'bg-ae-surface text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'
          }`}
        >
          <UsersIcon size={20} />
          <span className="flex-1 font-medium">Friends</span>
          {pending > 0 && <span className="rounded-full bg-ae-danger px-1.5 text-xs font-bold text-white">{pending}</span>}
        </button>

        <div className="mt-4 mb-1 flex items-center justify-between px-2">
          <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Direct Messages</span>
          <button type="button" title="Create DM or group" className="text-ae-muted hover:text-ae-text" onClick={() => setGroupOpen(true)}>
            <PlusIcon size={14} />
          </button>
        </div>
        <ul className="space-y-0.5">
          {visible.length === 0 && <li className="px-2 py-3 text-xs text-ae-muted">No conversations yet. Message a friend to start one.</li>}
          {visible.map((c) => (
            <ConversationRow key={c.id} conv={c} me={userId} active={homeTarget === c.id} inCall={callIds.has(c.id)} />
          ))}
        </ul>
      </div>

      <UserPanel userId={userId} />
      {groupOpen && <GroupDialog me={userId} onClose={() => setGroupOpen(false)} />}
    </aside>
  );
}
