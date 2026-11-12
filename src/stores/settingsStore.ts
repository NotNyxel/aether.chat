/**
 * Persistent local preferences (Zustand + localStorage): theme, audio pipeline, screen share
 * defaults, keybinds and sounds. Server data (profiles, messages) lives in TanStack Query,
 * not here.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_SCREEN_SHARE,
  type AudioProcessingSettings,
  type ScreenShareOptions,
} from '../hooks/useVoiceEngine';
import type { CustomGame } from '../lib/games';
import type { SoundId } from '../lib/sounds';
import type { ThemePresetId } from '../theme/presets';

export interface ThemeSettings {
  presetId: ThemePresetId;
  /** Overrides the preset accent. `null` keeps the preset's accent. */
  accentOverride: string | null;
  /** Use the accent color from your own profile instead of the preset or override. */
  useProfileAccent: boolean;
  customCss: string;
  customCssEnabled: boolean;
  reduceMotion: boolean;
  /** Slowly drifting accent-coloured glow behind the app. */
  ambientBackground: boolean;
  /** How lively the interface is: full (springy), subtle, or off. */
  animations: 'full' | 'subtle' | 'off' | 'system';
  /** Status icons morph between states and glow softly. */
  animateStatus: boolean;
}

export interface Keybinds {
  toggleMute: string | null;
  toggleDeafen: string | null;
  pushToTalk: string | null;
  pushToTalkEnabled: boolean;
}

export interface SoundSettings {
  /** Master switch for all sound effects. */
  enabled: boolean;
  /** 0-1. */
  volume: number;
  /** Individually turned-off sounds. */
  disabled: SoundId[];
}

export interface NotificationPrefs {
  /** Native desktop notifications for DMs, mentions and calls while the app isn't focused. */
  desktop: boolean;
  /** Include the message text in notifications. */
  showPreview: boolean;
  /** Unread count on the taskbar icon and in the window title. */
  taskbarBadge: boolean;
  /** Flash the taskbar button on incoming calls. */
  flashOnCall: boolean;
}

export interface SystemPrefs {
  /** Closing the window keeps Aether running in the system tray. */
  closeToTray: boolean;
  /** Mute, deafen and push-to-talk shortcuts work while another app is focused. */
  globalShortcuts: boolean;
  /** Minutes without input before you show as Idle (0 = never). */
  autoIdleMinutes: number;
}

export interface ActivityPrefs {
  /** Detect running games and show "Playing …" to others. Off by default. */
  shareActivity: boolean;
  /** Share the Spotify track you're listening to. */
  shareSpotify: boolean;
  customGames: CustomGame[];
}

interface SettingsState {
  theme: ThemeSettings;
  audio: AudioProcessingSettings;
  screen: ScreenShareOptions;
  keybinds: Keybinds;
  sounds: SoundSettings;
  notifications: NotificationPrefs;
  system: SystemPrefs;
  activity: ActivityPrefs;
  /** Accent color from the signed-in user's profile (mirrored here so ThemeEngine can use it). */
  profileAccent: string | null;
  setTheme: (patch: Partial<ThemeSettings>) => void;
  setAudio: (patch: Partial<AudioProcessingSettings>) => void;
  setScreen: (patch: Partial<ScreenShareOptions>) => void;
  setKeybinds: (patch: Partial<Keybinds>) => void;
  setSounds: (patch: Partial<SoundSettings>) => void;
  setNotifications: (patch: Partial<NotificationPrefs>) => void;
  setSystem: (patch: Partial<SystemPrefs>) => void;
  setActivity: (patch: Partial<ActivityPrefs>) => void;
  setProfileAccent: (accent: string | null) => void;
}

export const DEFAULT_THEME: ThemeSettings = {
  presetId: 'oled-dark',
  accentOverride: null,
  useProfileAccent: false,
  customCss: '',
  customCssEnabled: false,
  reduceMotion: false,
  ambientBackground: true,
  animations: 'full',
  animateStatus: true,
};

export const DEFAULT_KEYBINDS: Keybinds = {
  toggleMute: 'Ctrl+Shift+KeyM',
  toggleDeafen: 'Ctrl+Shift+KeyD',
  pushToTalk: null,
  pushToTalkEnabled: false,
};

export const DEFAULT_SOUNDS: SoundSettings = {
  enabled: true,
  volume: 0.7,
  disabled: ['messageSent'],
};

export const DEFAULT_NOTIFICATIONS: NotificationPrefs = { desktop: true, showPreview: true, taskbarBadge: true, flashOnCall: true };
export const DEFAULT_SYSTEM: SystemPrefs = { closeToTray: true, globalShortcuts: true, autoIdleMinutes: 10 };
export const DEFAULT_ACTIVITY: ActivityPrefs = { shareActivity: false, shareSpotify: false, customGames: [] };

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      audio: DEFAULT_AUDIO_SETTINGS,
      screen: DEFAULT_SCREEN_SHARE,
      keybinds: DEFAULT_KEYBINDS,
      sounds: DEFAULT_SOUNDS,
      notifications: DEFAULT_NOTIFICATIONS,
      system: DEFAULT_SYSTEM,
      activity: DEFAULT_ACTIVITY,
      profileAccent: null,
      setTheme: (patch) => set((s) => ({ theme: { ...s.theme, ...patch } })),
      setAudio: (patch) => set((s) => ({ audio: { ...s.audio, ...patch } })),
      setScreen: (patch) => set((s) => ({ screen: { ...s.screen, ...patch } })),
      setKeybinds: (patch) => set((s) => ({ keybinds: { ...s.keybinds, ...patch } })),
      setSounds: (patch) => set((s) => ({ sounds: { ...s.sounds, ...patch } })),
      setNotifications: (patch) => set((s) => ({ notifications: { ...s.notifications, ...patch } })),
      setSystem: (patch) => set((s) => ({ system: { ...s.system, ...patch } })),
      setActivity: (patch) => set((s) => ({ activity: { ...s.activity, ...patch } })),
      setProfileAccent: (profileAccent) => set({ profileAccent }),
    }),
    {
      name: 'aether.settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Merge stored values over defaults so settings added in later versions get their defaults.
      merge: (persisted, current) => {
        // Drop the backend override stored by versions before 0.3.0 (the backend is now built in).
        const { backend: _legacyBackend, ...p } = (persisted ?? {}) as Partial<SettingsState> & { backend?: unknown };
        return {
          ...current,
          ...p,
          theme: { ...current.theme, ...p.theme },
          audio: { ...current.audio, ...p.audio },
          screen: { ...current.screen, ...p.screen },
          keybinds: { ...current.keybinds, ...p.keybinds },
          sounds: { ...current.sounds, ...p.sounds },
          notifications: { ...current.notifications, ...p.notifications },
          system: { ...current.system, ...p.system },
          activity: { ...current.activity, ...p.activity },
        };
      },
    },
  ),
);
