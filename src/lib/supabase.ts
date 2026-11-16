/**
 * Supabase client wiring. The app ships with its backend built in (src/config.ts); Vite env vars
 * can override it for local development against another project.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { BUILT_IN_BACKEND } from '../config';

export interface BackendConfig {
  url: string;
  anonKey: string;
}

/** Env override (.env.local) or the built-in production backend. */
export function resolveBackendConfig(): BackendConfig {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anonKey ? { url, anonKey } : BUILT_IN_BACKEND;
}

export function createSupabase(config: BackendConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'aether.auth' },
    realtime: { params: { eventsPerSecond: 20 } },
  });
}

const SupabaseContext = createContext<SupabaseClient | null>(null);

export function SupabaseProvider({ config, children }: { config: BackendConfig; children: ReactNode }) {
  const client = useMemo(() => createSupabase(config), [config]);
  return createElement(SupabaseContext.Provider, { value: client }, children);
}

export function useSupabase(): SupabaseClient {
  const client = useContext(SupabaseContext);
  if (!client) throw new Error('useSupabase must be used inside <SupabaseProvider>');
  return client;
}

/**
 * Runs a query you don't need the answer to. Supabase queries only run once awaited or `.then`'d,
 * so `void sb.from(...).delete()` on its own never reaches the server; wrap it in `fire(...)`.
 */
export const fire = (query: PromiseLike<unknown>): void => void Promise.resolve(query).catch(() => {});
