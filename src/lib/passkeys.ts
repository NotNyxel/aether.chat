/**
 * Passkeys (Face ID, Touch ID, Windows Hello, a phone or a security key) for signing in. Browsers
 * tie a passkey to one website, and ours is registered for the web app's address, so they only work
 * there. The desktop and phone apps run on their own internal address and can't use them.
 */
import { WEB_APP_URL } from '../config';
import { isTauri } from './platform';

export const passkeysHere = (): boolean => {
  if (isTauri || typeof window === 'undefined' || !('PublicKeyCredential' in window)) return false;
  try {
    return window.location.origin === new URL(WEB_APP_URL).origin;
  } catch {
    return false;
  }
};

export const WEB_APP_HOST = new URL(WEB_APP_URL).host;

/** A friendly message for the errors browsers throw when the person cancels the prompt. */
export function passkeyError(err: unknown): string {
  const e = err as { name?: string; code?: string; message?: string } | null;
  if (e?.name === 'NotAllowedError' || e?.code === 'ERROR_CEREMONY_ABORTED' || /not allowed|cancel|abort/i.test(e?.message ?? '')) return 'The passkey prompt was closed.';
  return e?.message ?? 'Something went wrong with the passkey.';
}
