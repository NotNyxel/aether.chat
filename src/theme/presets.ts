/**
 * Theme presets for Aether. Each preset is a complete token set that ThemeEngine writes
 * to `--ae-*` CSS custom properties on <html>. Tailwind utilities (`bg-ae-bg`, `text-ae-muted`,
 * and so on) are mapped to those variables in src/index.css, so swapping presets re-themes the
 * whole app without re-rendering React.
 */

export type ThemePresetId =
  | 'oled-dark'
  | 'cyberpunk'
  | 'nord'
  | 'aether-glass'
  | 'midnight'
  | 'dracula'
  | 'catppuccin-mocha'
  | 'tokyo-night'
  | 'rose-pine'
  | 'gruvbox'
  | 'solarized-dark'
  | 'monokai'
  | 'synthwave'
  | 'vaporwave'
  | 'forest'
  | 'ocean'
  | 'sunset'
  | 'crimson'
  | 'matrix'
  | 'high-contrast'
  | 'daylight'
  | 'catppuccin-latte'
  | 'sakura'
  | 'paper'
  | 'everforest'
  | 'kanagawa'
  | 'one-dark'
  | 'ayu-mirage'
  | 'material-ocean'
  | 'lavender'
  | 'mint'
  | 'coffee'
  | 'amethyst'
  | 'aurora-borealis'
  | 'blood-moon'
  | 'arctic'
  | 'retro-terminal'
  | 'cotton-candy'
  | 'github-light'
  | 'nightfall';

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
  /** Light themes flip the browser's built-in controls (scrollbars, date pickers) to light. */
  light?: boolean;
  tokens: ThemeTokens;
}

const SYSTEM_FONT = `'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, 'Inter', sans-serif`;

/** Fills in the tokens most presets share, so each new preset only lists what makes it distinct. */
function preset(
  id: ThemePresetId,
  label: string,
  description: string,
  t: Partial<ThemeTokens> & Pick<ThemeTokens, 'bg' | 'bgElevated' | 'surface' | 'surfaceHover' | 'border' | 'text' | 'textMuted' | 'accent'>,
  light = false,
): ThemePreset {
  return {
    id,
    label,
    description,
    light,
    tokens: {
      backdrop: t.bg,
      bgSunken: t.bg,
      accentContrast: light ? '#ffffff' : '#0b0b0f',
      danger: light ? '#d63447' : '#ff5c6c',
      success: light ? '#1f9d55' : '#3ddc84',
      warning: light ? '#c47f00' : '#f5b942',
      radius: '10px',
      blur: '0px',
      font: SYSTEM_FONT,
      glow: 'none',
      ...t,
    },
  };
}

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
  midnight: preset('midnight', 'Midnight', 'Deep navy with an electric-blue accent.', {
    backdrop: 'radial-gradient(1000px 500px at 80% -10%, #12306b 0%, transparent 60%), #050a18',
    bg: '#060b1a', bgElevated: '#0b1226', bgSunken: '#040812', surface: '#111a33', surfaceHover: '#1a2546', border: '#1f2b4d',
    text: '#e6ecff', textMuted: '#8a97bd', accent: '#4d8dff', accentContrast: '#ffffff',
  }),
  dracula: preset('dracula', 'Dracula', 'The classic dark theme: purple, pink and cyan.', {
    bg: '#282a36', bgElevated: '#21222c', bgSunken: '#191a21', surface: '#343746', surfaceHover: '#414558', border: '#44475a',
    text: '#f8f8f2', textMuted: '#9ea8c7', accent: '#bd93f9', danger: '#ff5555', success: '#50fa7b', warning: '#f1fa8c',
  }),
  'catppuccin-mocha': preset('catppuccin-mocha', 'Catppuccin Mocha', 'Soothing pastels on a warm dark base.', {
    bg: '#1e1e2e', bgElevated: '#181825', bgSunken: '#11111b', surface: '#313244', surfaceHover: '#45475a', border: '#313244',
    text: '#cdd6f4', textMuted: '#9399b2', accent: '#cba6f7', danger: '#f38ba8', success: '#a6e3a1', warning: '#f9e2af', radius: '12px',
  }),
  'tokyo-night': preset('tokyo-night', 'Tokyo Night', 'Neon city lights after dark.', {
    bg: '#1a1b26', bgElevated: '#16161e', bgSunken: '#13131a', surface: '#24283b', surfaceHover: '#2f344d', border: '#292e42',
    text: '#c0caf5', textMuted: '#7a83ad', accent: '#7aa2f7', danger: '#f7768e', success: '#9ece6a', warning: '#e0af68',
  }),
  'rose-pine': preset('rose-pine', 'Rosé Pine', 'All natural pine, faux fur and a bit of soho vibes.', {
    bg: '#191724', bgElevated: '#1f1d2e', bgSunken: '#15131f', surface: '#26233a', surfaceHover: '#312e48', border: '#2a2740',
    text: '#e0def4', textMuted: '#908caa', accent: '#ebbcba', danger: '#eb6f92', success: '#9ccfd8', warning: '#f6c177', radius: '14px',
  }),
  gruvbox: preset('gruvbox', 'Gruvbox', 'Retro groove: warm, earthy contrast.', {
    bg: '#282828', bgElevated: '#1d2021', bgSunken: '#1a1a1a', surface: '#3c3836', surfaceHover: '#504945', border: '#3c3836',
    text: '#ebdbb2', textMuted: '#a89984', accent: '#fabd2f', danger: '#fb4934', success: '#b8bb26', warning: '#fe8019', radius: '4px',
  }),
  'solarized-dark': preset('solarized-dark', 'Solarized Dark', 'Precision colours for machines and people.', {
    bg: '#002b36', bgElevated: '#073642', bgSunken: '#00212b', surface: '#0b3d4a', surfaceHover: '#124b5a', border: '#0e4554',
    text: '#eee8d5', textMuted: '#93a1a1', accent: '#2aa198', danger: '#dc322f', success: '#859900', warning: '#b58900',
  }),
  monokai: preset('monokai', 'Monokai', "A coder's favourite: vivid on charcoal.", {
    bg: '#272822', bgElevated: '#1f201b', bgSunken: '#1a1b16', surface: '#34352d', surfaceHover: '#414238', border: '#3e3d32',
    text: '#f8f8f2', textMuted: '#a59f85', accent: '#a6e22e', danger: '#f92672', success: '#a6e22e', warning: '#fd971f', radius: '6px',
  }),
  synthwave: preset('synthwave', 'Synthwave', 'Outrun sunset: hot pink and chrome.', {
    backdrop: 'linear-gradient(180deg, #1b0b2e 0%, #2d0f3f 55%, #511a4a 100%)',
    bg: '#1b0b2e', bgElevated: '#24103a', bgSunken: '#130722', surface: '#33164f', surfaceHover: '#421d66', border: '#4d2475',
    text: '#ffe9ff', textMuted: '#c79bd8', accent: '#ff3cac', accentContrast: '#ffffff', warning: '#fdee5d', success: '#36f9f6',
    glow: '0 0 16px color-mix(in srgb, var(--ae-accent) 60%, transparent)',
  }),
  vaporwave: preset('vaporwave', 'Vaporwave', 'Pastel glass and dreamy gradients.', {
    backdrop:
      'radial-gradient(900px 600px at 0% 0%, #ff9ad5 0%, transparent 55%), radial-gradient(900px 600px at 100% 100%, #7ee8fa 0%, transparent 55%), #2b2142',
    bg: 'rgba(43, 33, 66, 0.55)', bgElevated: 'rgba(255, 255, 255, 0.08)', bgSunken: 'rgba(20, 12, 36, 0.35)',
    surface: 'rgba(255, 255, 255, 0.1)', surfaceHover: 'rgba(255, 255, 255, 0.17)', border: 'rgba(255, 255, 255, 0.18)',
    text: '#fff5fd', textMuted: '#d9c6ec', accent: '#ff9ad5', radius: '16px', blur: '20px',
    glow: '0 0 18px color-mix(in srgb, var(--ae-accent) 40%, transparent)',
  }),
  forest: preset('forest', 'Forest', 'Moss, pine and soft daylight through the leaves.', {
    backdrop: 'radial-gradient(1000px 600px at 10% 110%, #1f4d2e 0%, transparent 60%), #0f1a13',
    bg: '#0f1a13', bgElevated: '#13221a', bgSunken: '#0b140e', surface: '#1b2e22', surfaceHover: '#243c2d', border: '#264030',
    text: '#e3f2e6', textMuted: '#93b39c', accent: '#5fd38d', radius: '12px',
  }),
  ocean: preset('ocean', 'Ocean', 'Deep-sea teal with bioluminescent highlights.', {
    backdrop: 'radial-gradient(1000px 700px at 90% 110%, #0a5a6b 0%, transparent 60%), #04141c',
    bg: '#04141c', bgElevated: '#082029', bgSunken: '#030e14', surface: '#0d2c38', surfaceHover: '#133a49', border: '#15404f',
    text: '#dff6fb', textMuted: '#86b4c1', accent: '#2ee6d6', radius: '12px',
  }),
  sunset: preset('sunset', 'Sunset', 'Golden hour: amber and coral on dusk.', {
    backdrop: 'radial-gradient(1100px 600px at 50% -20%, #7a2e1d 0%, transparent 60%), #1a0f12',
    bg: '#1a0f12', bgElevated: '#221418', bgSunken: '#140b0e', surface: '#2f1b20', surfaceHover: '#3d232a', border: '#45282f',
    text: '#ffeee6', textMuted: '#c7a199', accent: '#ff8a4c', radius: '12px',
  }),
  crimson: preset('crimson', 'Crimson', 'Black and blood red. Bold.', {
    bg: '#0c0607', bgElevated: '#140a0c', bgSunken: '#080405', surface: '#1f0f12', surfaceHover: '#2c1418', border: '#3a161c',
    text: '#fbeaec', textMuted: '#b08a90', accent: '#e11d48', accentContrast: '#ffffff', radius: '6px',
    glow: '0 0 14px color-mix(in srgb, var(--ae-accent) 45%, transparent)',
  }),
  matrix: preset('matrix', 'Matrix', 'Phosphor green on black. Follow the white rabbit.', {
    bg: '#000700', bgElevated: '#010d02', bgSunken: '#000400', surface: '#03170a', surfaceHover: '#06240f', border: '#0b3317',
    text: '#c8ffd4', textMuted: '#4fbf6a', accent: '#00ff66', success: '#00ff66', radius: '0px',
    font: `'Cascadia Code', 'JetBrains Mono', ui-monospace, monospace`,
    glow: '0 0 12px color-mix(in srgb, var(--ae-accent) 55%, transparent)',
  }),
  'high-contrast': preset('high-contrast', 'High Contrast', 'Maximum legibility: pure black, pure white, strong yellow.', {
    bg: '#000000', bgElevated: '#000000', bgSunken: '#000000', surface: '#111111', surfaceHover: '#262626', border: '#ffffff',
    text: '#ffffff', textMuted: '#e0e0e0', accent: '#ffd400', danger: '#ff6b6b', success: '#5cff8d', warning: '#ffd400', radius: '4px',
  }),
  daylight: preset('daylight', 'Daylight', 'Clean and bright. A light theme for sunny rooms.', {
    backdrop: '#eef0f5', bg: '#ffffff', bgElevated: '#f4f5f8', bgSunken: '#e9ebf1', surface: '#e8eaf0', surfaceHover: '#dcdfe8', border: '#d7dae3',
    text: '#14161c', textMuted: '#5c6273', accent: '#5b5bf7',
  }, true),
  'catppuccin-latte': preset('catppuccin-latte', 'Catppuccin Latte', 'Pastel light theme, soft on the eyes.', {
    backdrop: '#e6e9ef', bg: '#eff1f5', bgElevated: '#e6e9ef', bgSunken: '#dce0e8', surface: '#ccd0da', surfaceHover: '#bcc0cc', border: '#ccd0da',
    text: '#4c4f69', textMuted: '#6c6f85', accent: '#8839ef', danger: '#d20f39', success: '#40a02b', warning: '#df8e1d', radius: '12px',
  }, true),
  sakura: preset('sakura', 'Sakura', 'Cherry-blossom pink on warm white.', {
    backdrop: 'radial-gradient(900px 500px at 100% 0%, #ffd6e7 0%, transparent 60%), #fff7fa',
    bg: '#fffafc', bgElevated: '#fff0f5', bgSunken: '#ffe6ef', surface: '#ffe1ec', surfaceHover: '#ffd0e1', border: '#f7c9da',
    text: '#3d2430', textMuted: '#8a6474', accent: '#e0569b', radius: '16px',
  }, true),
  paper: preset('paper', 'Paper', 'Solarized light: like reading a good book.', {
    backdrop: '#f4eedb', bg: '#fdf6e3', bgElevated: '#f4eedb', bgSunken: '#ece5cf', surface: '#eee8d5', surfaceHover: '#e3dcc4', border: '#ddd5bb',
    text: '#3b4a52', textMuted: '#657b83', accent: '#268bd2', radius: '6px',
  }, true),

  everforest: preset('everforest', 'Everforest', 'Soft greens for long sessions.', {
    bg: '#2d353b', bgElevated: '#343f44', bgSunken: '#272e33', surface: '#3d484d', surfaceHover: '#475258', border: '#4f585e',
    text: '#d3c6aa', textMuted: '#9da9a0', accent: '#a7c080', radius: '10px',
  }),
  kanagawa: preset('kanagawa', 'Kanagawa', 'Ink and wave, inspired by Hokusai.', {
    bg: '#1f1f28', bgElevated: '#2a2a37', bgSunken: '#16161d', surface: '#363646', surfaceHover: '#3f3f52', border: '#54546d',
    text: '#dcd7ba', textMuted: '#938aa9', accent: '#7e9cd8', radius: '8px',
  }),
  'one-dark': preset('one-dark', 'One Dark', 'The classic editor theme.', {
    bg: '#282c34', bgElevated: '#2f343e', bgSunken: '#21252b', surface: '#353b45', surfaceHover: '#3e4451', border: '#3e4451',
    text: '#abb2bf', textMuted: '#7f848e', accent: '#61afef', radius: '8px',
  }),
  'ayu-mirage': preset('ayu-mirage', 'Ayu Mirage', 'Warm orange on deep slate.', {
    bg: '#1f2430', bgElevated: '#242936', bgSunken: '#1a1f29', surface: '#2d3343', surfaceHover: '#363d4f', border: '#3a4152',
    text: '#cccac2', textMuted: '#8a9199', accent: '#ffcc66', radius: '8px',
  }),
  'material-ocean': preset('material-ocean', 'Material Ocean', 'Deep blue with teal highlights.', {
    bg: '#0f111a', bgElevated: '#141724', bgSunken: '#090b10', surface: '#1a1c25', surfaceHover: '#232637', border: '#232637',
    text: '#c8d3f5', textMuted: '#717cb4', accent: '#84ffff', radius: '10px',
  }),
  lavender: preset('lavender', 'Lavender Haze', 'Dreamy purples, soft and calm.', {
    backdrop: 'radial-gradient(120% 90% at 0% 0%, #3b2b5a 0%, #1c1630 60%)',
    bg: '#1d1730', bgElevated: '#251e3d', bgSunken: '#17122a', surface: '#2e2649', surfaceHover: '#3a3059', border: '#3d335c',
    text: '#ece6ff', textMuted: '#a99cd0', accent: '#b69cff', radius: '14px',
  }),
  mint: preset('mint', 'Mint', 'Fresh and minty, light and clean.', {
    backdrop: '#e8f7f1', bg: '#f4fbf8', bgElevated: '#ffffff', bgSunken: '#e5f3ed', surface: '#e6f4ee', surfaceHover: '#d6ece2', border: '#cfe5db',
    text: '#17322a', textMuted: '#55786c', accent: '#14a37f', radius: '12px',
  }, true),
  coffee: preset('coffee', 'Coffee', 'Roasted browns and crema.', {
    bg: '#211a16', bgElevated: '#2a211c', bgSunken: '#1a1411', surface: '#352a23', surfaceHover: '#43352c', border: '#4a3a30',
    text: '#eadbc8', textMuted: '#b09a84', accent: '#d4a373', radius: '10px',
  }),
  amethyst: preset('amethyst', 'Amethyst', 'Crystal violet with a glow.', {
    backdrop: 'linear-gradient(160deg, #1a0b2e, #2d0f4a 60%, #120624)',
    bg: '#170a29', bgElevated: '#1f0f36', bgSunken: '#12071f', surface: '#2a1547', surfaceHover: '#361c5a', border: '#3d2163',
    text: '#f1e6ff', textMuted: '#b197d8', accent: '#c77dff', radius: '12px', glow: '0 0 18px #c77dff55',
  }),
  'aurora-borealis': preset('aurora-borealis', 'Aurora Borealis', 'Northern lights over a dark sky.', {
    backdrop: 'radial-gradient(80% 60% at 20% 0%, #0f5f4a 0%, transparent 60%), radial-gradient(70% 60% at 90% 10%, #3b2a7a 0%, transparent 60%), #071016',
    bg: '#0b1419', bgElevated: '#101c23', bgSunken: '#070e12', surface: '#14242d', surfaceHover: '#1b313c', border: '#1f3844',
    text: '#e3fbf3', textMuted: '#88b3a8', accent: '#3ff2b4', radius: '12px', glow: '0 0 18px #3ff2b444',
  }),
  'blood-moon': preset('blood-moon', 'Blood Moon', 'Deep crimson night.', {
    backdrop: 'radial-gradient(90% 70% at 80% 0%, #4a0b12 0%, #0d0607 65%)',
    bg: '#120809', bgElevated: '#1a0c0e', bgSunken: '#0c0506', surface: '#241113', surfaceHover: '#30171a', border: '#3a1b1f',
    text: '#f6e4e4', textMuted: '#b98a8d', accent: '#ff4d5e', radius: '8px',
  }),
  arctic: preset('arctic', 'Arctic', 'Icy blues, crisp and bright.', {
    backdrop: '#e7f0f8', bg: '#f3f8fc', bgElevated: '#ffffff', bgSunken: '#e4eef7', surface: '#e6eff7', surfaceHover: '#d7e5f1', border: '#cfdeeb',
    text: '#13263a', textMuted: '#5a7189', accent: '#2b8ef0', radius: '10px',
  }, true),
  'retro-terminal': preset('retro-terminal', 'Retro Terminal', 'Amber phosphor on black.', {
    bg: '#0c0a05', bgElevated: '#13100a', bgSunken: '#080603', surface: '#1b170d', surfaceHover: '#262012', border: '#3a2f14',
    text: '#ffc66d', textMuted: '#b48a45', accent: '#ffb000', radius: '2px', font: `'Cascadia Code', 'JetBrains Mono', ui-monospace, monospace`,
  }),
  'cotton-candy': preset('cotton-candy', 'Cotton Candy', 'Pink and blue, sweet and soft.', {
    backdrop: 'linear-gradient(135deg, #ffe3f1, #dff1ff)',
    bg: '#fff5fb', bgElevated: '#ffffff', bgSunken: '#fbe9f4', surface: '#f8e6f2', surfaceHover: '#f0d7e9', border: '#ecd2e4',
    text: '#3a2440', textMuted: '#8a6b90', accent: '#ff6fb5', radius: '18px',
  }, true),
  'github-light': preset('github-light', 'Clean Light', 'Neutral, high-clarity light theme.', {
    backdrop: '#f6f8fa', bg: '#ffffff', bgElevated: '#ffffff', bgSunken: '#f6f8fa', surface: '#f3f4f6', surfaceHover: '#eaeef2', border: '#d8dee4',
    text: '#1f2328', textMuted: '#656d76', accent: '#0969da', radius: '8px',
  }, true),
  nightfall: preset('nightfall', 'Nightfall', 'Indigo dusk with a warm accent.', {
    backdrop: 'linear-gradient(180deg, #141432, #0b0b1c)',
    bg: '#10102a', bgElevated: '#171736', bgSunken: '#0b0b1f', surface: '#1f1f45', surfaceHover: '#292955', border: '#2c2c5c',
    text: '#e9e8ff', textMuted: '#9c9bd0', accent: '#ff9e64', radius: '12px',
  }),
};

export const PRESET_ORDER: ThemePresetId[] = [
  'oled-dark', 'midnight', 'aether-glass', 'cyberpunk', 'synthwave', 'vaporwave', 'nord', 'dracula', 'catppuccin-mocha', 'tokyo-night',
  'rose-pine', 'gruvbox', 'solarized-dark', 'monokai', 'forest', 'ocean', 'sunset', 'crimson', 'matrix', 'high-contrast',
  'everforest', 'kanagawa', 'one-dark', 'ayu-mirage', 'material-ocean', 'lavender', 'coffee', 'amethyst', 'aurora-borealis', 'blood-moon',
  'retro-terminal', 'nightfall',
  'daylight', 'catppuccin-latte', 'sakura', 'paper', 'mint', 'arctic', 'cotton-candy', 'github-light',
];

/** Animated avatar frame presets (CSS in src/index.css). Stored in users.avatar_frame. */
export const AVATAR_FRAMES = [
  { id: 'none', label: 'None' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'neon', label: 'Neon' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'glitch', label: 'Glitch' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'fire', label: 'Fire' },
  { id: 'ice', label: 'Ice' },
  { id: 'hearts', label: 'Hearts' },
  { id: 'sparkle', label: 'Sparkle' },
  { id: 'halo', label: 'Halo' },
  { id: 'radar', label: 'Radar' },
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
