/**
 * Theme presets for aether.chat. Each preset is a complete token set that ThemeEngine writes
 * to `--ae-*` CSS custom properties on <html>. Tailwind utilities (`bg-ae-bg`, `text-ae-muted`,
 * and so on) are mapped to those variables in src/index.css, so swapping presets re-themes the
 * whole app without re-rendering React.
 */

export type ThemePresetId = 'oled-dark' | 'cyberpunk' | 'nord' | 'aether-glass';

export interface ThemeTokens {
  /** Page backdrop (may be a gradient). */
  backdrop: string;
  bg: string;
  bgElevated: string;
  bgSunken: string;
  surface: string;
  surfaceHover: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentContrast: string;
  danger: string;
  success: string;
  warning: string;
  radius: string;
  /** Backdrop-filter blur for panels (glass effect). `0px` disables it. */
  blur: string;
  font: string;
  /** Box-shadow used on focused or active accent elements. */
  glow: string;
}

export interface ThemePreset {
  id: ThemePresetId;
  label: string;
  description: string;
  tokens: ThemeTokens;
}

const SYSTEM_FONT = `'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, 'Inter', sans-serif`;

export const THEME_PRESETS: Record<ThemePresetId, ThemePreset> = {
  'oled-dark': {
    id: 'oled-dark',
    label: 'OLED Dark',
    description: 'True black surfaces. Lowest power draw on OLED panels.',
    tokens: {
      backdrop: '#000000',
      bg: '#000000',
      bgElevated: '#0a0a0b',
      bgSunken: '#000000',
      surface: '#131315',
      surfaceHover: '#1d1d21',
      border: '#232327',
      text: '#f2f2f4',
      textMuted: '#8b8b94',
      accent: '#7c5cff',
      accentContrast: '#ffffff',
      danger: '#ff4d5e',
      success: '#2ecc71',
      warning: '#f5a623',
      radius: '10px',
      blur: '0px',
      font: SYSTEM_FONT,
      glow: 'none',
    },
  },
  cyberpunk: {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    description: 'Neon cyan on deep violet, sharp corners, glowing accents.',
    tokens: {
      backdrop: 'radial-gradient(1200px 600px at 10% -10%, #2a0b4a 0%, transparent 60%), #0b0614',
      bg: '#0b0614',
      bgElevated: '#140b24',
      bgSunken: '#07030d',
      surface: '#1d1033',
      surfaceHover: '#2a1748',
      border: '#3b1f66',
      text: '#f0e9ff',
      textMuted: '#a28cc9',
      accent: '#00f0ff',
      accentContrast: '#05010a',
      danger: '#ff3864',
      success: '#39ff14',
      warning: '#fcee0a',
      radius: '2px',
      blur: '0px',
      font: `'Cascadia Code', 'JetBrains Mono', ui-monospace, monospace`,
      glow: '0 0 14px color-mix(in srgb, var(--ae-accent) 55%, transparent)',
    },
  },
  nord: {
    id: 'nord',
    label: 'Nord',
    description: 'Arctic, north-bluish calm. Easy on the eyes for long sessions.',
    tokens: {
      backdrop: '#2e3440',
      bg: '#2e3440',
      bgElevated: '#3b4252',
      bgSunken: '#272c36',
      surface: '#434c5e',
      surfaceHover: '#4c566a',
      border: '#4c566a',
      text: '#eceff4',
      textMuted: '#a7b1c4',
      accent: '#88c0d0',
      accentContrast: '#2e3440',
      danger: '#bf616a',
      success: '#a3be8c',
      warning: '#ebcb8b',
      radius: '8px',
      blur: '0px',
      font: SYSTEM_FONT,
      glow: 'none',
    },
  },
  'aether-glass': {
    id: 'aether-glass',
    label: 'aetherOS Glass',
    description: 'Frosted translucent panels over a soft aurora backdrop.',
    tokens: {
      backdrop:
        'radial-gradient(900px 600px at 0% 0%, #3b2a8a 0%, transparent 60%), radial-gradient(800px 600px at 100% 100%, #0f6b8f 0%, transparent 55%), #0b1020',
      bg: 'rgba(12, 16, 32, 0.55)',
      bgElevated: 'rgba(255, 255, 255, 0.06)',
      bgSunken: 'rgba(0, 0, 0, 0.28)',
      surface: 'rgba(255, 255, 255, 0.08)',
      surfaceHover: 'rgba(255, 255, 255, 0.14)',
      border: 'rgba(255, 255, 255, 0.14)',
      text: '#eef2ff',
      textMuted: '#a5b0d0',
      accent: '#7aa2ff',
      accentContrast: '#0b1020',
      danger: '#ff6b81',
      success: '#5ee6a8',
      warning: '#ffd166',
      radius: '14px',
      blur: '18px',
      font: SYSTEM_FONT,
      glow: '0 0 18px color-mix(in srgb, var(--ae-accent) 35%, transparent)',
    },
  },
};

export const PRESET_ORDER: ThemePresetId[] = ['oled-dark', 'cyberpunk', 'nord', 'aether-glass'];

/** Animated avatar frame presets (CSS in src/index.css). Stored in users.avatar_frame. */
export const AVATAR_FRAMES = [
  { id: 'none', label: 'None' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'neon', label: 'Neon' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'glitch', label: 'Glitch' },
] as const;

export type AvatarFrameId = (typeof AVATAR_FRAMES)[number]['id'];

const HEX = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string | null | undefined): value is string {
  return !!value && HEX.test(value);
}

/** Returns black or white text, whichever reads better on the given hex background (WCAG luminance). */
export function readableTextOn(hex: string): string {
  const m = HEX.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return lum > 0.4 ? '#0b0b0f' : '#ffffff';
}
