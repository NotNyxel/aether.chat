/**
 * Generated cosmetics: ~100 each of nameplates, avatar decorations, avatar shapes, banner colours,
 * profile effects, profile frames, name fonts, name effects and profile themes. Each family is
 * one CSS rule in src/cosmetics.css driven by CSS variables; this file names them, picks default
 * palettes and turns a profile's choices (plus its custom colours in users.decor) into attributes.
 *
 * Ids are short and stable because they're stored in the database (e.g. "pl-sheen-violet").
 */
import type { CSSProperties } from 'react';
import { AVATAR_DECOS, CARD_ARTS, cardArtStyle } from './decoArt';

// ── Palettes ────────────────────────────────────────────────────────────────────────────────
export const PALETTES: { id: string; label: string; c: [string, string, string] }[] = [
  { id: 'violet', label: 'Violet', c: ['#7c5cff', '#c77dff', '#00d4ff'] },
  { id: 'sunset', label: 'Sunset', c: ['#ff7e5f', '#feb47b', '#ff3d7f'] },
  { id: 'ocean', label: 'Ocean', c: ['#00c6ff', '#0072ff', '#5ef2d6'] },
  { id: 'forest', label: 'Forest', c: ['#3ba55d', '#a8e063', '#1d6b3a'] },
  { id: 'ember', label: 'Ember', c: ['#ff512f', '#f09819', '#ffd200'] },
  { id: 'rose', label: 'Rose', c: ['#ff6fb5', '#ffc2e2', '#c2185b'] },
  { id: 'ice', label: 'Ice', c: ['#a1c4fd', '#e0f4ff', '#5c9dff'] },
  { id: 'gold', label: 'Gold', c: ['#f7d774', '#b8860b', '#fff3c4'] },
  { id: 'mono', label: 'Mono', c: ['#f0f0f0', '#8a8a8a', '#3a3a3a'] },
  { id: 'toxic', label: 'Toxic', c: ['#b6ff00', '#00ff85', '#1a3d00'] },
];
const paletteOf = (id: string) => PALETTES.find((p) => p.id === id)?.c ?? PALETTES[0]!.c;

/** Per-profile extras (users.decor). Every colour here comes from a colour picker. */
export interface Decor {
  plate?: string[];
  frame?: string[];
  cardFrame?: string;
  cardFrame2?: string;
  effect?: string;
  effectAngle?: number;
  effectMotion?: Motion;
  themeV?: number;
  /** Colours for expressive avatar decorations (ears, hats, marks). */
  deco?: string[];
  avatarCrop?: Crop;
  bannerCrop?: Crop;
}
export interface Crop {
  x: number; // 0–100, focus point
  y: number;
  z: number; // 1–4 zoom
}

export interface Option {
  id: string;
  label: string;
  group: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** One entry per style; colours come from the colour pickers (users.decor). */
const styles = (prefix: string, families: [string, string][], group: string): Option[] => families.map(([fam, label]) => ({ id: `${prefix}-${fam}`, label, group }));
/** "pl-sheen" or the older "pl-sheen-violet" (palette ids from 1.4.0 keep working). */
const parse = (id: string | null | undefined, prefix: string) => {
  const m = id ? new RegExp(`^${prefix}-([a-z0-9]+)(?:-([a-z0-9]+))?$`).exec(id) : null;
  return m ? { fam: m[1]!, pal: m[2] ?? 'violet' } : null;
};

// ── Nameplates ──────────────────────────────────────────────────────────────────────────────
const PLATE_FAMILIES: [string, string][] = [
  ['sheen', 'Sheen'],
  ['aurora', 'Aurora'],
  ['grid', 'Grid'],
  ['stripes', 'Stripes'],
  ['dots', 'Dots'],
  ['waves', 'Waves'],
  ['glow', 'Glow'],
  ['mesh', 'Mesh'],
  ['scan', 'Scanline'],
  ['spark', 'Sparkle'],
];
export const GEN_NAMEPLATES = styles('pl', PLATE_FAMILIES, 'Styles');

export function plateProps(id: string | null | undefined, decor?: Decor | null): { 'data-plate': string; 'data-ps'?: string; style?: CSSProperties } {
  const g = parse(id, 'pl');
  if (!g) return { 'data-plate': id || 'none' };
  const [a, b, c] = decor?.plate?.length ? [decor.plate[0], decor.plate[1] ?? decor.plate[0], decor.plate[2] ?? decor.plate[0]] : paletteOf(g.pal);
  return { 'data-plate': id!, 'data-ps': g.fam, style: { '--pa': a, '--pb': b, '--pc': c } as CSSProperties };
}

// ── Avatar decorations ──────────────────────────────────────────────────────────────────────
const FRAME_FAMILIES: [string, string][] = [
  ['ring', 'Ring'],
  ['duo', 'Duotone Spin'],
  ['dash', 'Dashed'],
  ['pulse', 'Pulse'],
  ['orbit', 'Orbit'],
  ['halo', 'Halo'],
  ['spark', 'Sparkler'],
  ['double', 'Double Ring'],
  ['flicker', 'Neon Flicker'],
  ['prism', 'Prism'],
];
export const GEN_AVATAR_FRAMES = styles('fr', FRAME_FAMILIES, 'Rings');

export function frameProps(id: string | null | undefined, decor?: Decor | null): { fam?: string; style?: Record<string, string> } {
  const g = parse(id, 'fr');
  if (!g) return {};
  const pal = paletteOf(g.pal);
  return { fam: g.fam, style: { '--fa': decor?.frame?.[0] ?? pal[0], '--fb': decor?.frame?.[1] ?? pal[1] } };
}

// ── Avatar shapes ───────────────────────────────────────────────────────────────────────────
type Pt = [number, number];
const polygon = (pts: Pt[]) => `polygon(${pts.map(([x, y]) => `${(x * 50 + 50).toFixed(1)}% ${(y * 50 + 50).toFixed(1)}%`).join(', ')})`;
const polar = (n: number, r: (t: number, i: number) => number, rot = -Math.PI / 2): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const t = rot + (i / n) * Math.PI * 2;
    const rr = r(t, i);
    return [Math.cos(t) * rr, Math.sin(t) * rr];
  });

export interface ShapeDef {
  id: string;
  label: string;
  group: string;
  clip?: string;
  radius?: string;
}

function buildShapes(): ShapeDef[] {
  const out: ShapeDef[] = [];
  const names = ['', '', '', 'Triangle', 'Diamond', 'Pentagon', 'Hexagon', 'Heptagon', 'Octagon', 'Nonagon', 'Decagon', 'Hendecagon', 'Dodecagon'];
  for (const n of [3, 4, 5, 6, 8]) out.push({ id: `sh-poly-${n}`, label: names[n]!, group: 'Polygons', clip: polygon(polar(n, () => 1, n % 2 ? -Math.PI / 2 : -Math.PI / 2 + Math.PI / n)) });
  for (const [n, d] of [
    [4, 0.45],
    [5, 0.45],
    [6, 0.6],
    [8, 0.75],
  ] as const)
    out.push({ id: `sh-star-${n}-${Math.round(d * 100)}`, label: `${n}-point star`, group: 'Stars', clip: polygon(polar(n * 2, (_, i) => (i % 2 ? d : 1))) });
  for (const r of [13, 33]) out.push({ id: `sh-round-${r}`, label: `Rounded ${r}%`, group: 'Rounded', radius: `${r}%` });
  for (const n of [5, 8]) out.push({ id: `sh-flower-${n}`, label: `${n}-petal flower`, group: 'Flowers', clip: polygon(polar(120, (t) => 0.8 + 0.2 * Math.cos(n * (t + Math.PI / 2)))) });
  for (const n of [10]) out.push({ id: `sh-gear-${n}`, label: `${n}-tooth gear`, group: 'Gears', clip: polygon(polar(n * 4, (_, i) => (i % 4 < 2 ? 1 : 0.84))) });
  for (const n of [12]) out.push({ id: `sh-scallop-${n}`, label: `Scallop ${n}`, group: 'Scallops', clip: polygon(polar(140, (t) => 0.93 + 0.07 * Math.abs(Math.cos((n / 2) * t)))) });
  const blobs = [
    '60% 40% 30% 70% / 60% 30% 70% 40%', '30% 70% 70% 30% / 30% 30% 70% 70%', '50% 50% 20% 80% / 25% 80% 20% 75%', '67% 33% 47% 53% / 37% 20% 80% 63%',
    '39% 61% 54% 46% / 45% 37% 63% 55%', '73% 27% 26% 74% / 52% 64% 36% 48%', '45% 55% 62% 38% / 53% 51% 49% 47%', '58% 42% 75% 25% / 76% 46% 54% 24%',
    '32% 68% 39% 61% / 61% 42% 58% 39%', '70% 30% 52% 48% / 33% 60% 40% 67%', '41% 59% 28% 72% / 70% 31% 69% 30%', '64% 36% 64% 36% / 45% 55% 45% 55%',
    '25% 75% 70% 30% / 60% 45% 55% 40%', '80% 20% 55% 45% / 50% 70% 30% 50%', '48% 52% 33% 67% / 38% 68% 32% 62%', '55% 45% 40% 60% / 70% 60% 40% 30%',
  ];
  blobs.slice(0, 4).forEach((b, i) => out.push({ id: `sh-blob-${i + 1}`, label: `Blob ${i + 1}`, group: 'Blobs', radius: b }));
  const misc: [string, string, Pt[]][] = [
    ['heart', 'Heart', Array.from({ length: 120 }, (_, i) => { const t = (i / 120) * Math.PI * 2; const x = 16 * Math.sin(t) ** 3; const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)); return [x / 17, y / 17 + 0.08] as Pt; })],
    ['shield', 'Shield', [[-0.9, -0.85], [0, -1], [0.9, -0.85], [0.85, 0.15], [0, 1], [-0.85, 0.15]]],
    ['kite', 'Kite', [[0, -1], [0.75, -0.2], [0, 1], [-0.75, -0.2]]],
    ['drop', 'Drop', [[0, -1], ...Array.from({ length: 40 }, (_, i) => { const t = -Math.PI * 0.2 + (i / 39) * Math.PI * 1.4; return [Math.cos(t) * 0.72, 0.25 + Math.sin(t) * 0.72] as Pt; })]],
    ['arch', 'Arch', [[-1, 1], [-1, 0], ...Array.from({ length: 30 }, (_, i) => { const t = Math.PI + (i / 29) * Math.PI; return [Math.cos(t), Math.sin(t)] as Pt; }), [1, 0], [1, 1]]],
    ['ticket', 'Ticket', [[-1, -0.7], [1, -0.7], [1, -0.15], [0.85, 0], [1, 0.15], [1, 0.7], [-1, 0.7], [-1, 0.15], [-0.85, 0], [-1, -0.15]]],
    ['cross', 'Cross', [[-0.35, -1], [0.35, -1], [0.35, -0.35], [1, -0.35], [1, 0.35], [0.35, 0.35], [0.35, 1], [-0.35, 1], [-0.35, 0.35], [-1, 0.35], [-1, -0.35], [-0.35, -0.35]]],
    ['octocut', 'Cut corners', [[-0.6, -1], [0.6, -1], [1, -0.6], [1, 0.6], [0.6, 1], [-0.6, 1], [-1, 0.6], [-1, -0.6]]],
    ['bolt', 'Bolt', [[0.2, -1], [-0.6, 0.15], [-0.05, 0.15], [-0.25, 1], [0.6, -0.2], [0.05, -0.2]]],
    ['chevron', 'Chevron', [[-1, -1], [0, -0.4], [1, -1], [1, 0.4], [0, 1], [-1, 0.4]]],
    ['parallelogram', 'Slant', [[-0.6, -0.9], [1, -0.9], [0.6, 0.9], [-1, 0.9]]],
    ['badge', 'Badge', polar(24, (_, i) => (i % 2 ? 0.88 : 1))],
    ['moon', 'Crescent', [...Array.from({ length: 40 }, (_, i) => { const t = -Math.PI / 2 + (i / 39) * Math.PI * 2 * 0.75; return [Math.cos(t), Math.sin(t)] as Pt; }), ...Array.from({ length: 30 }, (_, i) => { const t = Math.PI * 0.75 - (i / 29) * Math.PI * 1.25; return [0.35 + Math.cos(t) * 0.75, -0.1 + Math.sin(t) * 0.75] as Pt; })]],
  ];
  for (const [id, label, pts] of misc) out.push({ id: `sh-${id}`, label, group: 'Special', clip: polygon(pts) });
  return out;
}
export const GEN_SHAPES = buildShapes();
const SHAPE_BY_ID = new Map(GEN_SHAPES.map((s) => [s.id, s]));
/** Shapes by id, including parametric ones from 1.4.0 that are no longer listed (still render). */
export function shapeDef(id: string | null | undefined): ShapeDef | undefined {
  if (!id) return undefined;
  const hit = SHAPE_BY_ID.get(id);
  if (hit) return hit;
  let m: RegExpExecArray | null;
  if ((m = /^sh-poly-(\d+)$/.exec(id))) {
    const n = +m[1]!;
    return { id, label: id, group: '', clip: polygon(polar(n, () => 1, n % 2 ? -Math.PI / 2 : -Math.PI / 2 + Math.PI / n)) };
  }
  if ((m = /^sh-star-(\d+)-(\d+)$/.exec(id))) {
    const n = +m[1]!;
    const d = +m[2]! / 100;
    return { id, label: id, group: '', clip: polygon(polar(n * 2, (_, i) => (i % 2 ? d : 1))) };
  }
  if ((m = /^sh-round-(\d+)$/.exec(id))) return { id, label: id, group: '', radius: `${m[1]}%` };
  if ((m = /^sh-flower-(\d+)$/.exec(id))) {
    const n = +m[1]!;
    return { id, label: id, group: '', clip: polygon(polar(120, (t) => 0.8 + 0.2 * Math.cos(n * (t + Math.PI / 2)))) };
  }
  if ((m = /^sh-gear-(\d+)$/.exec(id))) return { id, label: id, group: '', clip: polygon(polar(+m[1]! * 4, (_, i) => (i % 4 < 2 ? 1 : 0.84))) };
  if ((m = /^sh-scallop-(\d+)$/.exec(id))) {
    const n = +m[1]!;
    return { id, label: id, group: '', clip: polygon(polar(140, (t) => 0.93 + 0.07 * Math.abs(Math.cos((n / 2) * t)))) };
  }
  return undefined;
}

// ── Banner colours (primary + accent pairs) ─────────────────────────────────────────────────
export const BANNER_PRESETS: { id: string; label: string; primary: string; accent: string }[] = [
  ['Midnight', '#151a3a', '#7c5cff'], ['Sunset', '#5c1a3a', '#ff8a4c'], ['Ocean', '#0b2a4a', '#00d4ff'], ['Forest', '#123524', '#3ddc84'],
  ['Rose', '#4a1030', '#ff6fb5'], ['Ember', '#3a1408', '#ff512f'], ['Ice', '#1b2c40', '#a1c4fd'], ['Gold', '#2e2208', '#f7d774'],
  ['Mono', '#151515', '#cfcfcf'], ['Toxic', '#102010', '#b6ff00'], ['Lavender', '#2a1f45', '#c7a6ff'], ['Cherry', '#3d0a14', '#ff3d6b'],
  ['Teal', '#06302e', '#2ee6d6'], ['Peach', '#45281c', '#ffb38a'], ['Storm', '#1c2230', '#8aa2c8'], ['Candy', '#3a1640', '#ff9be8'],
].map(([label, primary, accent]) => ({ id: label!.toLowerCase(), label: label!, primary: primary!, accent: accent! }));

// ── Profile effects ─────────────────────────────────────────────────────────────────────────
export type Motion = 'fall' | 'rise' | 'twinkle' | 'wander' | 'drift';
export interface EffectDef {
  glyphs: string[];
  count: number;
  motion: Motion;
  size: [number, number];
  /** Keep glyphs pointing along the fall angle (rain, streaks) instead of tumbling. */
  aligned?: boolean;
  colors?: string[];
}
const GLYPHS: [string, string, string[], [number, number], boolean?][] = [
  ['spark', 'Sparkles', ['✦', '✧', '⋆'], [8, 16]],
  ['star', 'Stars', ['★', '☆', '✶'], [8, 16]],
  ['heart', 'Hearts', ['♥', '❥', '♡'], [10, 18]],
  ['petal', 'Petals', ['❀', '✿', '❁'], [10, 18]],
  ['flake', 'Snowflakes', ['❄', '❅', '❆'], [8, 16]],
  ['note', 'Notes', ['♪', '♫', '♬'], [10, 18]],
  ['orb', 'Orbs', ['●', '•'], [4, 9]],
  ['gem', 'Gems', ['◆', '◇', '⬥'], [7, 13]],
  ['square', 'Pixels', ['■', '▪'], [4, 9]],
  ['moon', 'Moons', ['☾', '☽'], [10, 16]],
  ['bubble', 'Bubbles', ['○', '◯', '◦'], [8, 20]],
  ['streak', 'Streaks', ['│'], [12, 22], true],
  ['cross', 'Crosses', ['✚', '✛', '+'], [8, 14]],
  ['tri', 'Triangles', ['▲', '△', '▴'], [6, 12]],
  ['ring', 'Rings', ['◎', '○'], [8, 14]],
  ['flower', 'Blossoms', ['✾', '❃', '✽'], [10, 16]],
  ['dash', 'Dashes', ['—', '–'], [10, 18], true],
  ['zap', 'Zaps', ['ϟ', '⚡︎'], [12, 22]],
  ['sun', 'Suns', ['☀︎', '✺', '✹'], [10, 16]],
  ['clover', 'Clovers', ['☘︎', '♣'], [10, 16]],
];
const MOTIONS: [Motion, string][] = [
  ['fall', 'Fall'],
  ['drift', 'Drift'],
  ['rise', 'Rise'],
  ['twinkle', 'Twinkle'],
  ['wander', 'Wander'],
];
export const GEN_EFFECTS: Option[] = GLYPHS.map(([g, gl]) => ({ id: `ef-${g}`, label: gl, group: 'Particles' }));
export const EFFECT_MOTIONS = MOTIONS;
export function effectDef(id: string, motionOverride?: Motion): EffectDef | null {
  const m = /^ef-([a-z]+)(?:-([a-z]+))?$/.exec(id);
  const g = m && GLYPHS.find((x) => x[0] === m[1]);
  if (!m || !g) return null;
  const motion = (motionOverride ?? m[2] ?? (g[4] ? 'fall' : 'drift')) as Motion;
  return { glyphs: g[2], count: motion === 'twinkle' ? 14 : motion === 'wander' ? 12 : 18, motion, size: g[3], aligned: g[4] };
}

// ── Profile frames (around the whole card) ──────────────────────────────────────────────────
const CARD_FRAME_FAMILIES: [string, string][] = [
  ['glow', 'Inner Glow'],
  ['double', 'Double Line'],
  ['dashed', 'Dashed'],
  ['gradient', 'Gradient Edge'],
  ['spin', 'Spinning Edge'],
  ['corners', 'Corners'],
  ['neon', 'Neon Pulse'],
  ['stitch', 'Stitched'],
  ['deco', 'Art Deco'],
  ['pixel', 'Pixel'],
];
export const GEN_CARD_FRAMES = styles('cf', CARD_FRAME_FAMILIES, 'Borders');
export function cardFrameProps(id: string | null | undefined, decor?: Decor | null, accent?: string): { 'data-cardframe': string; 'data-cfs'?: string; style?: Record<string, string> } {
  const g = parse(id, 'cf');
  if (id === 'roses' || id === 'crimson-roses') {
    const color = decor?.cardFrame ?? (id === 'crimson-roses' ? '#b3123a' : '#f4f4fb');
    return { 'data-cardframe': 'roses', style: { '--rose-custom': `url("${roseSvg(color)}")` } };
  }
  const art = id?.startsWith('ca-') ? cardArtStyle(id, decor?.cardFrame ? [decor.cardFrame, decor.cardFrame2 ?? decor.cardFrame] : null) : null;
  if (art) return { 'data-cardframe': id!, 'data-cfs': 'art', style: art };
  if (!g) return { 'data-cardframe': id || 'none' };
  const pal = paletteOf(g.pal);
  return { 'data-cardframe': id!, 'data-cfs': g.fam, style: { '--cfa': decor?.cardFrame ?? pal[0], '--cfb': pal[1] ?? accent ?? pal[0] } };
}
/** A rose in any colour (petals in the colour, darker outline). */
export function roseSvg(color: string): string {
  const dark = shade(color, -0.45);
  const light = shade(color, 0.25);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><g stroke='${dark}' stroke-width='.8' fill='${color}'><circle cx='20' cy='20' r='13'/><path d='M20 9c6 0 10 5 9 10M11 16c1-5 6-8 11-7M12 27c-4-3-4-9-1-12M28 28c-4 3-10 3-13 0M29 17c2 5 0 10-4 12' fill='none'/><circle cx='20' cy='20' r='5' fill='${light}'/><path d='M17 20c0-2 2-3 3-3s3 1 3 3' fill='none'/></g><path d='M6 34c3-4 7-5 10-4-3 2-6 4-10 4zM34 6c-4 3-5 7-4 10 2-3 4-6 4-10z' fill='#7c8c74'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt));
  return `#${ch.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

// ── Name effects (fill × treatment) ─────────────────────────────────────────────────────────
const FILLS: [string, string][] = [
  ['solid', 'Solid'],
  ['grad', 'Gradient'],
  ['vgrad', 'Vertical'],
  ['flow', 'Flowing'],
  ['shine', 'Shine'],
  ['rainbow', 'Rainbow'],
  ['metal', 'Metallic'],
  ['split', 'Split'],
  ['fade', 'Fade'],
  ['duo', 'Duotone'],
];
const TREATMENTS: [string, string][] = [
  ['plain', 'Clean'],
  ['soft', 'Soft Glow'],
  ['bright', 'Bright Glow'],
  ['outline', 'Outline'],
  ['shadow', 'Shadow'],
  ['lift', '3D'],
  ['echo', 'Echo'],
  ['pulse', 'Pulse'],
  ['flicker', 'Flicker'],
  ['emboss', 'Emboss'],
];
export const NAME_FILLS = FILLS;
export const NAME_FINISHES = TREATMENTS;
export const GEN_NAME_EFFECTS: Option[] = FILLS.flatMap(([f, fl]) => TREATMENTS.map(([t, tl]) => ({ id: `fx-${f}-${t}`, label: `${fl} · ${tl}`, group: fl })));
export function nameEffectAttrs(id: string | null | undefined): { fill?: string; tr?: string } {
  const m = id ? /^fx-([a-z]+)-([a-z]+)$/.exec(id) : null;
  return m ? { fill: m[1], tr: m[2] } : {};
}

// ── Profile themes (card backgrounds) ───────────────────────────────────────────────────────
const THEME_PATTERNS: [string, string][] = [
  ['linear', 'Linear'],
  ['radial', 'Radial'],
  ['conic', 'Conic'],
  ['split', 'Split'],
  ['mesh', 'Mesh'],
  ['dots', 'Dots'],
  ['grid', 'Grid'],
  ['stripes', 'Stripes'],
  ['checker', 'Checker'],
  ['rings', 'Rings'],
  ['glass', 'Glass'],
  ['aurora', 'Aurora'],
  ['holo', 'Holo'],
  ['spot', 'Spotlight'],
  ['vignette', 'Vignette'],
  ['diagonal', 'Pinstripe'],
  ['zigzag', 'Zigzag'],
  ['waves', 'Waves'],
  ['duo', 'Duo Fade'],
  ['ink', 'Ink'],
];
export const GEN_THEMES: Option[] = THEME_PATTERNS.map(([p, pl]) => ({ id: `th-${p}`, label: pl, group: 'Patterns' }));
export function themeAttrs(id: string | null | undefined, decor?: Decor | null): { pattern?: string; v?: number } {
  const m = id ? /^th-([a-z]+)(?:-([1-5]))?$/.exec(id) : null;
  return m ? { pattern: m[1], v: decor?.themeV ?? (m[2] ? Number(m[2]) : 3) } : {};
}

// ── Name fonts (100, bundled and loaded on demand) ──────────────────────────────────────────
export { NAME_FONTS, loadNameFont, nameFontFamily } from './nameFonts';

import { NAME_FONTS as _FONTS } from './nameFonts';
/** Every generated cosmetic's label by id (for captions like "Nameplate: Sheen · Violet"). */
export const ALL_COSMETICS = new Map<string, string>(
  [...AVATAR_DECOS, ...CARD_ARTS, ...GEN_NAMEPLATES, ...GEN_AVATAR_FRAMES, ...GEN_SHAPES, ...GEN_EFFECTS, ...GEN_CARD_FRAMES, ...GEN_NAME_EFFECTS, ...GEN_THEMES, ..._FONTS].map((o) => [o.id, o.label] as [string, string]),
);

export const groupsOf = (opts: Option[]) => [...new Set(opts.map((o) => o.group))];
export { cap };
