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
  const t = themeAttrs(p.card_style);
  return { ...(f.style ?? {}), ...(t.v ? { '--ctv': String(t.v) } : {}) };
}
