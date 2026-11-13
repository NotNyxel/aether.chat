/**
 * Cloudflare Turnstile: the "are you human" check on sign-up, sign-in and password reset. Usually
 * invisible or a single tick. Only shown when TURNSTILE_SITE_KEY is set.
 */
import { useEffect, useRef } from 'react';
import { TURNSTILE_SITE_KEY } from '../config';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the human check.'));
    document.head.appendChild(s);
  });
  return loading;
}

export const captchaEnabled = !!TURNSTILE_SITE_KEY;

/** Renders the check; `onToken` gets a fresh token (or null when it expires). Change `resetKey` to get a new one. */
export function Turnstile({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey?: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  useEffect(() => {
    if (!captchaEnabled) return;
    let gone = false;
    void loadScript().then(() => {
      if (gone || !ref.current || !window.turnstile) return;
      id.current = window.turnstile.render(ref.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: document.documentElement.dataset.aeLight === 'true' ? 'light' : 'dark',
        callback: (t: string) => onToken(t),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    });
    return () => {
      gone = true;
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  if (!captchaEnabled) return null;
  return <div ref={ref} className="flex min-h-[65px] justify-center" />;
}
