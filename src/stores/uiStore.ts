/** Ephemeral UI state: Home vs server view, selections, panels, dialogs, jump targets, lightbox. */
import { create } from 'zustand';

export type SettingsTab = 'account' | 'privacy' | 'profile' | 'appearance' | 'voice' | 'notifications' | 'keybinds' | 'bandwidth' | 'activity' | 'windows' | 'standing' | 'admin';

export type ServerSettingsTab = 'overview' | 'roles' | 'members' | 'invites' | 'bans' | 'audit' | 'soundboard' | 'moderation' | 'automod' | 'community' | 'bot' | 'emoji' | 'stickers';

export interface PeekRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface JumpTarget {
  scopeId: string;
  messageId: string;
  /** Changes every request so jumping to the same message twice still triggers. */
  nonce: number;
}

export interface LightboxImage {
  url: string;
  alt?: string;
  name?: string;
}

interface UiState {
  view: 'home' | 'server';
  /** Home pane target: the friends list or a conversation id. */
  homeTarget: 'friends' | string;
  serverId: string | null;
  /** Last channel viewed per server, so switching servers restores your place. */
  channelByServer: Record<string, string>;
  memberListOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  profilePopoverUserId: string | null;
  /** The small profile card shown next to whatever was clicked (a name, avatar, member row). */
  peek: { userId: string; rect: PeekRect } | null;
  studioOpen: boolean;
  themeStudioOpen: boolean;
  openThemeStudio: () => void;
  closeThemeStudio: () => void;
  jumpTarget: JumpTarget | null;
  lightbox: LightboxImage | null;
  forwardMessageId: string | null;
  serverSettings: { serverId: string; tab: ServerSettingsTab } | null;
  channelSettingsId: string | null;
  /** Thread or forum post open in the side panel. */
  threadId: string | null;
  /** "Create thread" dialog: from a message, or a new standalone thread. */
  threadDraft: { parentId: string; messageId: string | null } | null;
  eventsServerId: string | null;
  /** Phones show one pane at a time: the server/DM lists, or the open channel. */
  mobilePane: 'nav' | 'main';
  /** Phones: which bottom tab is showing. */
  mobileTab: 'home' | 'servers' | 'inbox' | 'you';
  setMobileTab: (tab: 'home' | 'servers' | 'inbox' | 'you') => void;
  setMobilePane: (pane: 'nav' | 'main') => void;
  openThread: (threadId: string | null) => void;
  openThreadDraft: (draft: { parentId: string; messageId: string | null } | null) => void;
  openEvents: (serverId: string | null) => void;
  openHome: (target?: 'friends' | string) => void;
  selectServer: (serverId: string | null) => void;
  selectChannel: (serverId: string, channelId: string) => void;
  /** Navigate to a channel or conversation, optionally scrolling to a message. */
  goTo: (target: { serverId: string | null; scopeId: string; messageId?: string }) => void;
  clearJump: () => void;
  toggleMemberList: () => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  showProfile: (userId: string | null) => void;
  /** Open the small profile card next to an element (or the full profile if there's nothing to anchor to). */
  peekProfile: (userId: string | null, anchor?: Element | { clientX: number; clientY: number } | null) => void;
  openStudio: () => void;
  closeStudio: () => void;
  openLightbox: (image: LightboxImage | null) => void;
  openForward: (messageId: string | null) => void;
  openServerSettings: (target: { serverId: string; tab: ServerSettingsTab } | null) => void;
  openChannelSettings: (channelId: string | null) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  view: 'home',
  homeTarget: 'friends',
  serverId: null,
  channelByServer: {},
  memberListOpen: true,
  settingsOpen: false,
  settingsTab: 'profile',
  profilePopoverUserId: null,
  peek: null,
  studioOpen: false,
  themeStudioOpen: false,
  openThemeStudio: () => set({ themeStudioOpen: true, settingsOpen: false }),
  closeThemeStudio: () => set({ themeStudioOpen: false }),
  jumpTarget: null,
  lightbox: null,
  forwardMessageId: null,
  serverSettings: null,
  channelSettingsId: null,
  threadId: null,
  threadDraft: null,
  eventsServerId: null,
  mobilePane: 'nav',
  mobileTab: 'home',
  setMobileTab: (mobileTab) => set({ mobileTab, mobilePane: 'nav' }),
  setMobilePane: (mobilePane) => set({ mobilePane }),
  openThread: (threadId) => set({ threadId }),
  openThreadDraft: (threadDraft) => set({ threadDraft }),
  openEvents: (eventsServerId) => set({ eventsServerId }),
  openHome: (target) => set((s) => ({ view: 'home', homeTarget: target ?? s.homeTarget, threadId: null, mobilePane: target ? 'main' : 'nav' })),
  selectServer: (serverId) => set((s) => ({ serverId, view: serverId ? 'server' : 'home', threadId: serverId === s.serverId ? s.threadId : null, mobilePane: 'nav' })),
  selectChannel: (serverId, channelId) =>
    set((s) => ({ channelByServer: { ...s.channelByServer, [serverId]: channelId }, threadId: null, mobilePane: 'main' })),
  goTo: ({ serverId, scopeId, messageId }) =>
    set((s) => ({
      ...(serverId
        ? { view: 'server' as const, serverId, channelByServer: { ...s.channelByServer, [serverId]: scopeId } }
        : { view: 'home' as const, homeTarget: scopeId }),
      jumpTarget: messageId ? { scopeId, messageId, nonce: Date.now() } : s.jumpTarget,
      mobilePane: 'main' as const,
    })),
  clearJump: () => set({ jumpTarget: null }),
  toggleMemberList: () => set((s) => ({ memberListOpen: !s.memberListOpen })),
  openSettings: (tab) => set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab })),
  closeSettings: () => set({ settingsOpen: false }),
  showProfile: (profilePopoverUserId) => set({ profilePopoverUserId, peek: null }),
  peekProfile: (userId, anchor) => {
    if (!userId) return set({ peek: null });
    if (!anchor) return set({ profilePopoverUserId: userId, peek: null });
    const r =
      anchor instanceof Element
        ? anchor.getBoundingClientRect()
        : { left: anchor.clientX, right: anchor.clientX, top: anchor.clientY, bottom: anchor.clientY };
    set({ peek: { userId, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } } });
  },
  openStudio: () => set({ studioOpen: true, settingsOpen: false }),
  closeStudio: () => set({ studioOpen: false }),
  openLightbox: (lightbox) => set({ lightbox }),
  openForward: (forwardMessageId) => set({ forwardMessageId }),
  openServerSettings: (serverSettings) => set({ serverSettings }),
  openChannelSettings: (channelSettingsId) => set({ channelSettingsId }),
}));
