/** Attributes and CSS variables for a profile card's theme and frame (see lib/cosmetics.ts). */
import { cardFrameProps, themeAttrs, type Decor } from './cosmetics';

interface CardProfile {
  card_style?: string | null;
  card_frame?: string | null;
  accent_color?: string | null;
  decor?: Decor | null;
}

/** data-cardframe (+ data-cfs for generated frames). */
export function cardFrameAttrs(p: CardProfile): { 'data-cardframe': string; 'data-cfs'?: string } {
  const f = cardFrameProps(p.card_frame, p.decor, p.accent_color ?? undefined);
  return { 'data-cardframe': f['data-cardframe'], ...(f['data-cfs'] ? { 'data-cfs': f['data-cfs'] } : {}) };
}

/** CSS variables for generated themes and frames (merged into the card's style). */
export function cardVars(p: CardProfile): Record<string, string> {
  const f = cardFrameProps(p.card_frame, p.decor, p.accent_color ?? undefined);
  const t = themeAttrs(p.card_style, p.decor);
  return { ...(f.style ?? {}), ...(t.v ? { '--ctv': String(t.v) } : {}) };
}

// ── Readable text on light profile cards ────────────────────────────────────────────────────
// Profile themes paint the card from the person's colours (or, like Ink, on cream paper). With
// white or pastel colours some come out light, where the app's light-on-dark text is unreadable.
// Estimate the card's main background colour from each theme's recipe and flag light ones; the
// card then switches to dark text (see `.ae-card[data-light]` in cosmetics.css).

type Rgb = [number, number, number];
const hex = (h: string | null | undefined, fallback: Rgb): Rgb => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h ?? '');
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: Rgb, b: Rgb, pctA: number): Rgb => a.map((v, i) => v * pctA + b[i]! * (1 - pctA)) as Rgb;
const luminance = ([r, g, b]: Rgb) => {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const DARK: Rgb = [12, 12, 19];

/** True when a profile card's background is light enough that dark text reads better. */
export function cardIsLight(p: { card_style?: string | null; primary_color?: string | null; accent_color?: string | null; decor?: Decor | null }): boolean {
  const a = hex(p.primary_color, [124, 92, 255]);
  const b = hex(p.accent_color, a);
  const avg = mix(a, b, 0.5);
  const m = /^th-([a-z]+)(?:-([1-5]))?$/.exec(p.card_style ?? '');
  let bg: Rgb;
  if (m) {
    const v = p.decor?.themeV ?? (m[2] ? Number(m[2]) : 3);
    const share: Record<string, [Rgb, number]> = {
      linear: [avg, 0.1 + v * 0.09],
      radial: [a, 0.1 + v * 0.09],
      conic: [avg, 0.45],
      split: [avg, 0.35],
      mesh: [avg, 0.35],
      dots: [a, 0.24],
      grid: [a, 0.24],
      stripes: [avg, 0.26],
      checker: [avg, 0.26],
      rings: [avg, 0.27],
      waves: [avg, 0.25],
      glass: [avg, 0.2],
      aurora: [avg, 0.4],
      holo: [mix(avg, [180, 200, 240], 0.5), 0.6],
      spot: [mix(a, b, 0.6), 0.25],
      vignette: [a, 0.3],
      diagonal: [a, 0.24],
      zigzag: [a, 0.14 + v * 0.06],
      duo: [avg, 0.2 + v * 0.09],
    };
    if (m[1] === 'ink') return true; // cream paper
    const [col, pct] = share[m[1]!] ?? [avg, 0.25];
    bg = mix(col, DARK, Math.min(pct, 1));
  } else {
    // Classic styles are dark (midnight, noir, sunset, ocean…); the plain card is the theme
    // background with a wash of the primary colour at the top.
    bg = mix(a, DARK, p.card_style === 'mesh' ? 0.45 : 0.26);
  }
  // Above about 0.18, black text has more contrast than white.
  return luminance(bg) > 0.18;
}
