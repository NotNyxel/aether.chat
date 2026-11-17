/**
 * Moments studio engine (2.3): the things you can add to a moment, laid out once and drawn the same
 * way on screen (DOM) and into the final 1080×1920 image (canvas), so what you see is what posts.
 *
 * Everything is in "stage pixels" (1080 wide, 1920 tall); the editor scales by stage width / 1080.
 */
import type { CSSProperties } from 'react';
import { emojiUrl } from './twemoji';

export const STAGE_W = 1080;
export const STAGE_H = 1920;

// ── Fonts ─────────────────────────────────────────────────────────────────────────────────────

export const FONTS = {
  sans: "'Plus Jakarta Sans Variable', system-ui, sans-serif",
  bebas: "'Bebas Neue', Impact, sans-serif",
  marker: "'Permanent Marker', 'Comic Sans MS', cursive",
  script: "'Dancing Script Variable', cursive",
  hand: "'Caveat Variable', cursive",
  pacifico: "'Pacifico', cursive",
  serif: "'Abril Fatface', Georgia, serif",
  pixel: "'Press Start 2P', monospace",
  retro: "'Monoton', cursive",
  bungee: "'Bungee', Impact, sans-serif",
  type: "'Special Elite', 'Courier New', monospace",
} as const;
export type FontId = keyof typeof FONTS;

/** Make sure a font is ready before measuring or drawing with it. */
export async function loadFonts(specs: string[]) {
  if (!('fonts' in document)) return;
  await Promise.all(specs.map((s) => document.fonts.load(s).catch(() => undefined)));
}

// ── Text styles (tap "Aa" to cycle) ───────────────────────────────────────────────────────────

export interface TextLook {
  font: FontId;
  weight: number;
  size: number;
  /** Fill comes from the chosen colour unless fixed here. */
  fill?: string;
  stroke?: { color: string; width: number };
  glow?: number;
  shadow?: boolean;
  /** A box behind the text: colour, corner radius, padding. "inverse" = the chosen colour, text dark. */
  box?: { color: string; radius: number; pad: number; inverse?: boolean };
  upper?: boolean;
  lineHeight: number;
}

export const TEXT_STYLES: { id: string; label: string; look: TextLook }[] = [
  { id: 'classic', label: 'Classic', look: { font: 'sans', weight: 600, size: 54, box: { color: 'rgba(0,0,0,0.55)', radius: 18, pad: 22 }, lineHeight: 1.25 } },
  { id: 'big', label: 'Big', look: { font: 'sans', weight: 800, size: 104, shadow: true, lineHeight: 1.08 } },
  { id: 'outline', label: 'Outline', look: { font: 'bungee', weight: 400, size: 88, stroke: { color: '#000', width: 14 }, lineHeight: 1.12, upper: true } },
  { id: 'neon', label: 'Neon', look: { font: 'pacifico', weight: 400, size: 92, glow: 36, lineHeight: 1.3 } },
  { id: 'label', label: 'Label', look: { font: 'type', weight: 400, size: 58, box: { color: '#ffffff', radius: 6, pad: 22, inverse: true }, lineHeight: 1.25 } },
  { id: 'marker', label: 'Marker', look: { font: 'marker', weight: 400, size: 84, shadow: true, lineHeight: 1.15 } },
  { id: 'script', label: 'Script', look: { font: 'script', weight: 700, size: 100, shadow: true, lineHeight: 1.15 } },
  { id: 'poster', label: 'Poster', look: { font: 'bebas', weight: 400, size: 130, shadow: true, lineHeight: 1, upper: true } },
];

export const TEXT_COLORS = ['#ffffff', '#111111', '#ff4d6d', '#ff9f1c', '#ffe14d', '#3ddc84', '#22d3ee', '#4f7dff', '#a855f7', '#ff6fd8'];

const fontSpec = (l: TextLook, scale = 1) => `${l.weight} ${l.size * scale}px ${FONTS[l.font]}`;

let measurer: CanvasRenderingContext2D | null = null;
function measureCtx() {
  measurer ??= document.createElement('canvas').getContext('2d')!;
  return measurer;
}

/** Wrap text to a width (in stage px). The same lines are used on screen and in the image. */
export function layoutText(text: string, look: TextLook, maxWidth = 920): { lines: string[]; width: number; height: number } {
  const ctx = measureCtx();
  ctx.font = fontSpec(look);
  const src = look.upper ? text.toUpperCase() : text;
  const lines: string[] = [];
  for (const para of src.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && ctx.measureText(next.trimEnd()).width > maxWidth) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    lines.push(line.trimEnd());
  }
  const width = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const pad = look.box?.pad ?? 0;
  return { lines, width: width + pad * 2, height: lines.length * look.size * look.lineHeight + pad * 2 };
}

// ── Templates that change look every day ──────────────────────────────────────────────────────

export interface Run {
  text: string;
  font: FontId;
  weight: number;
  size: number;
  color: string;
  /** Vertical position of this line's centre, relative to the block's centre. */
  dy: number;
  stroke?: { color: string; width: number };
  glow?: string;
}
export interface Block {
  runs: Run[];
  width: number;
  height: number;
  bg?: { color: string; radius: number };
}

interface Design {
  name: string;
  big: FontId;
  bigWeight: number;
  small: FontId;
  ink: string;
  accent: string;
  bg?: string;
  glow?: boolean;
  stroke?: string;
}
const DESIGNS: Design[] = [
  { name: 'Bold', big: 'bebas', bigWeight: 400, small: 'sans', ink: '#ffffff', accent: '#ffe14d' },
  { name: 'Script', big: 'script', bigWeight: 700, small: 'sans', ink: '#ffffff', accent: '#ff9fd1' },
  { name: 'Neon', big: 'pacifico', bigWeight: 400, small: 'sans', ink: '#ffffff', accent: '#22d3ee', glow: true },
  { name: 'Sticker', big: 'bungee', bigWeight: 400, small: 'bungee', ink: '#111111', accent: '#111111', bg: '#ffe14d' },
  { name: 'Editorial', big: 'serif', bigWeight: 400, small: 'type', ink: '#ffffff', accent: '#ffb38a' },
  { name: 'Arcade', big: 'pixel', bigWeight: 400, small: 'pixel', ink: '#3ddc84', accent: '#ffffff', bg: 'rgba(0,0,0,0.65)' },
  { name: 'Marker', big: 'marker', bigWeight: 400, small: 'hand', ink: '#ffffff', accent: '#ff4d6d', stroke: '#000000' },
  { name: 'Retro', big: 'retro', bigWeight: 400, small: 'sans', ink: '#ffd166', accent: '#ef476f' },
  { name: 'Note', big: 'hand', bigWeight: 700, small: 'hand', ink: '#1b1b1b', accent: '#6b4cff', bg: '#fffdf2' },
];

export const TEMPLATE_KINDS = [
  { id: 'day', label: 'Day' },
  { id: 'today', label: 'Today' },
  { id: 'date', label: 'Date' },
  { id: 'time', label: 'Time' },
  { id: 'mood', label: 'Mood' },
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]['id'];

const dayIndex = (d: Date) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 86_400_000);

/** Today's design for a template: a different one each day, and each kind looks different too. */
export function templateDesign(kind: TemplateKind, now = new Date(), shuffle = 0): Design {
  const k = TEMPLATE_KINDS.findIndex((t) => t.id === kind);
  return DESIGNS[(((dayIndex(now) * 7 + k * 3 + shuffle) % DESIGNS.length) + DESIGNS.length) % DESIGNS.length]!;
}

const MOODS = ['good vibes only', 'main character energy', 'just a little treat', 'vibing', 'no thoughts, just vibes', 'ok but hear me out'];

/** Build a template block (stage px). */
export function templateBlock(kind: TemplateKind, now = new Date(), shuffle = 0): Block {
  const d = templateDesign(kind, now, shuffle);
  const loc = undefined;
  const weekday = now.toLocaleDateString(loc, { weekday: 'long' });
  const month = now.toLocaleDateString(loc, { month: 'short' });
  const date = now.toLocaleDateString(loc, { day: 'numeric', month: 'long' });
  const time = now.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  const upperBig = d.big === 'bebas' || d.big === 'bungee' || d.big === 'pixel' || d.big === 'retro';
  const big = (text: string, size: number): Run => ({
    text: upperBig ? text.toUpperCase() : text,
    font: d.big,
    weight: d.bigWeight,
    size: d.big === 'pixel' ? size * 0.45 : d.big === 'retro' ? size * 0.75 : size,
    color: d.ink,
    dy: 0,
    stroke: d.stroke ? { color: d.stroke, width: 12 } : undefined,
    glow: d.glow ? d.accent : undefined,
  });
  const small = (text: string, size: number): Run => ({ text, font: d.small, weight: d.small === 'sans' ? 700 : 400, size: d.small === 'pixel' ? size * 0.55 : size, color: d.accent, dy: 0 });
  let runs: Run[];
  switch (kind) {
    case 'day':
      runs = [big(weekday, 150), small(date, 46)];
      break;
    case 'today':
      runs = [big(d.big === 'script' || d.big === 'pacifico' || d.big === 'hand' ? 'today' : 'TODAY', 150), small(`${weekday} · ${date}`, 44)];
      break;
    case 'date':
      runs = [small(month.toUpperCase(), 54), big(String(now.getDate()), 230), small(weekday, 46)];
      break;
    case 'time':
      runs = [big(time, 170), small(weekday, 46)];
      break;
    case 'mood':
      runs = [small(weekday.toLowerCase(), 46), big(MOODS[dayIndex(now) % MOODS.length]!, 92)];
      break;
  }
  return stack(runs, d.bg ? { color: d.bg, radius: 28 } : undefined);
}

/** Stack runs vertically, centre them, and measure the block. */
function stack(runs: Run[], bg?: Block['bg']): Block {
  const ctx = measureCtx();
  const gap = 10;
  const pad = bg ? 44 : 0;
  const maxW = 940 - pad * 2;
  // Shrink any run that's wider than the stage allows.
  for (const r of runs) {
    ctx.font = `${r.weight} ${r.size}px ${FONTS[r.font]}`;
    const w = ctx.measureText(r.text).width;
    if (w > maxW) r.size *= maxW / w;
  }
  const heights = runs.map((r) => r.size * 1.15);
  const total = heights.reduce((a, b) => a + b, 0) + gap * (runs.length - 1);
  let y = -total / 2;
  let width = 0;
  runs.forEach((r, i) => {
    r.dy = y + heights[i]! / 2;
    y += heights[i]! + gap;
    ctx.font = `${r.weight} ${r.size}px ${FONTS[r.font]}`;
    width = Math.max(width, ctx.measureText(r.text).width);
  });
  return { runs, width: width + pad * 2, height: total + pad * 2, bg };
}

export function fontsOfBlock(b: Block) {
  return b.runs.map((r) => `${r.weight} ${r.size}px ${FONTS[r.font]}`);
}

// ── Photo filters as colour matrices (canvas filters don't exist on iPhone Safari) ────────────

export type Matrix = number[]; // 4×5, row-major (r, g, b, a rows; last column is an offset 0..1)
const ID: Matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
function mul(a: Matrix, b: Matrix): Matrix {
  // a ∘ b (apply b, then a)
  const out: number[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? a[r * 5 + 4]! : 0;
      for (let k = 0; k < 4; k++) v += a[r * 5 + k]! * (c === 4 ? b[k * 5 + 4]! : b[k * 5 + c]!);
      out.push(v);
    }
  }
  return out;
}
const saturate = (s: number): Matrix => [
  0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
  0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
  0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
  0, 0, 0, 1, 0,
];
const sepia = (a: number): Matrix => [
  1 - 0.607 * a, 0.769 * a, 0.189 * a, 0, 0,
  0.349 * a, 1 - 0.314 * a, 0.168 * a, 0, 0,
  0.272 * a, 0.534 * a, 1 - 0.869 * a, 0, 0,
  0, 0, 0, 1, 0,
];
const brightness = (b: number): Matrix => [b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
const contrast = (c: number): Matrix => {
  const o = 0.5 - 0.5 * c;
  return [c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0];
};
const hue = (deg: number): Matrix => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0, 0,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ];
};
type Op = ['saturate' | 'sepia' | 'brightness' | 'contrast' | 'grayscale', number] | ['hue', number];
const opMatrix = ([k, v]: Op): Matrix =>
  k === 'saturate' ? saturate(v) : k === 'sepia' ? sepia(v) : k === 'brightness' ? brightness(v) : k === 'contrast' ? contrast(v) : k === 'grayscale' ? saturate(1 - v) : hue(v);

export const PHOTO_FILTERS: { id: string; label: string; ops: Op[] }[] = [
  { id: 'none', label: 'Original', ops: [] },
  { id: 'vivid', label: 'Vivid', ops: [['saturate', 1.45], ['contrast', 1.08]] },
  { id: 'golden', label: 'Golden hour', ops: [['sepia', 0.3], ['saturate', 1.3], ['brightness', 1.05]] },
  { id: 'cool', label: 'Cool', ops: [['hue', 14], ['saturate', 1.1], ['brightness', 1.03]] },
  { id: 'fade', label: 'Fade', ops: [['contrast', 0.82], ['brightness', 1.08], ['saturate', 0.8]] },
  { id: 'mono', label: 'Mono', ops: [['grayscale', 1]] },
  { id: 'noir', label: 'Noir', ops: [['grayscale', 1], ['contrast', 1.45], ['brightness', 0.92]] },
  { id: 'retro', label: 'Retro', ops: [['sepia', 0.55], ['contrast', 1.1], ['saturate', 0.9]] },
  { id: 'dream', label: 'Dream', ops: [['hue', -18], ['saturate', 1.25], ['brightness', 1.1], ['contrast', 0.9]] },
];

/** Does this browser apply ctx.filter? (iPhone/iPad Safari doesn't.) */
let filterWorks: boolean | null = null;
export function canvasFilterWorks(): boolean {
  if (filterWorks !== null) return filterWorks;
  const c = document.createElement('canvas').getContext('2d');
  if (!c || !('filter' in c)) return (filterWorks = false);
  c.filter = 'saturate(2)';
  return (filterWorks = c.filter === 'saturate(2)');
}

/** Apply a CSS filter string (saturate/sepia/brightness/contrast/grayscale/hue-rotate) by hand. */
export function applyCssFilter(ctx: CanvasRenderingContext2D, css: string, w: number, h: number) {
  const ops: Op[] = [];
  for (const m of css.matchAll(/(saturate|sepia|brightness|contrast|grayscale|hue-rotate)\(([-\d.]+)(deg|%)?\)/g)) {
    const v = Number(m[2]) / (m[3] === '%' ? 100 : 1);
    ops.push(m[1] === 'hue-rotate' ? ['hue', v] : [m[1] as 'saturate', v]);
  }
  if (!ops.length) return;
  applyOps(ctx, ops, w, h);
}

/** CSS for the on-screen preview (the browser applies the same matrices). */
export function filterCss(id: string): string {
  const f = PHOTO_FILTERS.find((x) => x.id === id);
  if (!f || !f.ops.length) return 'none';
  return f.ops.map(([k, v]) => (k === 'hue' ? `hue-rotate(${v}deg)` : `${k}(${v})`)).join(' ');
}

/** Apply a filter to a region of a canvas, pixel by pixel (works everywhere). */
export function applyFilter(ctx: CanvasRenderingContext2D, id: string, w: number, h: number) {
  const f = PHOTO_FILTERS.find((x) => x.id === id);
  if (!f || !f.ops.length) return;
  applyOps(ctx, f.ops, w, h);
}

function applyOps(ctx: CanvasRenderingContext2D, ops: Op[], w: number, h: number) {
  // CSS applies left to right: the first op runs first.
  const m = ops.reduce<Matrix>((acc, op) => mul(opMatrix(op), acc), ID);
  const img = ctx.getImageData(0, 0, w, h);
  const p = img.data;
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i]!;
    const g = p[i + 1]!;
    const b = p[i + 2]!;
    p[i] = clamp(m[0]! * r + m[1]! * g + m[2]! * b + m[4]! * 255);
    p[i + 1] = clamp(m[5]! * r + m[6]! * g + m[7]! * b + m[9]! * 255);
    p[i + 2] = clamp(m[10]! * r + m[11]! * g + m[12]! * b + m[14]! * 255);
  }
  ctx.putImageData(img, 0, 0);
}

// ── Elements and drawings ─────────────────────────────────────────────────────────────────────

interface Placed {
  id: string;
  /** Centre, in stage px. */
  x: number;
  y: number;
  scale: number;
  /** Radians. */
  rot: number;
}
export type El =
  | (Placed & { kind: 'text'; text: string; style: string; color: string })
  | (Placed & { kind: 'emoji'; emoji: string })
  | (Placed & { kind: 'sticker'; url: string; w: number; h: number })
  | (Placed & { kind: 'image'; src: string; w: number; h: number; round: boolean })
  | (Placed & { kind: 'template'; template: TemplateKind; shuffle: number; at: number });

export interface Stroke {
  tool: 'pen' | 'highlight' | 'arrow';
  color: string;
  width: number;
  pts: { x: number; y: number }[];
}

export const EMOJI_SIZE = 240;
export const lookOf = (style: string) => (TEXT_STYLES.find((s) => s.id === style) ?? TEXT_STYLES[0]!).look;

/** The element's untransformed box size (stage px), for hit areas and handles. */
export function elSize(el: El): { w: number; h: number } {
  switch (el.kind) {
    case 'text': {
      const t = layoutText(el.text || ' ', lookOf(el.style));
      return { w: t.width, h: t.height };
    }
    case 'emoji':
      return { w: EMOJI_SIZE, h: EMOJI_SIZE };
    case 'sticker':
    case 'image':
      return { w: el.w, h: el.h };
    case 'template': {
      const b = templateBlock(el.template, new Date(el.at), el.shuffle);
      return { w: b.width, h: b.height };
    }
  }
}

// ── Rendering to canvas ───────────────────────────────────────────────────────────────────────

const images = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      if (!src.startsWith('blob:') && !src.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = src;
    });
    images.set(src, p);
    p.catch(() => images.delete(src));
  }
  return p;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  if (!s.pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  if (s.tool === 'highlight') {
    ctx.globalAlpha = 0.4;
    ctx.lineCap = 'square';
  }
  if (s.tool === 'arrow') {
    const a = s.pts[0]!;
    const b = s.pts[s.pts.length - 1]!;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.max(30, s.width * 3.2);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang - 0.5), b.y - head * Math.sin(ang - 0.5));
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang + 0.5), b.y - head * Math.sin(ang + 0.5));
    ctx.stroke();
  } else {
    ctx.beginPath();
    s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0]!.x + 0.1, s.pts[0]!.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTextEl(ctx: CanvasRenderingContext2D, el: Extract<El, { kind: 'text' }>) {
  const look = lookOf(el.style);
  const t = layoutText(el.text, look);
  const pad = look.box?.pad ?? 0;
  if (look.box) {
    ctx.fillStyle = look.box.inverse ? el.color : look.box.color;
    roundRect(ctx, -t.width / 2, -t.height / 2, t.width, t.height, look.box.radius);
    ctx.fill();
  }
  ctx.font = fontSpec(look);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = look.size * look.lineHeight;
  const fill = look.box?.inverse ? (el.color === '#111111' ? '#ffffff' : '#111111') : (look.fill ?? el.color);
  t.lines.forEach((line, i) => {
    const y = -t.height / 2 + pad + lh * i + lh / 2;
    if (look.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = look.stroke.width;
      ctx.strokeStyle = look.stroke.color;
      ctx.strokeText(line, 0, y);
    }
    ctx.save();
    if (look.glow) {
      ctx.shadowColor = el.color;
      ctx.shadowBlur = look.glow;
    } else if (look.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 4;
    }
    ctx.fillStyle = fill;
    ctx.fillText(line, 0, y);
    if (look.glow) ctx.fillText(line, 0, y); // a second pass makes neon glow brighter
    ctx.restore();
  });
}

function drawBlock(ctx: CanvasRenderingContext2D, b: Block) {
  if (b.bg) {
    ctx.fillStyle = b.bg.color;
    roundRect(ctx, -b.width / 2, -b.height / 2, b.width, b.height, b.bg.radius);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const r of b.runs) {
    ctx.font = `${r.weight} ${r.size}px ${FONTS[r.font]}`;
    if (r.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = r.stroke.width;
      ctx.strokeStyle = r.stroke.color;
      ctx.strokeText(r.text, 0, r.dy);
    }
    ctx.save();
    if (r.glow) {
      ctx.shadowColor = r.glow;
      ctx.shadowBlur = 40;
    } else if (!b.bg) {
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 4;
    }
    ctx.fillStyle = r.color;
    ctx.fillText(r.text, 0, r.dy);
    ctx.restore();
  }
}

async function drawEl(ctx: CanvasRenderingContext2D, el: El) {
  ctx.save();
  ctx.translate(el.x, el.y);
  ctx.rotate(el.rot);
  ctx.scale(el.scale, el.scale);
  try {
    if (el.kind === 'text') drawTextEl(ctx, el);
    else if (el.kind === 'template') drawBlock(ctx, templateBlock(el.template, new Date(el.at), el.shuffle));
    else if (el.kind === 'emoji') {
      const img = await loadImage(emojiUrl(el.emoji));
      ctx.drawImage(img, -EMOJI_SIZE / 2, -EMOJI_SIZE / 2, EMOJI_SIZE, EMOJI_SIZE);
    } else {
      const img = await loadImage(el.kind === 'image' ? el.src : el.url);
      if (el.kind === 'image' && el.round) {
        ctx.beginPath();
        ctx.ellipse(0, 0, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
        ctx.clip();
      } else if (el.kind === 'image') {
        roundRect(ctx, -el.w / 2, -el.h / 2, el.w, el.h, 28);
        ctx.clip();
      }
      ctx.drawImage(img, -el.w / 2, -el.h / 2, el.w, el.h);
    }
  } catch {
    // An image that won't load (offline sticker) is left out rather than failing the post.
  }
  ctx.restore();
}

export interface Scene {
  background: { kind: 'color'; css: string; stops: string[] } | { kind: 'photo'; src: string; fit: 'cover' | 'contain' } | { kind: 'video' };
  filter: string;
  strokes: Stroke[];
  elements: El[];
}

/** Every font a scene uses, so they can be loaded before drawing. */
export function sceneFonts(s: Scene): string[] {
  const out = new Set<string>();
  for (const el of s.elements) {
    if (el.kind === 'text') out.add(fontSpec(lookOf(el.style)));
    if (el.kind === 'template') fontsOfBlock(templateBlock(el.template, new Date(el.at), el.shuffle)).forEach((f) => out.add(f));
  }
  return [...out];
}

/**
 * Draw the scene at 1080×1920. Photos/colours give a finished JPEG; a video gives a transparent
 * PNG of just the additions, shown over the video.
 */
export async function renderScene(s: Scene): Promise<Blob> {
  await loadFonts(sceneFonts(s));
  const c = document.createElement('canvas');
  c.width = STAGE_W;
  c.height = STAGE_H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const bg = s.background;
  if (bg.kind === 'color') {
    const g = ctx.createLinearGradient(0, 0, STAGE_W, STAGE_H);
    bg.stops.forEach((col, i) => g.addColorStop(bg.stops.length > 1 ? i / (bg.stops.length - 1) : 0, col));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  } else if (bg.kind === 'photo') {
    const img = await loadImage(bg.src);
    const cover = Math.max(STAGE_W / img.width, STAGE_H / img.height);
    if (bg.fit === 'contain') {
      // A soft blurred copy fills the edges (scaled down and up, since canvas blur isn't everywhere).
      const tiny = document.createElement('canvas');
      tiny.width = 27;
      tiny.height = 48;
      const t = tiny.getContext('2d')!;
      t.drawImage(img, (27 - img.width * Math.max(27 / img.width, 48 / img.height)) / 2, (48 - img.height * Math.max(27 / img.width, 48 / img.height)) / 2, img.width * Math.max(27 / img.width, 48 / img.height), img.height * Math.max(27 / img.width, 48 / img.height));
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tiny, 0, 0, STAGE_W, STAGE_H);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      const k = Math.min(STAGE_W / img.width, STAGE_H / img.height);
      ctx.drawImage(img, (STAGE_W - img.width * k) / 2, (STAGE_H - img.height * k) / 2, img.width * k, img.height * k);
    } else {
      ctx.drawImage(img, (STAGE_W - img.width * cover) / 2, (STAGE_H - img.height * cover) / 2, img.width * cover, img.height * cover);
    }
    applyFilter(ctx, s.filter, STAGE_W, STAGE_H);
  }
  for (const st of s.strokes) drawStroke(ctx, st);
  for (const el of s.elements) await drawEl(ctx, el);
  const video = bg.kind === 'video';
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image.'))), video ? 'image/png' : 'image/jpeg', 0.9));
}

/** CSS used by the editor to show a text element exactly like the canvas will draw it. */
export function textCss(look: TextLook, color: string, k: number): CSSProperties {
  const fill = look.box?.inverse ? (color === '#111111' ? '#ffffff' : '#111111') : (look.fill ?? color);
  return {
    font: fontSpec(look, k),
    lineHeight: `${look.size * look.lineHeight * k}px`,
    color: fill,
    padding: look.box ? look.box.pad * k : 0,
    background: look.box ? (look.box.inverse ? color : look.box.color) : undefined,
    borderRadius: look.box ? look.box.radius * k : undefined,
    WebkitTextStroke: look.stroke ? `${look.stroke.width * k}px ${look.stroke.color}` : undefined,
    paintOrder: look.stroke ? 'stroke fill' : undefined,
    textShadow: look.glow ? `0 0 ${look.glow * k * 0.6}px ${color}, 0 0 ${look.glow * k}px ${color}` : look.shadow ? `0 ${4 * k}px ${18 * k * 0.6}px rgba(0,0,0,0.45)` : undefined,
    whiteSpace: 'pre',
    textAlign: 'center',
  };
}
