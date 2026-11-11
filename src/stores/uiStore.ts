/** Ephemeral UI state: Home vs server view, selections, panels, dialogs, jump targets, lightbox. */
import { create } from 'zustand';

export type SettingsTab = 'profile' | 'appearance' | 'voice' | 'notifications' | 'keybinds' | 'bandwidth';

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
  jumpTarget: JumpTarget | null;
  lightbox: LightboxImage | null;
  forwardMessageId: string | null;
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
  openLightbox: (image: LightboxImage | null) => void;
  openForward: (messageId: string | null) => void;
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
  jumpTarget: null,
  lightbox: null,
  forwardMessageId: null,
  openHome: (target) => set((s) => ({ view: 'home', homeTarget: target ?? s.homeTarget })),
  selectServer: (serverId) => set({ serverId, view: serverId ? 'server' : 'home' }),
  selectChannel: (serverId, channelId) =>
    set((s) => ({ channelByServer: { ...s.channelByServer, [serverId]: channelId } })),
  goTo: ({ serverId, scopeId, messageId }) =>
    set((s) => ({
      ...(serverId
        ? { view: 'server' as const, serverId, channelByServer: { ...s.channelByServer, [serverId]: scopeId } }
        : { view: 'home' as const, homeTarget: scopeId }),
      jumpTarget: messageId ? { scopeId, messageId, nonce: Date.now() } : s.jumpTarget,
    })),
  clearJump: () => set({ jumpTarget: null }),
  toggleMemberList: () => set((s) => ({ memberListOpen: !s.memberListOpen })),
  openSettings: (tab) => set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab })),
  closeSettings: () => set({ settingsOpen: false }),
  showProfile: (profilePopoverUserId) => set({ profilePopoverUserId }),
  openLightbox: (lightbox) => set({ lightbox }),
  openForward: (forwardMessageId) => set({ forwardMessageId }),
}));
