/**
 * The phone layout (web app on phones, and the Android app): a bottom tab bar with Messages,
 * Servers, Notifications and You, each a full screen with a large title, like a native app.
 * Opening a chat hides the tab bar; the chat header has a back button.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useProfile } from '../hooks/useChatData';
import { activeCustomStatus } from '../hooks/useDesktop';
import { useUnreadSummary } from '../hooks/useMessageExtras';
import { useNotifyResolver } from '../hooks/useNotifications';
import { PresenceDot, STATUS_LABELS, usePresenceOf } from '../hooks/usePresence';
import { useActiveCalls, useConversations, useFriendships } from '../hooks/useSocialData';
import { EmojiText } from '../lib/twemoji';
import { useUiStore } from '../stores/uiStore';
import type { Conversation, Server } from '../types/db';
import { ActivityLine } from './ActivityCards';
import { ConversationAvatar, isUnread, useConversationTitle } from './ConversationBits';
import { useRequestConversations } from './FriendsExtras';
import { GroupDialog } from './GroupDialog';
import {
  BellIcon,
  ChevronRightIcon,
  EditIcon,
  InboxIcon,
  MessageIcon,
  PaletteIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  UsersIcon,
} from './icons';
import { InboxPanel } from './Inbox';
import { Avatar } from './ProfileCard';
import { MiniProfile } from './ProfilePeek';
import { openQuickSwitcher } from './QuickSwitcher';

export type MobileTab = 'home' | 'servers' | 'inbox' | 'you';

/** Big screen title with optional buttons on the right. */
function ScreenHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex shrink-0 items-end gap-2 px-4 pt-[max(14px,env(safe-area-inset-top))] pb-3">
      <h1 className="flex-1 text-[28px] leading-tight font-extrabold tracking-tight">{title}</h1>
      {children}
    </header>
  );
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="ae-press grid h-10 w-10 place-items-center rounded-full bg-ae-surface text-ae-text active:bg-ae-hover">
      {children}
    </button>
  );
}

function OnlineFriend({ userId }: { userId: string }) {
  const { data: p } = useProfile(userId);
  const status = usePresenceOf(userId);
  const peek = useUiStore((s) => s.peekProfile);
  if (status === 'offline') return null;
  return (
    <button type="button" className="flex w-16 shrink-0 flex-col items-center gap-1" onClick={(e) => peek(userId, e.currentTarget)}>
      <span className="relative">
        <Avatar profile={p} size={52} showFrame={false} />
        <PresenceDot status={status} size={14} className="absolute right-0 bottom-0 ring-[3px] ring-ae-bg" />
      </span>
      <span className="w-full truncate text-center text-[11px] text-ae-muted">{p?.display_name || p?.username}</span>
    </button>
  );
}

function DmRow({ conv, me, count, muted, inCall }: { conv: Conversation; me: string; count: number; muted: boolean; inCall: boolean }) {
  const openHome = useUiStore((s) => s.openHome);
  const title = useConversationTitle(conv, me);
  const unread = !muted && isUnread(conv, me);
  const other = conv.type === 'dm' ? conv.conversation_members.find((m) => m.user_id !== me)?.user_id : undefined;
  const when = conv.last_message_at ? new Date(conv.last_message_at) : null;
  const time = when
    ? Date.now() - when.getTime() < 86_400_000
      ? when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  return (
    <li>
      <button
        type="button"
        onClick={() => openHome(conv.id)}
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-ae-hover ${muted ? 'opacity-60' : ''}`}
      >
        <ConversationAvatar conv={conv} me={me} size={50} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`min-w-0 flex-1 truncate text-[15px] ${unread ? 'font-bold' : 'font-semibold'}`}>{title}</span>
            <span className="shrink-0 text-[11px] text-ae-muted">{time}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={`min-w-0 flex-1 truncate text-[13px] ${unread ? 'text-ae-text' : 'text-ae-muted'}`}>
              {inCall ? (
                <span className="text-ae-success">
                  <PhoneIcon size={12} className="ae-ico" /> Call in progress
                </span>
              ) : conv.type === 'group' ? (
                `${conv.conversation_members.length} members`
              ) : (
                other && <ActivityLine userId={other} />
              )}
            </span>
            {count > 0 ? (
              <span className="shrink-0 rounded-full bg-ae-danger px-1.5 text-[11px] font-bold text-white">{count > 99 ? '99+' : count}</span>
            ) : (
              unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ae-accent" />
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

export function MobileHome({ userId }: { userId: string }) {
  const openHome = useUiStore((s) => s.openHome);
  const { data: conversations = [] } = useConversations();
  const { data: friendships = [] } = useFriendships();
  const { data: activeCalls = [] } = useActiveCalls();
  const { data: unread = [] } = useUnreadSummary();
  const { resolve } = useNotifyResolver();
  const [groupOpen, setGroupOpen] = useState(false);
  const counts = new Map(unread.map((r) => [r.scope_id, r.mention_count]));
  const callIds = new Set(activeCalls.map((c) => c.conversation_id));
  const requests = useRequestConversations(userId).length;
  const pending = friendships.filter((f) => f.status === 'pending' && f.addressee_id === userId).length;
  const friends = friendships.filter((f) => f.status === 'accepted').map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id));
  const mine = (c: Conversation) => c.conversation_members.find((m) => m.user_id === userId);
  const visible = conversations.filter((c) => !mine(c)?.hidden && !mine(c)?.request_pending);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title="Messages">
        <RoundButton label="New message" onClick={() => setGroupOpen(true)}>
          <PlusIcon size={20} />
        </RoundButton>
      </ScreenHeader>
      <div className="ae-scroll min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="px-4">
          <button type="button" onClick={openQuickSwitcher} className="flex h-11 w-full items-center gap-2.5 rounded-full bg-ae-surface px-4 text-left text-[15px] text-ae-muted">
            <SearchIcon size={17} /> Search
          </button>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => openHome('friends')} className="ae-press flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-ae-surface text-sm font-semibold">
              <UsersIcon size={16} /> Friends
              {pending > 0 && <span className="rounded-full bg-ae-danger px-1.5 text-[11px] text-white">{pending}</span>}
            </button>
            <button type="button" onClick={() => openHome('requests')} className="ae-press flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-ae-surface text-sm font-semibold">
              <InboxIcon size={16} /> Requests
              {requests > 0 && <span className="rounded-full bg-ae-danger px-1.5 text-[11px] text-white">{requests}</span>}
            </button>
          </div>
        </div>

        {friends.length > 0 && (
          <div className="ae-scroll mt-4 flex gap-1 overflow-x-auto px-3 [scrollbar-width:none] empty:hidden">
            {friends.map((id) => (
              <OnlineFriend key={id} userId={id} />
            ))}
          </div>
        )}

        <ul className="mt-2">
          {visible.length === 0 && <li className="px-6 py-10 text-center text-sm text-ae-muted">No conversations yet. Tap + to message a friend.</li>}
          {visible.map((c) => (
            <DmRow key={c.id} conv={c} me={userId} count={counts.get(c.id) ?? 0} muted={resolve({ kind: 'conversation', id: c.id }).muted} inCall={callIds.has(c.id)} />
          ))}
        </ul>
      </div>
      {groupOpen && <GroupDialog me={userId} onClose={() => setGroupOpen(false)} />}
    </div>
  );
}

export function MobileInbox({ userId, servers }: { userId: string; servers: Server[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title="Notifications" />
      <div className="min-h-0 flex-1">
        <InboxPanel userId={userId} servers={servers} onClose={() => {}} inline />
      </div>
    </div>
  );
}

function Row({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ae-hover">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-ae-surface text-ae-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint && <span className="block truncate text-xs text-ae-muted">{hint}</span>}
      </span>
      <ChevronRightIcon size={18} className="text-ae-muted" />
    </button>
  );
}

export function MobileYou({ userId }: { userId: string }) {
  const { data: me } = useProfile(userId);
  const openStudio = useUiStore((s) => s.openStudio);
  const openSettings = useUiStore((s) => s.openSettings);
  const openThemeStudio = useUiStore((s) => s.openThemeStudio);
  const status = me?.presence_status ?? 'online';
  const custom = me ? activeCustomStatus(me) : null;
  return (
    <div className="ae-scroll flex min-h-0 flex-1 flex-col overflow-y-auto pb-6">
      <div className="shrink-0 overflow-hidden rounded-b-3xl border-b border-ae-border [&>article]:!h-auto [&>article]:!overflow-visible">
        <MiniProfile userId={userId} me={userId} variant="panel" />
      </div>
      <div className="mx-4 mt-4 overflow-hidden rounded-2xl bg-ae-sunken/70">
        <Row icon={<EditIcon size={17} />} label="Edit profile" hint="Avatar, banner, decorations, effects" onClick={openStudio} />
        <Row
          icon={<PresenceDot status={status === 'invisible' ? 'offline' : status} size={12} />}
          label={STATUS_LABELS[status]}
          hint={custom ? undefined : 'Set your status in Settings → Profile'}
          onClick={() => openSettings('profile')}
        />
        {custom && (
          <p className="px-4 pb-3 text-xs text-ae-muted">
            {me?.status_emoji && <EmojiText text={me.status_emoji} />} {custom}
          </p>
        )}
      </div>
      <div className="mx-4 mt-3 overflow-hidden rounded-2xl bg-ae-sunken/70">
        <Row icon={<PaletteIcon size={17} />} label="Customize your theme" hint="Colours, gradient and effects" onClick={openThemeStudio} />
        <Row icon={<BellIcon size={17} />} label="Notifications" onClick={() => openSettings('notifications')} />
        <Row icon={<SettingsIcon size={17} />} label="All settings" onClick={() => openSettings()} />
      </div>
    </div>
  );
}

export function MobileTabBar({ userId, tab, onTab, homeBadge, inboxBadge }: { userId: string; tab: MobileTab; onTab: (t: MobileTab) => void; homeBadge: number; inboxBadge: number }) {
  const { data: me } = useProfile(userId);
  const status = usePresenceOf(userId);
  const items: { id: MobileTab; label: string; icon: ReactNode; badge?: number }[] = useMemo(
    () => [
      { id: 'home', label: 'Messages', icon: <MessageIcon size={22} />, badge: homeBadge },
      { id: 'servers', label: 'Servers', icon: <ServerIcon size={22} /> },
      { id: 'inbox', label: 'Notifications', icon: <BellIcon size={22} />, badge: inboxBadge },
      {
        id: 'you',
        label: 'You',
        icon: (
          <span className="relative">
            <Avatar profile={me} size={24} showFrame={false} />
            <PresenceDot status={status} size={9} className="absolute -right-0.5 -bottom-0.5 ring-2 ring-ae-elevated" />
          </span>
        ),
      },
    ],
    [homeBadge, inboxBadge, me, status],
  );
  return (
    <nav className="ae-tabbar ae-mobile-only shrink-0 border-t border-ae-border bg-ae-elevated pb-[env(safe-area-inset-bottom)]" aria-label="Sections">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-current={tab === it.id ? 'page' : undefined}
          onClick={() => onTab(it.id)}
          className={`relative flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-semibold ${tab === it.id ? 'text-ae-text' : 'text-ae-muted'}`}
        >
          <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${tab === it.id ? 'bg-ae-accent/20 text-ae-accent' : ''}`}>{it.icon}</span>
          {it.label}
          {!!it.badge && <span className="absolute top-1 left-1/2 ml-2 min-w-[18px] rounded-full bg-ae-danger px-1 text-center text-[10px] leading-[18px] text-white">{it.badge > 99 ? '99+' : it.badge}</span>}
        </button>
      ))}
    </nav>
  );
}

/** "Pick a server" shown on the Servers tab before any server is open. */
export function MobileServersEmpty() {
  return (
    <div className="grid flex-1 place-items-center p-8 text-center text-sm text-ae-muted">
      <div>
        <ServerIcon size={36} className="mx-auto mb-2 opacity-60" />
        Pick a server on the left, or tap + to create or join one.
      </div>
    </div>
  );
}

/** Back arrow shown at the start of chat headers on phones. */
export function MobileBack() {
  const setPane = useUiStore((s) => s.setMobilePane);
  return (
    <button type="button" aria-label="Back" className="ae-mobile-only -ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ae-text active:bg-ae-hover" onClick={() => setPane('nav')}>
      <ChevronRightIcon size={24} className="rotate-180" />
    </button>
  );
}
