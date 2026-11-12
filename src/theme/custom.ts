/** Custom theme helpers (no React). */
import type { CustomTheme } from '../stores/settingsStore';

/** The gradient a custom theme paints behind the app. */
export function customBackdrop(c: CustomTheme): string {
  const base = c.mode === 'light' ? '#f4f4f7' : '#07070b';
  const share = Math.round(12 + c.intensity * 0.68);
  const stops = (c.colors.length ? c.colors : ['#7c5cff']).map((col) => `color-mix(in oklab, ${col} ${share}%, ${base})`);
  if (stops.length === 1) stops.push(stops[0]!);
  return `linear-gradient(${c.angle}deg, ${stops.join(', ')})`;
}
