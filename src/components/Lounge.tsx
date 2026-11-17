/**
 * The Lounge layout (2.1): social-first. A top bar (Home, Chats, Spaces, Calls) replaces the server
 * column; Home is a feed of what's happening; Calls gathers every call you can hop into.
 * Chats and Spaces reuse the normal chat and server screens.
 */
import { useMemo } from 'react';
import { useProfile } from '../hooks/useChatData';
import { isRowUnread, useUnreadSummary } from '../hooks/useMessageExtras';
import { useNotifyResolver } from '../hooks/useNotifications';
import { PresenceDot, useActivityOf, useListeningOf, usePresenceOf } from '../hooks/usePresence';
import { useActiveCalls, useConversationActions, useConversations, useFriendships } from '../hooks/useSocialData';
import { t } from '../lib/i18n';
import { useUiStore } from '../stores/uiStore';
import type { Conversation, Server } from '../types/db';
import { useCall } from './CallContext';
import { ConversationAvatar, useConversationTitle } from './ConversationBits';
import { MessageIcon, PhoneIcon, CameraIcon, UsersIcon } from './icons';
import { useChannelNames } from './Inbox';
import { ActiveCard, CallCard, CatchUpRow } from './OrbitHome';
import { Avatar } from './ProfileCard';
import { toast } from './Toaster';

export type LoungeTab = 'home' | 'chats' | 'spaces' | 'calls';

/** Which top-bar tab the current screen belongs to. */
export function useLoungeTab(): LoungeTab {
  const view = useUiStore((s) => s.view);
  const target = useUiStore((s) => s.homeTarget);
  if (view === 'server') return 'spaces';
  if (target === 'now') return 'home';
  if (target === 'calls') return 'calls';
  return 'chats';
}

const panel = 'rounded-[26px] border border-ae-border bg-ae-elevated';

/** The top bar: four places, and you. */
export function LoungeNav({ userId, servers, lastServerId, unreadChats }: { userId: string; servers: Server[]; lastServerId: string | null; unreadChats: number }) {
  const tab = useLoungeTab();
  const openHome = useUiStore((s) => s.openHome);
  const selectServer = useUiStore((s) => s.selectServer);
  const peek = useUiStore((s) => s.peekProfile);
  const { data: me } = useProfile(userId);
  const items: { id: LoungeTab; label: string; go: () => void; badge?: number }[] = [
    { id: 'home', label: t('Home'), go: () => openHome('now') },
    { id: 'chats', label: t('Chats'), go: () => openHome('friends'), badge: unreadChats },
    {
      id: 'spaces',
      label: t('Spaces'),
      go: () => {
        const id = servers.find((s) => s.id === lastServerId)?.id ?? servers[0]?.id;
        if (id) selectServer(id);
        else toast(t('Join or create a space with the + button.'));
      },
    },
    { id: 'calls', label: t('Calls'), go: () => openHome('calls') },
  ];
  return (
    <div className="ae-lounge-nav relative flex h-16 shrink-0 items-center gap-4 px-6">
      <nav aria-label={t('Main')} className="mx-auto flex gap-1 rounded-full border border-ae-border bg-ae-elevated p-1.5">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            aria-current={tab === it.id ? 'page' : undefined}
            onClick={it.go}
            className={`ae-press flex items-center gap-2 rounded-full px-5 py-2 text-[15px] font-semibold transition-colors ${
              tab === it.id ? 'bg-ae-text text-ae-bg' : 'text-ae-muted hover:text-ae-text'
            }`}
          >
            {it.label}
            {!!it.badge && <span className="rounded-full bg-ae-danger px-1.5 text-[11px] font-bold text-white">{it.badge > 99 ? '99+' : it.badge}</span>}
          </button>
        ))}
      </nav>
      <button
        type="button"
        aria-label={t('Your profile')}
        onClick={(e) => peek(userId, e.currentTarget)}
        className="ae-press absolute right-6 flex items-center gap-2.5 rounded-full border border-ae-border bg-ae-elevated py-1 pr-4 pl-1 text-sm font-semibold"
      >
        <Avatar profile={me} size={32} showFrame={false} />
        {me?.display_name || me?.username}
      </button>
    </div>
  );
}

/** A friend as a tall card in the top strip (where Moments will appear). */
function FriendCard({ userId }: { userId: string }) {
  const { data: p } = useProfile(userId);
  const status = usePresenceOf(userId);
  const game = useActivityOf(userId);
  const track = useListeningOf(userId);
  const peek = useUiStore((s) => s.peekProfile);
  const online = status !== 'offline';
  return (
    <button
      type="button"
      onClick={(e) => peek(userId, e.currentTarget)}
      className={`ae-press flex h-[180px] w-[128px] shrink-0 flex-col justify-between rounded-[22px] bg-ae-surface p-3 text-left ${online ? '' : 'opacity-70'}`}
      style={{ boxShadow: online ? 'inset 0 0 0 3px var(--ae-accent)' : undefined }}
    >
      <span className="relative self-start">
        <Avatar profile={p} size={40} showFrame={false} />
        <PresenceDot status={status} size={12} className="absolute -right-0.5 -bottom-0.5 ring-[3px] ring-ae-surface" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{p?.display_name || p?.username}</span>
        <span className="block truncate text-xs text-ae-muted">{game ?? (track ? track.title : online ? t('Online') : t('Offline'))}</span>
      </span>
    </button>
  );
}

/** A row in "Friends": who's around, with a one-tap message button. */
function FriendRow({ userId }: { userId: string }) {
  const { data: p } = useProfile(userId);
  const status = usePresenceOf(userId);
  const game = useActivityOf(userId);
  const convo = useConversationActions();
  const openHome = useUiStore((s) => s.openHome);
  const name = p?.display_name || p?.username || '';
  return (
    <div className="flex items-center gap-3">
      <span className="relative">
        <Avatar profile={p} size={42} showFrame={false} />
        <PresenceDot status={status} size={12} className="absolute -right-0.5 -bottom-0.5 ring-[3px] ring-ae-elevated" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{name}</span>
        <span className="block truncate text-[13px] text-ae-muted">{game ?? (status === 'offline' ? t('Offline') : t('Online'))}</span>
      </span>
      <button
        type="button"
        aria-label={t('Message {name}', { name })}
        className="ae-press grid h-9 w-9 place-items-center rounded-full bg-ae-surface hover:bg-ae-hover"
        onClick={() => convo.openDm.mutate(userId, { onSuccess: (id) => openHome(id) })}
      >
        <MessageIcon size={16} />
      </button>
    </div>
  );
}

function useFriendIds(userId: string): string[] {
  const { data: friendships = [] } = useFriendships();
  return friendships.filter((f) => f.status === 'accepted').map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id));
}

export function LoungeHome({ userId }: { userId: string }) {
  const friends = useFriendIds(userId);
  const { data: conversations = [] } = useConversations();
  const { data: calls = [] } = useActiveCalls();
  const { data: unread = [] } = useUnreadSummary();
  const { resolve } = useNotifyResolver();
  const openHome = useUiStore((s) => s.openHome);
  const convById = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);
  const callConvs = calls.map((c) => convById.get(c.conversation_id)).filter(Boolean) as Conversation[];
  const missed = unread
    .filter((r) => isRowUnread(r) && !resolve(r.server_id ? { kind: 'channel', id: r.scope_id, serverId: r.server_id } : { kind: 'conversation', id: r.scope_id }).muted)
    .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
    .slice(0, 5);
  const { data: channelInfo = [] } = useChannelNames(missed.filter((r) => r.server_id).map((r) => r.scope_id));
  const channelName = new Map(channelInfo.map((c) => [c.id, c.name]));

  return (
    <div className="ae-view-in flex min-w-0 flex-1 gap-5 overflow-hidden">
      <section className="ae-scroll flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
        <div className="ae-scroll flex gap-3.5 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label={t('Friends')}>
          {friends.length === 0 ? (
            <button type="button" onClick={() => openHome('friends')} className="ae-press flex h-[180px] w-[128px] shrink-0 flex-col items-center justify-center gap-2 rounded-[22px] border-2 border-dashed border-ae-border text-sm text-ae-muted">
              <UsersIcon size={22} />
              {t('Add friends')}
            </button>
          ) : (
            friends.map((id) => <FriendCard key={id} userId={id} />)
          )}
        </div>
        <div className={`${panel} flex flex-col gap-3 p-6`}>
          <div>
            <h2 className="text-lg font-bold">{t('Happening now')}</h2>
            <p className="text-sm text-ae-muted">{t('Calls, games and music from your friends, live.')}</p>
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))] empty:hidden">
            {callConvs.map((c) => (
              <CallCard key={c.id} conv={c} me={userId} />
            ))}
            {friends.map((id) => (
              <ActiveCard key={id} userId={id} />
            ))}
          </div>
        </div>
      </section>
      <aside className="ae-scroll flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto">
        <div className={`${panel} flex flex-col gap-3.5 p-5`}>
          <h2 className="text-lg font-bold">{t('Friends')}</h2>
          {friends.length === 0 && <p className="text-sm text-ae-muted">{t('No friends yet.')}</p>}
          {friends.slice(0, 8).map((id) => (
            <FriendRow key={id} userId={id} />
          ))}
        </div>
        <div className={`${panel} flex flex-col gap-1 p-4`}>
          <h2 className="px-1 pb-1 text-lg font-bold">{t('Catch up')}</h2>
          {missed.length === 0 && <p className="px-1 pb-2 text-sm text-ae-muted">{t('You’re all caught up.')}</p>}
          {missed.map((r) => (
            <CatchUpRow key={r.scope_id} row={r} conv={convById.get(r.scope_id)} me={userId} channelName={channelName.get(r.scope_id)} />
          ))}
        </div>
      </aside>
    </div>
  );
}

/** A DM or group you can call. */
function CallRow({ conv, me, live }: { conv: Conversation; me: string; live: boolean }) {
  const title = useConversationTitle(conv, me);
  const { callConversation } = useCall();
  return (
    <div className="flex items-center gap-3 rounded-[18px] p-2.5 hover:bg-ae-hover">
      <ConversationAvatar conv={conv} me={me} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{title}</span>
        <span className={`block text-[13px] ${live ? 'text-ae-success' : 'text-ae-muted'}`}>{live ? t('Call in progress') : conv.type === 'group' ? t('{n} people', { n: conv.conversation_members.length }) : t('Direct message')}</span>
      </span>
      <button type="button" aria-label={t('Start voice call')} onClick={() => callConversation(conv.id, title)} className={`ae-press grid h-10 w-10 place-items-center rounded-full ${live ? 'bg-ae-success text-black' : 'bg-ae-surface hover:bg-ae-hover'}`}>
        <PhoneIcon size={17} />
      </button>
      <button type="button" aria-label={t('Start video call')} onClick={() => callConversation(conv.id, title, true)} className="ae-press grid h-10 w-10 place-items-center rounded-full bg-ae-surface hover:bg-ae-hover">
        <CameraIcon size={17} />
      </button>
    </div>
  );
}

/** Calls: every call you can hop into, and a quick way to start one. */
export function LoungeCalls({ userId }: { userId: string }) {
  const { data: conversations = [] } = useConversations();
  const { data: calls = [] } = useActiveCalls();
  const live = new Set(calls.map((c) => c.conversation_id));
  const mine = (c: Conversation) => c.conversation_members.find((m) => m.user_id === userId);
  const chats = conversations.filter((c) => !mine(c)?.hidden && !mine(c)?.request_pending);
  const liveChats = chats.filter((c) => live.has(c.id));
  const others = chats.filter((c) => !live.has(c.id)).slice(0, 12);
  return (
    <div className="ae-view-in ae-scroll mx-auto flex w-full max-w-3xl flex-col gap-5 overflow-y-auto">
      <div className={`${panel} p-5`}>
        <h2 className="px-1 pb-2 text-lg font-bold">{t('Live now')}</h2>
        {liveChats.length === 0 ? <p className="px-1 text-sm text-ae-muted">{t('No calls right now. Start one below, or drop into a room in your spaces.')}</p> : liveChats.map((c) => <CallRow key={c.id} conv={c} me={userId} live />)}
      </div>
      <div className={`${panel} p-5`}>
        <h2 className="px-1 pb-2 text-lg font-bold">{t('Start a call')}</h2>
        {others.length === 0 && <p className="px-1 text-sm text-ae-muted">{t('No conversations yet. Message a friend to start one.')}</p>}
        {others.map((c) => (
          <CallRow key={c.id} conv={c} me={userId} live={false} />
        ))}
      </div>
    </div>
  );
}
