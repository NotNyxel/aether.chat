/** Ephemeral UI state: Home vs server view, selections, open dialogs, profile popover. */
import { create } from 'zustand';

export type SettingsTab = 'profile' | 'appearance' | 'voice' | 'keybinds' | 'bandwidth';

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
  openHome: (target?: 'friends' | string) => void;
  selectServer: (serverId: string | null) => void;
  selectChannel: (serverId: string, channelId: string) => void;
  toggleMemberList: () => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  showProfile: (userId: string | null) => void;
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
  openHome: (target) => set((s) => ({ view: 'home', homeTarget: target ?? s.homeTarget })),
  selectServer: (serverId) => set({ serverId, view: serverId ? 'server' : 'home' }),
  selectChannel: (serverId, channelId) =>
    set((s) => ({ channelByServer: { ...s.channelByServer, [serverId]: channelId } })),
  toggleMemberList: () => set((s) => ({ memberListOpen: !s.memberListOpen })),
  openSettings: (tab) => set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab })),
  closeSettings: () => set({ settingsOpen: false }),
  showProfile: (profilePopoverUserId) => set({ profilePopoverUserId }),
}));
