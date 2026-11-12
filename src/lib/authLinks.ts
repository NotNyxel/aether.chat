/**
 * Account email links (password reset, sign-up confirmation, email change).
 *
 * Desktop: Supabase redirects the link to aetherchat://auth#access_token=…&type=recovery, Windows
 * opens (or focuses) aether.chat, and we finish signing in here. Web: supabase-js reads the tokens
 * from the page URL by itself (detectSessionInUrl), and we only need to know the link type.
 */
import { openJoinDialog } from './joinBus';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isTauri } from './platform';

export type AuthLinkKind = 'recovery' | 'signup' | 'email_change' | 'magiclink' | 'invite' | 'unknown';

export function authRedirectUrl(): string {
  return isTauri ? 'aetherchat://auth' : window.location.origin;
}

function parse(url: string): { params: URLSearchParams; kind: AuthLinkKind } | null {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.hash.replace(/^#/, ''));
    for (const [k, v] of u.searchParams) if (!params.has(k)) params.set(k, v);
    const type = params.get('type') ?? '';
    const kind = (['recovery', 'signup', 'email_change', 'magiclink', 'invite'] as const).find((t) => t === type) ?? 'unknown';
    return { params, kind };
  } catch {
    return null;
  }
}

/** Signs in from a link. Returns the link kind, or throws with the link's own error message. */
async function consume(sb: SupabaseClient, url: string): Promise<AuthLinkKind | null> {
  const parsed = parse(url);
  if (!parsed) return null;
  const { params, kind } = parsed;
  const error = params.get('error_description') ?? params.get('error');
  if (error) throw new Error(error.replace(/\+/g, ' '));
  const code = params.get('code');
  if (code) {
    const { error: e } = await sb.auth.exchangeCodeForSession(code);
    if (e) throw new Error(e.message);
    return kind;
  }
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token && refresh_token) {
    const { error: e } = await sb.auth.setSession({ access_token, refresh_token });
    if (e) throw new Error(e.message);
    return kind;
  }
  return kind === 'unknown' ? null : kind;
}

/**
 * Listens for auth links for the lifetime of the app. `onLink` gets the kind (e.g. 'recovery' →
 * ask for a new password) or an error message.
 */
export function listenForAuthLinks(sb: SupabaseClient, onLink: (kind: AuthLinkKind | null, error: string | null) => void): () => void {
  let stop = () => undefined as void;
  const handle = (urls: string[] | null | undefined) => {
    for (const url of urls ?? []) {
      if (!url.startsWith('aetherchat://')) continue;
      const invite = /^aetherchat:\/\/inv\/([A-Za-z0-9_-]{2,64})/.exec(url);
      if (invite) {
        openJoinDialog(invite[1]!);
        continue;
      }
      void consume(sb, url).then(
        (kind) => onLink(kind, null),
        (e: unknown) => onLink(null, e instanceof Error ? e.message : String(e)),
      );
    }
  };

  if (isTauri) {
    let cancelled = false;
    void import('@tauri-apps/plugin-deep-link').then(async (dl) => {
      handle(await dl.getCurrent().catch(() => null)); // the link that launched the app
      const unlisten = await dl.onOpenUrl(handle); // links opened while it's running
      if (cancelled) unlisten();
      else stop = unlisten;
      // bring the window forward so the user sees the result
    });
    return () => {
      cancelled = true;
      stop();
    };
  }

  // Web: supabase-js already consumed the hash; report the type it carried.
  const kind = parse(window.location.href)?.kind;
  if (kind && kind !== 'unknown') {
    onLink(kind, null);
    history.replaceState(null, '', window.location.pathname);
  }
  const { data } = sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') onLink('recovery', null);
  });
  return () => data.subscription.unsubscribe();
}
