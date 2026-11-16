/** Root gating: email links → session → two-factor check → main shell. */
import { MailIcon, PartyIcon } from './components/icons';
import type { Session } from '@supabase/supabase-js';
import { MutationCache, QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AuthScreen, MfaChallenge, NewPasswordScreen } from './components/AuthScreen';
import { ConfirmLayer } from './components/ConfirmDialog';
import { ContextMenuLayer } from './components/ContextMenu';
import { NativeUiShim } from './components/NativeUiShim';
import { MainLayout } from './components/MainLayout';
import { ModerationGate } from './components/Moderation';
import { toast, Toaster } from './components/Toaster';
import { TooltipLayer } from './components/TooltipLayer';
import { WindowFrame } from './components/TitleBar';
import { UpdateBanner } from './components/UpdateBanner';
import { listenForAuthLinks } from './lib/authLinks';
import { openJoinDialog } from './lib/joinBus';
import { listenForPushClicks } from './lib/push';
import { trackAccounts } from './lib/accounts';
import { isTauri } from './lib/platform';
import { resolveBackendConfig, SupabaseProvider, useSupabase } from './lib/supabase';
import { installTouchControls } from './lib/touch';
import { clearCache, hydrateCache, persistCache } from './lib/persistCache';
import { warmEmojiCache } from './lib/emojiWarm';

/** A failed change never fails silently: if an action has no error handling of its own, say so. */
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return 'You seem to be offline. Check your connection and try again.';
  if (/jwt|token.*expired|not authenticated|invalid claim/i.test(msg)) return 'Your session expired. Sign in again.';
  if (/permission denied|row-level security|violates row-level/i.test(msg)) return 'You don’t have permission to do that.';
  // Same text actions use for their own errors, so the two collapse into one message.
  return msg || 'Something went wrong. Try again.';
}

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (!mutation.options.onError) toast.error(friendlyError(err));
    },
  }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, gcTime: 5 * 60_000 },
  },
});

function Splash() {
  return (
    <div className="grid h-full place-items-center">
      <div className="ae-fade flex flex-col items-center gap-4">
        <img src="/icon.svg" alt="" className="ae-splash h-16 w-16" draggable={false} />
        <div className="h-1 w-32 overflow-hidden rounded-full bg-ae-surface">
          <div className="ae-skeleton h-full w-full" />
        </div>
      </div>
    </div>
  );
}

function AuthGate() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  /** null = unknown yet, true = this session still needs its authenticator code. */
  const [needsMfa, setNeedsMfa] = useState<boolean | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    void sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  useEffect(() => trackAccounts(sb), [sb]);

  // A session the server no longer accepts (signed out elsewhere, password reset, revoked): the app
  // used to keep showing cached chats while every request failed. Try one refresh; if that fails
  // too, go to the sign-in screen.
  useEffect(() => {
    let checking = false;
    const dead = /jwt expired|invalid jwt|jwt.*(malformed|signature)|session.?not.?found|refresh.?token.*(not found|invalid|already used)|not authenticated/i;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'error' || checking) return;
      const msg = event.action.error instanceof Error ? event.action.error.message : String(event.action.error);
      if (!dead.test(msg)) return;
      checking = true;
      void sb.auth.refreshSession().then(({ error }) => {
        checking = false;
        if (error) {
          toast.error('You were signed out. Sign in again to continue.');
          void sb.auth.signOut({ scope: 'local' });
        } else void queryClient.invalidateQueries();
      });
    });
  }, [sb]);

  // Password reset / email confirmation / email change links.
  useEffect(
    () =>
      listenForAuthLinks(sb, (kind, error) => {
        if (isTauri) void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setFocus()).catch(() => undefined);
        if (error) {
          setLinkError(error);
          toast.error(error);
          return;
        }
        if (kind === 'recovery') setRecovering(true);
        else if (kind === 'signup') toast.success('Email confirmed. Welcome to Aether!', <PartyIcon size={14} />);
        else if (kind === 'email_change') toast.success('Email change confirmed.', <MailIcon size={14} />);
      }),
    [sb],
  );

  // Two-factor: a password sign-in is aal1; if the account has an authenticator, require aal2.
  // Checked once per signed-in user (not on every hourly token refresh, which would remount the app).
  const userId = session?.user.id ?? null;
  useEffect(() => {
    setNeedsMfa(null);
    if (!userId) return;
    let cancelled = false;
    void sb.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (!cancelled) setNeedsMfa(!!data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2');
    });
    return () => {
      cancelled = true;
    };
  }, [sb, userId]);

  // Show last session's chats and messages instantly, then refresh them in the background.
  const hydrated = useRef<string | null>(null);
  if (userId && hydrated.current !== userId) {
    hydrateCache(qc, userId);
    hydrated.current = userId;
  }
  useEffect(() => (userId ? persistCache(qc, userId) : undefined), [qc, userId]);
  // First run on a device: download the emoji images in the background so they're instant later.
  useEffect(() => {
    if (!userId) return;
    const t = setTimeout(warmEmojiCache, 10_000);
    return () => clearTimeout(t);
  }, [userId]);

  const signOut = () => {
    clearCache(userId);
    void sb.auth.signOut();
    qc.clear();
  };

  if (session === undefined) return <WindowFrame><Splash /></WindowFrame>;
  if (!session) return <WindowFrame><AuthScreen linkError={linkError} /></WindowFrame>;
  if (needsMfa === null) return <WindowFrame><Splash /></WindowFrame>;
  if (needsMfa) return <WindowFrame><MfaChallenge onDone={() => setNeedsMfa(false)} onCancel={signOut} /></WindowFrame>;
  if (recovering)
    return (
      <WindowFrame>
        <NewPasswordScreen
          onDone={() => {
            setRecovering(false);
            toast.success('Password changed.');
          }}
        />
      </WindowFrame>
    );

  return (
    <ModerationGate key={session.user.id} onSignOut={signOut} splash={<WindowFrame><Splash /></WindowFrame>} frame={(n) => <WindowFrame>{n}</WindowFrame>}>
      <MainLayout userId={session.user.id} onSignOut={signOut} />
    </ModerationGate>
  );
}

const backend = resolveBackendConfig();

listenForPushClicks();
installTouchControls();

// Web: /inv/CODE opens the join dialog (after signing in, if needed).
if (!isTauri) {
  const m = /^\/inv\/([A-Za-z0-9_-]{2,64})\/?$/.exec(window.location.pathname);
  if (m) {
    openJoinDialog(m[1]!);
    history.replaceState(null, '', '/');
  }
}

export function App() {
  return (
    <SupabaseProvider config={backend}>
      <QueryClientProvider client={queryClient}>
        <AuthGate />
        <UpdateBanner />
        <Toaster />
        <TooltipLayer />
        <ConfirmLayer />
        <ContextMenuLayer />
        <NativeUiShim />
      </QueryClientProvider>
    </SupabaseProvider>
  );
}
