/** Catalogues for profile decorations. The visuals live in src/decor.css (pure CSS/SVG, no images). */

export const NAMEPLATES = [
  { id: 'none', label: 'None' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'galaxy', label: 'Galaxy' },
  { id: 'sakura', label: 'Sakura' },
  { id: 'ember', label: 'Ember' },
  { id: 'frost', label: 'Frost' },
  { id: 'neon', label: 'Neon Grid' },
  { id: 'holo', label: 'Holographic' },
  { id: 'gold', label: 'Gilded' },
  { id: 'forest', label: 'Forest' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'candy', label: 'Candy' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'storm', label: 'Storm' },
] as const;

export const CARD_FRAMES = [
  { id: 'none', label: 'None' },
  { id: 'roses', label: 'White Roses' },
  { id: 'crimson-roses', label: 'Crimson Roses' },
  { id: 'gold', label: 'Gilded' },
  { id: 'neon', label: 'Neon' },
  { id: 'rainbow', label: 'Prism' },
  { id: 'frost', label: 'Frost' },
  { id: 'flames', label: 'Flames' },
  { id: 'stars', label: 'Starfall' },
  { id: 'circuit', label: 'Circuit' },
  { id: 'vines', label: 'Vines' },
  { id: 'hearts', label: 'Hearts' },
] as const;

export type NameplateId = (typeof NAMEPLATES)[number]['id'];
export type CardFrameId = (typeof CARD_FRAMES)[number]['id'];

/** Profile widget kinds (users.profile_widgets). */
export type ProfileWidget =
  | { type: 'favorite_game'; name: string; note?: string }
  | { type: 'games'; names: string[] }
  | { type: 'about'; title: string; text: string }
  | { type: 'music'; title: string; artist: string }
  | { type: 'quote'; text: string };

export const WIDGET_TYPES: { type: ProfileWidget['type']; label: string; hint: string }[] = [
  { type: 'favorite_game', label: 'Favorite game', hint: 'The one game you always come back to.' },
  { type: 'games', label: 'Games I like', hint: 'Up to six games, with their artwork.' },
  { type: 'music', label: 'On repeat', hint: 'A song you can’t stop playing.' },
  { type: 'about', label: 'Card', hint: 'A titled card with anything you like.' },
  { type: 'quote', label: 'Quote', hint: 'Words to live by.' },
];

/**
 * Colours a profile uses when its owner hasn't picked any. Fixed values, never the viewer's theme,
 * so everyone sees the same profile (the app accent follows *your* profile accent, so using it
 * here would paint other people's profiles in your colours).
 */
export const DEFAULT_PROFILE_PRIMARY = '#2a2440';
export const DEFAULT_PROFILE_ACCENT = '#7c5cff';
