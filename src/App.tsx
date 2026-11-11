/** Root gating: session → main shell. */
import type { Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { MainLayout } from './components/MainLayout';
import { UpdateBanner } from './components/UpdateBanner';
import { resolveBackendConfig, SupabaseProvider, useSupabase } from './lib/supabase';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, gcTime: 5 * 60_000 },
  },
});

function AuthGate() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  if (session === undefined) {
    return <div className="grid h-full place-items-center text-sm text-ae-muted">Loading…</div>;
  }
  if (!session) return <AuthScreen />;

  return (
    <MainLayout
      key={session.user.id}
      userId={session.user.id}
      onSignOut={() => {
        void sb.auth.signOut();
        qc.clear();
      }}
    />
  );
}

const backend = resolveBackendConfig();

export function App() {
  return (
    <SupabaseProvider config={backend}>
      <QueryClientProvider client={queryClient}>
        <AuthGate />
        <UpdateBanner />
      </QueryClientProvider>
    </SupabaseProvider>
  );
}
