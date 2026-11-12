/** Reads one app-wide setting (public.app_config, set by admins), with a fallback. */
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '../lib/supabase';

export function useAppSetting<T>(key: string, fallback: T): T {
  const sb = useSupabase();
  const { data } = useQuery({
    queryKey: ['app-config', key],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await sb.from('app_config').select('value').eq('key', key).maybeSingle();
      return ((data as { value: T } | null)?.value ?? null) as T | null;
    },
  });
  return data ?? fallback;
}
