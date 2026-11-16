/**
 * Error tracking (2.0), in our own Supabase: crashes and unexpected errors are grouped by a
 * fingerprint and counted per app version, so staff can see what's breaking (Admin → Errors).
 * Sends only the error text, a trimmed stack, the app version, platform and screen name: never
 * message contents. Each kind of error is sent at most once per session, 20 in total.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isTauri } from './platform';

const sent = new Set<string>();
let total = 0;
let client: SupabaseClient | null = null;
let installed = false;

/** Errors that aren't bugs in Aether: the network, the browser, extensions. */
const NOISE = [
  /ResizeObserver loop/i,
  /failed to fetch|networkerror|load failed|network request failed|the network connection was lost/i,
  /AbortError|The user aborted|signal is aborted/i,
  /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i,
  /chrome-extension:|moz-extension:|safari-extension:/i,
  /NotAllowedError|Permission denied by system|The request is not allowed by the user agent/i,
  /JWT expired|refresh token/i,
];

export function platformLabel(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'windows' : /iPhone|iPad/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : /Mac/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : 'other';
  const shell = isTauri ? 'app' : '__TAURI_INTERNALS__' in window ? 'app' : 'web';
  return `${os}-${shell}`;
}

/** The screen someone was on, as a short label (no ids). */
let pageLabel = () => 'unknown';
export function setPageLabel(fn: () => string) {
  pageLabel = fn;
}

/** Stack lines without the build hash or line numbers, so the same bug groups across builds. */
function cleanStack(stack: string | undefined): string {
  return (stack ?? '')
    .split('\n')
    .slice(0, 12)
    .map((l) => l.replace(/https?:\/\/[^\s)]+\/(assets\/)?/g, '').replace(/-[A-Za-z0-9_]{8}\.js/g, '.js').trim())
    .join('\n')
    .slice(0, 4000);
}

async function fingerprint(message: string, stack: string): Promise<string> {
  const firstFrame = stack.split('\n').find((l) => /\bat\b|@/.test(l))?.replace(/:\d+:\d+\)?$/, '') ?? '';
  const text = `${message.replace(/\d+/g, '#').slice(0, 200)}|${firstFrame}`;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return text.slice(0, 64);
  }
}

export function reportError(err: unknown, where?: string): void {
  if (!client || total >= 20) return;
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err ?? 'unknown'));
  const message = `${e.name && e.name !== 'Error' ? `${e.name}: ` : ''}${e.message || 'Unknown error'}`.slice(0, 500);
  if (NOISE.some((r) => r.test(message) || r.test(e.stack ?? ''))) return;
  const stack = cleanStack(e.stack);
  const c = client;
  void fingerprint(message, stack).then((fp) => {
    if (sent.has(fp)) return;
    sent.add(fp);
    total++;
    void c
      .rpc('log_client_error', {
        p_fingerprint: fp,
        p_message: message,
        p_stack: stack || null,
        p_version: __APP_VERSION__,
        p_platform: platformLabel(),
        p_page: (where ?? pageLabel()).slice(0, 200),
      })
      .then(() => undefined);
  });
}

/** Called once a user is signed in (errors are only accepted from signed-in users). */
export function installErrorTracking(sb: SupabaseClient): void {
  client = sb;
  if (installed) return;
  installed = true;
  window.addEventListener('error', (ev) => {
    // Failed <img>/<script> loads also fire "error" without an Error object: not a code bug.
    if (!ev.error && !ev.message) return;
    reportError(ev.error ?? new Error(ev.message));
  });
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason));
}
