/** Friends page: Online / All / Pending / Blocked tabs and Add Friend by username. */
import { MessageRequests, SearchPeople } from './FriendsExtras';
import { ask } from './ConfirmDialog';
import { useFriendNickname } from '../hooks/useAccount';
import { useMeId } from '../hooks/useMe';
import { useUserMenu } from '../hooks/useUserMenu';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useProfile } from '../hooks/useChatData';
import { activeCustomStatus } from '../hooks/useDesktop';
import { PresenceDot, STATUS_LABELS, usePresenceMap, usePresenceOf } from '../hooks/usePresence';
import { ActivityLine } from './ActivityCards';
import { useBlocks, useConversationActions, useFriendActions, useFriendships } from '../hooks/useSocialData';
import { useUiStore } from '../stores/uiStore';
import { useCall } from './CallContext';
import { CheckIcon, CloseIcon, InboxIcon, MessageIcon, PhoneIcon, SearchIcon, UsersIcon } from './icons';
import { Avatar } from './ProfileCard';
import { plateProps } from '../lib/cosmetics';
import { MobileBack } from './MobileNav';

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add' | 'search';

function ActionButton({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`grid h-9 w-9 place-items-center rounded-full bg-ae-sunken ${danger ? 'text-ae-muted hover:text-ae-danger' : 'text-ae-muted hover:text-ae-text'}`}
    >
      {children}
    </button>
  );
}

function PersonRow({ userId, subtitle, actions }: { userId: string; subtitle?: string; actions: ReactNode }) {
  const me = useMeId();
  const userMenu = useUserMenu(me);
  const nickname = useFriendNickname(userId);
  const { data: p } = useProfile(userId);
  const status = usePresenceOf(userId);
  const peekProfile = useUiStore((s) => s.peekProfile);
  return (
    <li
      {...plateProps(p?.nameplate, p?.decor)}
      className="ae-plate group flex cursor-pointer items-center gap-3 border-t border-ae-border px-2 py-2.5 hover:rounded-ae hover:bg-ae-hover"
      onClick={(e) => peekProfile(userId, e.currentTarget)}
      onContextMenu={(e) => userMenu(e, userId)}
    >
      <span className="relative inline-block shrink-0 leading-none">
        <Avatar profile={p} size={36} showFrame={false} />
        <PresenceDot status={status} className="absolute -right-0.5 -bottom-0.5 z-10" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {nickname || p?.display_name || p?.username || '…'} <span className="font-normal text-ae-muted">@{p?.username}</span>
        </span>
        <span className="block truncate text-xs text-ae-muted">{subtitle ?? <ActivityLine userId={userId} fallback={activeCustomStatus(p) || STATUS_LABELS[status]} />}</span>
      </span>
      <span className="flex gap-2">{actions}</span>
    </li>
  );
}

function AddFriend() {
  const { send } = useFriendActions();
  const [username, setUsername] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    send.mutate(username.trim().replace(/^@/, ''), {
      onSuccess: (r) =>
        setResult(
          r === 'accepted'
            ? `You and ${username} are now friends!`
            : r === 'already_friends'
              ? `You're already friends with ${username}.`
              : r === 'already_sent'
                ? 'You already sent this person a request.'
                : `Friend request sent to ${username}.`,
        ),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <h2 className="font-semibold">Add friend</h2>
      <p className="text-sm text-ae-muted">You can add friends with their Aether username.</p>
      <div className="flex gap-2 rounded-ae border border-ae-border bg-ae-sunken p-2 focus-within:border-ae-accent">
        <input
          autoFocus
          className="flex-1 bg-transparent px-2 text-sm outline-none"
          placeholder="Enter a username"
          value={username}
          maxLength={33}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button
          type="submit"
          disabled={!username.trim() || send.isPending}
          className="rounded-ae bg-ae-accent px-4 py-1.5 text-sm font-semibold text-ae-on-accent disabled:opacity-40"
        >
          Send friend request
        </button>
      </div>
      {result && <p className="text-sm text-ae-success">{result}</p>}
      {send.isError && <p className="text-sm text-ae-danger">{send.error.message}</p>}
    </form>
  );
}

/** Home → Message requests (opened from the sidebar, under Friends). */
export function MessageRequestsView({ userId }: { userId: string }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ae-border px-4 ae-chat-header">
        <MobileBack />
        <InboxIcon size={20} className="text-ae-muted" />
        <h1 className="font-semibold">Message requests</h1>
      </header>
      <div className="ae-scroll flex-1 overflow-y-auto p-4">
        <MessageRequests me={userId} />
      </div>
    </section>
  );
}

export function FriendsView({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('online');
  const { data: friendships = [] } = useFriendships();
  const { data: blocks = [] } = useBlocks();
  const actions = useFriendActions();
  const convo = useConversationActions();
  const { callConversation } = useCall();
  const openHome = useUiStore((s) => s.openHome);
  const presence = usePresenceMap();

  const friends = useMemo(
    () =>
      friendships
        .filter((f) => f.status === 'accepted')
        .map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id)),
    [friendships, userId],
  );
  const incoming = friendships.filter((f) => f.status === 'pending' && f.addressee_id === userId);
  const outgoing = friendships.filter((f) => f.status === 'pending' && f.requester_id === userId);
  const online = friends.filter((id) => presence.has(id));

  const message = (id: string) => convo.openDm.mutate(id, { onSuccess: (convId) => openHome(convId) });
  const call = (id: string) =>
    convo.openDm.mutate(id, {
      onSuccess: (convId) => {
        openHome(convId);
        callConversation(convId, 'Direct call');
      },
    });

  const friendActions = (id: string) => (
    <>
      <ActionButton title="Message" onClick={() => message(id)}>
        <MessageIcon size={16} />
      </ActionButton>
      <ActionButton title="Start voice call" onClick={() => call(id)}>
        <PhoneIcon size={16} />
      </ActionButton>
      <ActionButton
        title="Remove friend"
        danger
        onClick={async () => {
          if ((await ask('Remove this friend?'))) actions.remove.mutate(id);
        }}
      >
        <CloseIcon size={16} />
      </ActionButton>
    </>
  );

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'online', label: 'Online' },
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending', badge: incoming.length },
    { id: 'blocked', label: 'Blocked' },
  ];

  const error = actions.accept.error ?? actions.remove.error ?? actions.unblock.error ?? convo.openDm.error;

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ae-border px-4 ae-chat-header">
        <MobileBack />
        <UsersIcon size={20} className="text-ae-muted" />
        <h1 className="font-semibold">Friends</h1>
        <div className="mx-2 h-6 w-px bg-ae-border" />
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-ae px-2 py-0.5 text-sm ${tab === t.id ? 'bg-ae-surface text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`}
          >
            {t.label}
            {!!t.badge && <span className="rounded-full bg-ae-danger px-1.5 text-xs font-bold text-white">{t.badge}</span>}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setTab('add')}
          className={`rounded-ae px-2 py-0.5 text-sm font-medium ${tab === 'add' ? 'text-ae-success' : 'bg-ae-success text-black'}`}
        >
          Add Friend
        </button>
        <button
          type="button"
          onClick={() => setTab('search')}
          className={`flex items-center gap-1.5 rounded-ae px-2 py-0.5 text-sm font-medium ${tab === 'search' ? 'bg-ae-surface text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`}
        >
          <SearchIcon size={14} /> Search for someone
        </button>
      </header>

      <div className="ae-scroll flex-1 overflow-y-auto px-6 py-4">
        {error && <p className="mb-2 text-sm text-ae-danger">{error.message}</p>}
        {tab === 'add' && <AddFriend />}
        {tab === 'search' && <SearchPeople />}

        {(tab === 'online' || tab === 'all') && (
          <>
            <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
              {tab === 'online' ? 'Online' : 'All friends'} — {(tab === 'online' ? online : friends).length}
            </p>
            <ul>
              {(tab === 'online' ? online : friends).map((id) => (
                <PersonRow key={id} userId={id} actions={friendActions(id)} />
              ))}
            </ul>
            {(tab === 'online' ? online : friends).length === 0 && (
              <p className="py-10 text-center text-sm text-ae-muted">
                {friends.length === 0 ? 'No friends yet. Use Add Friend to send a request.' : 'No one is online right now.'}
              </p>
            )}
          </>
        )}

        {tab === 'pending' && (
          <>
            <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Pending — {incoming.length + outgoing.length}</p>
            <ul>
              {incoming.map((f) => (
                <PersonRow
                  key={f.id}
                  userId={f.requester_id}
                  subtitle="Incoming friend request"
                  actions={
                    <>
                      <ActionButton title="Accept" onClick={() => actions.accept.mutate(f.requester_id)}>
                        <span className="text-ae-success"><CheckIcon size={15} className="ae-ico" /></span>
                      </ActionButton>
                      <ActionButton title="Ignore" danger onClick={() => actions.remove.mutate(f.requester_id)}>
                        <CloseIcon size={16} />
                      </ActionButton>
                    </>
                  }
                />
              ))}
              {outgoing.map((f) => (
                <PersonRow
                  key={f.id}
                  userId={f.addressee_id}
                  subtitle="Outgoing friend request"
                  actions={
                    <ActionButton title="Cancel" danger onClick={() => actions.remove.mutate(f.addressee_id)}>
                      <CloseIcon size={16} />
                    </ActionButton>
                  }
                />
              ))}
            </ul>
            {incoming.length + outgoing.length === 0 && <p className="py-10 text-center text-sm text-ae-muted">No pending requests.</p>}
          </>
        )}

        {tab === 'blocked' && (
          <>
            <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Blocked — {blocks.length}</p>
            <ul>
              {blocks.map((b) => (
                <PersonRow
                  key={b.blocked_id}
                  userId={b.blocked_id}
                  subtitle="Blocked"
                  actions={
                    <ActionButton title="Unblock" onClick={() => actions.unblock.mutate(b.blocked_id)}>
                      <CloseIcon size={16} />
                    </ActionButton>
                  }
                />
              ))}
            </ul>
            {blocks.length === 0 && <p className="py-10 text-center text-sm text-ae-muted">You haven't blocked anyone.</p>}
          </>
        )}
      </div>
    </section>
  );
}
