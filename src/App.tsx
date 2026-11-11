/** Root gating: email links → session → two-factor check → main shell. */
import type { Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AuthScreen, MfaChallenge, NewPasswordScreen } from './components/AuthScreen';
import { ConfirmLayer } from './components/ConfirmDialog';
import { MainLayout } from './components/MainLayout';
import { toast, Toaster } from './components/Toaster';
import { TooltipLayer } from './components/TooltipLayer';
import { UpdateBanner } from './components/UpdateBanner';
import { listenForAuthLinks } from './lib/authLinks';
import { isTauri } from './lib/platform';
import { resolveBackendConfig, SupabaseProvider, useSupabase } from './lib/supabase';

const queryClient = new QueryClient({
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
        else if (kind === 'signup') toast.success('Email confirmed. Welcome to aether.chat!', '🎉');
        else if (kind === 'email_change') toast.success('Email change confirmed.', '✉');
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

  const signOut = () => {
    void sb.auth.signOut();
    qc.clear();
  };

  if (session === undefined) return <Splash />;
  if (!session) return <AuthScreen linkError={linkError} />;
  if (needsMfa === null) return <Splash />;
  if (needsMfa) return <MfaChallenge onDone={() => setNeedsMfa(false)} onCancel={signOut} />;
  if (recovering)
    return (
      <NewPasswordScreen
        onDone={() => {
          setRecovering(false);
          toast.success('Password changed.');
        }}
      />
    );

  return <MainLayout key={session.user.id} userId={session.user.id} onSignOut={signOut} />;
}

const backend = resolveBackendConfig();

export function App() {
  return (
    <SupabaseProvider config={backend}>
      <QueryClientProvider client={queryClient}>
        <AuthGate />
        <UpdateBanner />
        <Toaster />
        <TooltipLayer />
        <ConfirmLayer />
      </QueryClientProvider>
    </SupabaseProvider>
  );
}
