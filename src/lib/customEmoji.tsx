/** Custom server emoji: <:name:id> in message text renders as the image (public.server_emojis). */
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from './supabase';

export interface CustomEmojiRow {
  id: string;
  server_id: string;
  name: string;
  url: string;
  animated: boolean;
}

export const customEmojiToken = (e: Pick<CustomEmojiRow, 'id' | 'name'>) => `<:${e.name}:${e.id}>`;

/** Every custom emoji from the given servers (for the picker and :autocomplete:). */
export function useServerEmojis(serverIds: string[]) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['server-emojis', [...serverIds].sort().join(',')],
    enabled: serverIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('server_emojis').select('id, server_id, name, url, animated').in('server_id', serverIds).order('name');
      if (error) throw new Error(error.message);
      return data as CustomEmojiRow[];
    },
  });
}

export function CustomEmoji({ id, name, big = false }: { id: string; name: string; big?: boolean }) {
  const sb = useSupabase();
  const { data } = useQuery({
    queryKey: ['emoji', id],
    staleTime: Infinity,
    queryFn: async () => {
      const { data } = await sb.from('server_emojis').select('url').eq('id', id).maybeSingle();
      return (data as { url: string } | null)?.url ?? null;
    },
  });
  if (!data) return <span className="text-ae-muted">:{name}:</span>;
  return <img src={data} alt={`:${name}:`} title={`:${name}:`} draggable={false} className={`inline-block align-[-0.3em] object-contain ${big ? 'h-12 w-12' : 'h-[1.375em] w-[1.375em]'}`} />;
}
