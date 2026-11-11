/**
 * Persistent local preferences (Zustand + localStorage): theme, audio pipeline, screen share
 * defaults and keybinds. Server data (profiles, messages) lives in TanStack Query,
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
}

export interface Keybinds {
  toggleMute: string | null;
  toggleDeafen: string | null;
  pushToTalk: string | null;
  pushToTalkEnabled: boolean;
}

interface SettingsState {
  theme: ThemeSettings;
  audio: AudioProcessingSettings;
  screen: ScreenShareOptions;
  keybinds: Keybinds;
  /** Accent color from the signed-in user's profile (mirrored here so ThemeEngine can use it). */
  profileAccent: string | null;
  setTheme: (patch: Partial<ThemeSettings>) => void;
  setAudio: (patch: Partial<AudioProcessingSettings>) => void;
  setScreen: (patch: Partial<ScreenShareOptions>) => void;
  setKeybinds: (patch: Partial<Keybinds>) => void;
  setProfileAccent: (accent: string | null) => void;
}

export const DEFAULT_THEME: ThemeSettings = {
  presetId: 'oled-dark',
  accentOverride: null,
  useProfileAccent: false,
  customCss: '',
  customCssEnabled: false,
  reduceMotion: false,
};

export const DEFAULT_KEYBINDS: Keybinds = {
  toggleMute: 'Ctrl+Shift+KeyM',
  toggleDeafen: 'Ctrl+Shift+KeyD',
  pushToTalk: null,
  pushToTalkEnabled: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      audio: DEFAULT_AUDIO_SETTINGS,
      screen: DEFAULT_SCREEN_SHARE,
      keybinds: DEFAULT_KEYBINDS,
      profileAccent: null,
      setTheme: (patch) => set((s) => ({ theme: { ...s.theme, ...patch } })),
      setAudio: (patch) => set((s) => ({ audio: { ...s.audio, ...patch } })),
      setScreen: (patch) => set((s) => ({ screen: { ...s.screen, ...patch } })),
      setKeybinds: (patch) => set((s) => ({ keybinds: { ...s.keybinds, ...patch } })),
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
        };
      },
    },
  ),
);
