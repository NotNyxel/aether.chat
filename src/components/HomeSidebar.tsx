/** Home sidebar: Friends entry and the Direct Messages list (DMs + group DMs) with unread and call markers. */
import { openQuickSwitcher } from './QuickSwitcher';
import { ask } from './ConfirmDialog';
import { useUserMenu } from '../hooks/useUserMenu';
import { openContextMenu } from './ContextMenu';
import { useState } from 'react';
import { useMarkRead, useUnreadSummary } from '../hooks/useMessageExtras';
import { muteUntil, useNotifyResolver, useSetNotificationSetting } from '../hooks/useNotifications';
import { useActiveCalls, useConversationActions, useConversations, useFriendships } from '../hooks/useSocialData';
import { useUiStore } from '../stores/uiStore';
import type { Conversation } from '../types/db';
import { ConversationAvatar, isUnread, useConversationTitle } from './ConversationBits';
import { GroupDialog } from './GroupDialog';
import { useProfile } from '../hooks/useChatData';
import { ActivityLine } from './ActivityCards';
import { BellIcon, BellOffIcon, CheckIcon, CloseIcon, InboxIcon, PhoneIcon, PlusIcon, SearchIcon, UsersIcon } from './icons';
import { useRequestConversations } from './FriendsExtras';
import { UserPanel } from './UserPanel';
import { plateProps } from '../lib/cosmetics';

function ConversationRow({ conv, me, active, inCall, count: rawCount, muted }: {
  conv: Conversation;
  me: string;
  active: boolean;
  inCall: boolean;
  count: number;
  muted: boolean;
}) {
  const openHome = useUiStore((s) => s.openHome);
  const actions = useConversationActions();
  const title = useConversationTitle(conv, me);
  const unread = !muted && isUnread(conv, me);
  const count = muted ? 0 : rawCount;
  const memberCount = conv.conversation_members.length;
  const userMenu = useUserMenu(me);
  const markRead = useMarkRead();
  const setNotify = useSetNotificationSetting();
  const other = conv.type === 'dm' ? conv.conversation_members.find((m) => m.user_id !== me)?.user_id : undefined;
  const { data: otherProfile } = useProfile(other ?? null);
  const dmItems = [
    { label: 'Mark as read', icon: <CheckIcon size={15} />, disabled: !unread && !count, onClick: () => markRead({ kind: 'conversation' as const, id: conv.id }) },
    muted
      ? { label: 'Unmute', icon: <BellIcon size={15} />, onClick: () => setNotify.mutate({ scopeId: conv.id, kind: 'conversation', patch: { muted_until: null } }) }
      : { label: 'Mute for 1 hour', icon: <BellOffIcon size={15} />, onClick: () => setNotify.mutate({ scopeId: conv.id, kind: 'conversation', patch: { muted_until: muteUntil(60) } }) },
    {
      label: conv.type === 'group' ? 'Leave group' : 'Close DM',
      icon: <CloseIcon size={15} />,
      danger: conv.type === 'group',
      onClick: async () => {
        if (conv.type === 'group' && !(await ask('Leave this group? You will need to be re-added to return.'))) return;
        actions.leave.mutate(conv.id);
        if (active) openHome('friends');
      },
    },
  ];

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => openHome(conv.id)}
        onContextMenu={(e) => (other ? userMenu(e, other, ['divider', ...dmItems]) : openContextMenu(e, dmItems))}
        {...plateProps(otherProfile?.nameplate, otherProfile?.decor)}
        className={`ae-plate flex w-full items-center gap-3 rounded-ae px-2 py-1.5 text-left ${
          active ? 'bg-ae-surface text-ae-text' : unread ? 'text-ae-text hover:bg-ae-hover' : `text-ae-muted hover:bg-ae-hover hover:text-ae-text ${muted ? 'opacity-50' : ''}`
        }`}
      >
        <ConversationAvatar conv={conv} me={me} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${unread ? 'font-semibold' : ''}`}>{title}</span>
          {conv.type === 'group' ? (
            <span className="block truncate text-xs text-ae-muted">{memberCount} members</span>
          ) : (
            other && (
              <span className="block truncate text-xs text-ae-muted empty:hidden">
                <ActivityLine userId={other} />
              </span>
            )
          )}
        </span>
        {inCall && <PhoneIcon size={14} className="text-ae-success" />}
        {!active && count > 0 ? (
          <span className="shrink-0 rounded-full bg-ae-danger px-1.5 text-[11px] font-bold text-white" aria-label={`${count} unread`}>
            {count > 99 ? '99+' : count}
          </span>
        ) : (
          unread && !active && <span className="h-2 w-2 shrink-0 rounded-full bg-ae-text" aria-label="Unread" />
        )}
      </button>
      <button
        type="button"
        title={conv.type === 'group' ? 'Leave group' : 'Close DM'}
        className="absolute top-1/2 right-2 hidden -translate-y-1/2 text-ae-muted group-hover:block hover:text-ae-text"
        onClick={async () => {
          if (conv.type === 'group' && !(await ask('Leave this group? You will need to be re-added to return.'))) return;
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
  const { data: unread = [] } = useUnreadSummary();
  const counts = new Map(unread.map((r) => [r.scope_id, r.mention_count]));
  const { resolve } = useNotifyResolver();

  const requestCount = useRequestConversations(userId).length;
  const pending = friendships.filter((f) => f.status === 'pending' && f.addressee_id === userId).length;
  const mine = (c: Conversation) => c.conversation_members.find((m) => m.user_id === userId);
  const visible = conversations.filter((c) => !mine(c)?.hidden && !mine(c)?.request_pending);

  const callIds = new Set(activeCalls.map((c) => c.conversation_id));

  return (
    <aside className="ae-panel flex w-60 shrink-0 flex-col border-r border-ae-border">
      <header className="flex h-12 items-center border-b border-ae-border px-2.5">
        <button
          type="button"
          onClick={openQuickSwitcher}
          className="flex h-8 w-full items-center gap-2 rounded-md bg-ae-sunken px-2.5 text-left text-[13px] text-ae-muted transition-colors hover:text-ae-text"
        >
          <SearchIcon size={14} />
          Find or start a conversation
        </button>
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
        <button
          type="button"
          onClick={() => openHome('requests')}
          className={`mt-0.5 flex w-full items-center gap-3 rounded-ae px-2 py-2 text-left text-sm ${
            homeTarget === 'requests' ? 'bg-ae-surface text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'
          }`}
        >
          <InboxIcon size={20} />
          <span className="flex-1 font-medium">Message requests</span>
          {requestCount > 0 && <span className="rounded-full bg-ae-danger px-1.5 text-xs font-bold text-white">{requestCount}</span>}
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
            <ConversationRow key={c.id} conv={c} me={userId} active={homeTarget === c.id} inCall={callIds.has(c.id)} count={counts.get(c.id) ?? 0} muted={resolve({ kind: 'conversation', id: c.id }).muted} />
          ))}
        </ul>
      </div>

      <UserPanel userId={userId} />
      {groupOpen && <GroupDialog me={userId} onClose={() => setGroupOpen(false)} />}
    </aside>
  );
}
