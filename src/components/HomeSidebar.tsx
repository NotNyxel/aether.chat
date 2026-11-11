/** Home sidebar: Friends entry and the Direct Messages list (DMs + group DMs) with unread and call markers. */
import { ask } from './ConfirmDialog';
import { useUserMenu } from '../hooks/useUserMenu';
import { openContextMenu } from './ContextMenu';
import { useState } from 'react';
import { useMarkRead, useUnreadSummary } from '../hooks/useMessageExtras';
import { muteUntil, useNotifyResolver, useSetNotificationSetting } from '../hooks/useNotifications';
import { useActiveCalls, useConversationActions, useConversations, useFriendships, useRespondRequest } from '../hooks/useSocialData';
import { useUiStore } from '../stores/uiStore';
import type { Conversation } from '../types/db';
import { ConversationAvatar, isUnread, useConversationTitle } from './ConversationBits';
import { GroupDialog } from './GroupDialog';
import { CloseIcon, MessageIcon, PhoneIcon, PlusIcon, UsersIcon } from './icons';
import { toast } from './Toaster';
import { UserPanel } from './UserPanel';

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
  const dmItems = [
    { label: 'Mark as read', icon: '✓', disabled: !unread && !count, onClick: () => markRead({ kind: 'conversation' as const, id: conv.id }) },
    muted
      ? { label: 'Unmute', icon: '🔔', onClick: () => setNotify.mutate({ scopeId: conv.id, kind: 'conversation', patch: { muted_until: null } }) }
      : { label: 'Mute for 1 hour', icon: '🔕', onClick: () => setNotify.mutate({ scopeId: conv.id, kind: 'conversation', patch: { muted_until: muteUntil(60) } }) },
    {
      label: conv.type === 'group' ? 'Leave group' : 'Close DM',
      icon: '✕',
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
        className={`flex w-full items-center gap-3 rounded-ae px-2 py-1.5 text-left ${
          active ? 'bg-ae-surface text-ae-text' : unread ? 'text-ae-text hover:bg-ae-hover' : `text-ae-muted hover:bg-ae-hover hover:text-ae-text ${muted ? 'opacity-50' : ''}`
        }`}
      >
        <ConversationAvatar conv={conv} me={me} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${unread ? 'font-semibold' : ''}`}>{title}</span>
          {conv.type === 'group' && <span className="block truncate text-xs text-ae-muted">{memberCount} members</span>}
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

function RequestRow({ conv, me, onOpen, onAccept, onIgnore }: { conv: Conversation; me: string; onOpen: () => void; onAccept: () => void; onIgnore: () => void }) {
  const title = useConversationTitle(conv, me);
  return (
    <li className="rounded-ae p-1.5 hover:bg-ae-hover">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={onOpen}>
        <ConversationAvatar conv={conv} me={me} size={28} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
      </button>
      <div className="mt-1.5 flex gap-1.5">
        <button type="button" className="ae-press flex-1 rounded-ae bg-ae-accent py-1 text-xs font-semibold text-ae-on-accent" onClick={onAccept}>
          Accept
        </button>
        <button type="button" className="ae-press flex-1 rounded-ae bg-ae-surface py-1 text-xs hover:bg-ae-hover" onClick={onIgnore}>
          Ignore
        </button>
      </div>
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

  const pending = friendships.filter((f) => f.status === 'pending' && f.addressee_id === userId).length;
  const mine = (c: Conversation) => c.conversation_members.find((m) => m.user_id === userId);
  const requests = conversations.filter((c) => mine(c)?.request_pending && !mine(c)?.hidden);
  const visible = conversations.filter((c) => !mine(c)?.hidden && !mine(c)?.request_pending);
  const [showRequests, setShowRequests] = useState(false);
  const respond = useRespondRequest();
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

        {requests.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowRequests((v) => !v)}
              className="ae-enter mt-1 flex w-full items-center gap-3 rounded-ae px-2 py-2 text-left text-sm text-ae-muted hover:bg-ae-hover hover:text-ae-text"
            >
              <MessageIcon size={20} />
              <span className="flex-1 font-medium">Message requests</span>
              <span className="rounded-full bg-ae-accent px-1.5 text-xs font-bold text-ae-on-accent">{requests.length}</span>
            </button>
            {showRequests && (
              <ul className="ae-enter mb-2 space-y-1 rounded-ae border border-ae-border bg-ae-sunken/50 p-1.5">
                {requests.map((c) => (
                  <RequestRow
                    key={c.id}
                    conv={c}
                    me={userId}
                    onOpen={() => openHome(c.id)}
                    onAccept={() => respond.mutate({ id: c.id, accept: true }, { onSuccess: () => toast.success('Request accepted.') })}
                    onIgnore={() => respond.mutate({ id: c.id, accept: false })}
                  />
                ))}
                <li className="px-1 pt-1 text-[11px] text-ae-muted">People who aren&apos;t your friends. They can&apos;t see whether you&apos;ve read their messages.</li>
              </ul>
            )}
          </>
        )}

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
