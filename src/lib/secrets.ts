/**
 * Secret codes (2.1): typing a code in Settings → Appearance unlocks a hidden theme. Only a
 * fingerprint (SHA-256) of each code is in the app, so reading the source doesn't give them away.
 * Codes ignore case, spaces and dashes ("goblin mode" = "GOBLIN-MODE").
 */
import type { ThemePresetId } from '../theme/presets';

const SALT = 'aether-secret:';

/** Fingerprint of a code → the theme it unlocks. */
const CODES: Record<string, ThemePresetId> = {
  '9506ac97953c444d9e7a7372a90c380e741a62594d395cd56af1c39c0dbb1f5a': 'secret-goblin',
  '760803c0c6599cb9ba839e66d73726ce64f7466f66b92f9fb694165ed5ba4272': 'secret-arcade',
  cddf33cd0124f8b61a42e909106cfc37cb775dc286a0e4af95fd1a65e7a38cfe: 'secret-hackerman',
  '3d59b39c05155806265b7f20728d1c964af6e012e9adc19a75778ccae93a1b0d': 'secret-disco',
  '91d558eb52180459b4714f671cc619edae77bb6cc8aa77540912556f7e66cf57': 'secret-deepfried',
};

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s_-]+/g, '');

/** The theme a code unlocks, or null for a wrong code. */
export async function redeemCode(code: string): Promise<ThemePresetId | null> {
  const clean = normalizeCode(code);
  if (clean.length < 3 || clean.length > 40) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SALT + clean));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return CODES[hex] ?? null;
}
