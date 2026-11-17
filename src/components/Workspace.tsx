/**
 * The Workspace layout (2.1): chats open as tabs across the top, like a browser; one tree on the
 * left holds everything (Inbox, Friends, pinned chats, every space with its channels, DMs); the
 * home is your Inbox. Compact, flat and keyboard-friendly (Alt+1…9 switch tabs, Alt+W closes one).
 * Chats, channels and calls are the normal screens.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useChatPrefs } from '../hooks/useChatPrefs';
import { useChannels } from '../hooks/useChatData';
import { isRowUnread, useUnreadSummary } from '../hooks/useMessageExtras';
import { useActiveCalls, useConversations, useFriendships } from '../hooks/useSocialData';
import { useVoiceStates } from '../hooks/useVoiceStates';
import { t } from '../lib/i18n';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Conversation, Server } from '../types/db';
import { useCall } from './CallContext';
import { ConversationAvatar, isUnread, useConversationTitle } from './ConversationBits';
import { CalendarIcon, CloseIcon, CompassIcon, HashIcon, InboxIcon, MoreIcon, PhoneIcon, PlusIcon, SearchIcon, UsersIcon, VolumeIcon } from './icons';
import { InboxPanel, useChannelNames } from './Inbox';
import { useAddServer } from './Invites';
import { openQuickSwitcher } from './QuickSwitcher';
import { useRequestConversations } from './FriendsExtras';
import { useServerMenu } from './ServerRail';
import { UserPanel } from './UserPanel';

interface Tab {
  /** The conversation or channel id. */
  id: string;
  /** The space a channel is in; null for DMs and groups. */
  serverId: string | null;
}

const MAX_TABS = 12;

/** Open tabs and folded-up spaces, remembered on this device. */
export const useWorkspace = create<{
  tabs: Tab[];
  folded: string[];
  open: (tab: Tab) => void;
  close: (id: string) => void;
  toggleFold: (serverId: string) => void;
}>()(
  persist(
    (set) => ({
      tabs: [],
      folded: [],
      open: (tab) => set((s) => (s.tabs.some((x) => x.id === tab.id) ? s : { tabs: [...s.tabs, tab].slice(-MAX_TABS) })),
      close: (id) => set((s) => ({ tabs: s.tabs.filter((x) => x.id !== id) })),
      toggleFold: (serverId) => set((s) => ({ folded: s.folded.includes(serverId) ? s.folded.filter((x) => x !== serverId) : [...s.folded, serverId] })),
    }),
    { name: 'aether.workspace' },
  ),
);

/** Mounted by the shell while Workspace is on: whatever you open becomes a tab. */
export function useTrackWorkspaceTab(current: Tab | null) {
  const open = useWorkspace((s) => s.open);
  const id = current?.id;
  const serverId = current?.serverId ?? null;
  useEffect(() => {
    if (id) open({ id, serverId });
  }, [id, serverId, open]);
}

function goToTab(tab: Tab) {
  const ui = useUiStore.getState();
  if (tab.serverId) {
    ui.selectServer(tab.serverId);
    ui.selectChannel(tab.serverId, tab.id);
  } else ui.openHome(tab.id);
}

function ConvTabLabel({ conv, me }: { conv: Conversation; me: string }) {
  return <>{useConversationTitle(conv, me)}</>;
}

/** The strip of tabs: Inbox first, then everything you've opened. */
export function WorkspaceTabs({ userId, current, inboxCount }: { userId: string; current: string | null; inboxCount: number }) {
  const tabs = useWorkspace((s) => s.tabs);
  const close = useWorkspace((s) => s.close);
  const { data: conversations = [] } = useConversations();
  const convById = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);
  const qc = useQueryClient();
  const { data: channelInfo = [] } = useChannelNames(tabs.filter((x) => x.serverId).map((x) => x.id));
  // Names from the channel lists already loaded, then from a lookup for spaces not opened yet.
  const channelName = new Map(channelInfo.map((c) => [c.id, c.name]));
  for (const tab of tabs) {
    if (!tab.serverId || channelName.has(tab.id)) continue;
    const hit = qc.getQueryData<Channel[]>(['channels', tab.serverId])?.find((c) => c.id === tab.id);
    if (hit) channelName.set(tab.id, hit.name);
  }
  const { data: calls = [] } = useActiveCalls();
  const live = new Set(calls.map((c) => c.conversation_id));
  const openHome = useUiStore((s) => s.openHome);
  // Tabs for chats you've left (or that no longer exist) quietly disappear.
  const shown = tabs.filter((x) => (x.serverId ? true : convById.has(x.id) || conversations.length === 0));

  const closeTab = (id: string) => {
    const i = shown.findIndex((x) => x.id === id);
    close(id);
    if (id === current) {
      const next = shown[i + 1] ?? shown[i - 1];
      if (next && next.id !== id) goToTab(next);
      else openHome('now');
    }
  };

  // Alt+1…9 jumps to a tab (1 = Inbox), Alt+W closes the open one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const n = Number(e.key);
        if (n === 1) openHome('now');
        else if (shown[n - 2]) goToTab(shown[n - 2]!);
      } else if (e.key.toLowerCase() === 'w' && current) {
        e.preventDefault();
        closeTab(current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const tabClass = (active: boolean) =>
    `group flex h-9 max-w-[220px] shrink-0 items-center gap-2 rounded-t-ae px-3 text-[13px] font-medium ${
      active ? 'bg-ae-bg text-ae-text shadow-[inset_0_2px_0_var(--ae-accent)]' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'
    }`;

  return (
    <div className="ae-ws-tabs flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]" role="tablist" aria-label={t('Open chats')}>
      <button type="button" role="tab" aria-selected={current === null} className={tabClass(current === null)} onClick={() => openHome('now')}>
        <InboxIcon size={14} />
        {t('Inbox')}
        {inboxCount > 0 && <span className="rounded-full bg-ae-accent px-1.5 text-[11px] font-bold text-ae-on-accent">{inboxCount > 99 ? '99+' : inboxCount}</span>}
      </button>
      {shown.map((tab) => {
        const conv = convById.get(tab.id);
        const active = tab.id === current;
        return (
          <div key={tab.id} role="tab" aria-selected={active} className={tabClass(active)} onMouseDown={(e) => e.button === 1 && (e.preventDefault(), closeTab(tab.id))}>
            <button type="button" className="flex min-w-0 items-center gap-2" onClick={() => goToTab(tab)}>
              {tab.serverId ? <HashIcon size={13} className="shrink-0 opacity-60" /> : conv && <ConversationAvatar conv={conv} me={userId} size={16} />}
              <span className="truncate">{tab.serverId ? (channelName.get(tab.id) ?? t('channel')) : conv ? <ConvTabLabel conv={conv} me={userId} /> : '…'}</span>
              {live.has(tab.id) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ae-success" aria-label={t('Call in progress')} />}
            </button>
            <button type="button" aria-label={t('Close tab')} className="grid h-5 w-5 shrink-0 place-items-center rounded opacity-0 group-hover:opacity-70 hover:bg-ae-hover hover:opacity-100 aria-selected:opacity-70" onClick={() => closeTab(tab.id)}>
              <CloseIcon size={12} />
            </button>
          </div>
        );
      })}
      <div className="flex-1" />
      <button type="button" onClick={openQuickSwitcher} className="mb-1 flex h-8 w-[300px] shrink-0 items-center gap-2 rounded-ae border border-ae-border bg-ae-elevated px-2.5 text-[13px] text-ae-muted hover:text-ae-text">
        <SearchIcon size={14} /> {t('Search or jump to…')}
        <span className="ml-auto rounded border border-ae-border px-1.5 font-mono text-[11px]">Ctrl K</span>
      </button>
    </div>
  );
}

const row = (active: boolean) =>
  `flex w-full items-center gap-2 rounded-ae px-2 py-1 text-left text-[13px] ${active ? 'bg-ae-surface font-semibold text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`;

/** One space in the tree: its text channels and voice rooms (with who's in them). */
function SpaceBranch({ userId, server, activeChannelId, unreadByScope }: { userId: string; server: Server; activeChannelId: string | null; unreadByScope: Map<string, { unread: boolean; mentions: number }> }) {
  const folded = useWorkspace((s) => s.folded.includes(server.id));
  const toggle = useWorkspace((s) => s.toggleFold);
  const { data: channels = [] } = useChannels(folded ? null : server.id);
  const voice = useVoiceStates(folded ? null : server.id);
  const serverMenu = useServerMenu(userId);
  const openEvents = useUiStore((s) => s.openEvents);
  const { joinChannel } = useCall();
  const list = channels.filter((c: Channel) => c.type !== 'category' && !c.thread_parent_id);
  const anyUnread = [...unreadByScope.entries()].some(([id, v]) => v.unread && channels.some((c) => c.id === id));
  return (
    <li>
      <div className="group flex items-center">
        <button type="button" aria-expanded={!folded} onClick={() => toggle(server.id)} className={`${row(false)} flex-1 font-semibold text-ae-text`}>
          <span className={`inline-block transition-transform ${folded ? '' : 'rotate-90'}`} aria-hidden="true">›</span>
          <span className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded bg-ae-surface text-[10px] font-bold">
            {server.icon_url ? <img src={server.icon_url} alt="" className="h-full w-full object-cover" /> : server.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')}
          </span>
          <span className="truncate">{server.name}</span>
          {folded && anyUnread && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ae-text" aria-label={t('Unread')} />}
        </button>
        <button type="button" aria-label={t('Events')} className="hidden h-6 w-6 place-items-center rounded text-ae-muted group-hover:grid hover:bg-ae-hover hover:text-ae-text" onClick={() => openEvents(server.id)}>
          <CalendarIcon size={13} />
        </button>
        <button type="button" aria-label={t('Space options')} className="hidden h-6 w-6 place-items-center rounded text-ae-muted group-hover:grid hover:bg-ae-hover hover:text-ae-text" onClick={(e) => serverMenu(e, server)}>
          <MoreIcon size={14} />
        </button>
      </div>
      {!folded && (
        <ul className="ml-3 border-l border-ae-border pl-1.5">
          {list.map((ch) => {
            const u = unreadByScope.get(ch.id);
            const people = voice.byChannel?.get(ch.id)?.length ?? 0;
            const isVoice = ch.type === 'voice' || ch.type === 'stream';
            return (
              <li key={ch.id}>
                <button
                  type="button"
                  aria-current={ch.id === activeChannelId ? 'page' : undefined}
                  onClick={() => {
                    const ui = useUiStore.getState();
                    ui.selectServer(server.id);
                    ui.selectChannel(server.id, ch.id);
                  }}
                  onDoubleClick={() => isVoice && joinChannel(ch)}
                  className={`${row(ch.id === activeChannelId)} ${u?.unread && ch.id !== activeChannelId ? 'font-semibold text-ae-text' : ''}`}
                >
                  {isVoice ? <VolumeIcon size={13} className="shrink-0 opacity-60" /> : <HashIcon size={13} className="shrink-0 opacity-60" />}
                  <span className="truncate">{ch.name}</span>
                  {!!u?.mentions && ch.id !== activeChannelId && <span className="ml-auto rounded-full bg-ae-accent/20 px-1.5 text-[11px] font-bold text-ae-accent">{u.mentions}</span>}
                  {isVoice && people > 0 && <span className="ml-auto text-[11px] text-ae-success">{people}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function DmLeaf({ conv, me, active, live }: { conv: Conversation; me: string; active: boolean; live: boolean }) {
  const title = useConversationTitle(conv, me);
  const unread = isUnread(conv, me);
  return (
    <li>
      <button type="button" aria-current={active ? 'page' : undefined} onClick={() => useUiStore.getState().openHome(conv.id)} className={`${row(active)} ${unread && !active ? 'font-semibold text-ae-text' : ''}`}>
        <ConversationAvatar conv={conv} me={me} size={18} />
        <span className="truncate">{title}</span>
        {live && <PhoneIcon size={12} className="ml-auto shrink-0 text-ae-success" />}
        {!live && unread && !active && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-ae-text" />}
      </button>
    </li>
  );
}

/** The one tree on the left. */
export function WorkspaceTree({ userId, servers, activeChannelId, activeConvId, onInbox, inboxCount }: {
  userId: string;
  servers: Server[];
  activeChannelId: string | null;
  activeConvId: string | null;
  onInbox: boolean;
  inboxCount: number;
}) {
  const openHome = useUiStore((s) => s.openHome);
  const homeTarget = useUiStore((s) => s.homeTarget);
  const addServer = useAddServer((s) => s.set);
  const { data: conversations = [] } = useConversations();
  const { data: friendships = [] } = useFriendships();
  const { data: unread = [] } = useUnreadSummary();
  const { data: calls = [] } = useActiveCalls();
  const prefs = useChatPrefs();
  const requests = useRequestConversations(userId).length;
  const pending = friendships.filter((f) => f.status === 'pending' && f.addressee_id === userId).length;
  const live = new Set(calls.map((c) => c.conversation_id));
  const unreadByScope = useMemo(() => new Map(unread.map((r) => [r.scope_id, { unread: isRowUnread(r), mentions: r.mention_count }])), [unread]);
  const mine = (c: Conversation) => c.conversation_members.find((m) => m.user_id === userId);
  const dms = conversations.filter((c) => !mine(c)?.hidden && !mine(c)?.request_pending && !prefs.get(c.id)?.archived);
  const pinned = dms.filter((c) => prefs.get(c.id)?.pinned_at);
  const rest = dms.filter((c) => !prefs.get(c.id)?.pinned_at);
  const [showAllDms, setShowAllDms] = useState(false);
  const head = 'flex items-center px-2 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-ae-muted uppercase';

  return (
    <aside data-panel="list" aria-label={t('Everything')} className="ae-ws-tree flex w-64 shrink-0 flex-col">
      <div className="ae-scroll flex-1 overflow-y-auto px-2 py-2">
        <button type="button" aria-current={onInbox ? 'page' : undefined} onClick={() => openHome('now')} className={row(onInbox)}>
          <InboxIcon size={15} /> {t('Inbox')}
          {inboxCount > 0 && <span className="ml-auto rounded-full bg-ae-accent px-1.5 text-[11px] font-bold text-ae-on-accent">{inboxCount}</span>}
        </button>
        <button type="button" aria-current={homeTarget === 'friends' && !activeConvId && !activeChannelId ? 'page' : undefined} onClick={() => openHome('friends')} className={row(homeTarget === 'friends' && !activeConvId && !activeChannelId)}>
          <UsersIcon size={15} /> {t('Friends')}
          {pending > 0 && <span className="ml-auto rounded-full bg-ae-danger px-1.5 text-[11px] font-bold text-white">{pending}</span>}
        </button>
        {requests > 0 && (
          <button type="button" onClick={() => openHome('requests')} className={row(homeTarget === 'requests')}>
            <InboxIcon size={15} /> {t('Message requests')}
            <span className="ml-auto rounded-full bg-ae-danger px-1.5 text-[11px] font-bold text-white">{requests}</span>
          </button>
        )}

        {pinned.length > 0 && (
          <>
            <div className={head}>{t('Pinned')}</div>
            <ul>
              {pinned.map((c) => (
                <DmLeaf key={c.id} conv={c} me={userId} active={c.id === activeConvId} live={live.has(c.id)} />
              ))}
            </ul>
          </>
        )}

        <div className={head}>
          <span className="flex-1">{t('Spaces')}</span>
          <button type="button" aria-label={t('Add a space')} className="grid h-5 w-5 place-items-center rounded hover:bg-ae-hover hover:text-ae-text" onClick={() => addServer('menu')}>
            <PlusIcon size={13} />
          </button>
          <button type="button" aria-label={t('Join a space')} className="grid h-5 w-5 place-items-center rounded hover:bg-ae-hover hover:text-ae-text" onClick={() => addServer('join')}>
            <CompassIcon size={13} />
          </button>
        </div>
        <ul>
          {servers.map((s) => (
            <SpaceBranch key={s.id} userId={userId} server={s} activeChannelId={activeChannelId} unreadByScope={unreadByScope} />
          ))}
        </ul>

        <div className={head}>{t('Direct')}</div>
        <ul>
          {(showAllDms ? rest : rest.slice(0, 12)).map((c) => (
            <DmLeaf key={c.id} conv={c} me={userId} active={c.id === activeConvId} live={live.has(c.id)} />
          ))}
        </ul>
        {rest.length > 12 && (
          <button type="button" className="px-2 py-1 text-xs text-ae-accent hover:underline" onClick={() => setShowAllDms((v) => !v)}>
            {showAllDms ? t('Show fewer') : t('Show all {n}', { n: rest.length })}
          </button>
        )}
      </div>
      <UserPanel userId={userId} />
    </aside>
  );
}

/** Workspace's home: the Inbox, full size. */
export function WorkspaceInbox({ userId, servers }: { userId: string; servers: Server[] }) {
  return (
    <div className="ae-view-in flex min-w-0 flex-1 flex-col">
      <InboxPanel userId={userId} servers={servers} onClose={() => {}} inline />
    </div>
  );
}
