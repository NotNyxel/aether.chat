/** Per-server soundboard sounds (public.soundboard_sounds + the public `soundboard` bucket). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { checkSoundFile } from '../lib/soundboard';
import { useSupabase } from '../lib/supabase';
import type { SoundboardSound } from '../types/db';
import { unwrap } from './useChatData';

export function useSoundboard(serverId: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['soundboard', serverId],
    enabled: !!serverId,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(await sb.from('soundboard_sounds').select('*').eq('server_id', serverId!).order('created_at')) as SoundboardSound[],
  });
}

export function useSoundboardActions(serverId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['soundboard', serverId] });
  return {
    add: useMutation({
      mutationFn: async ({ file, name, emoji, volume }: { file: File; name: string; emoji: string; volume: number }) => {
        await checkSoundFile(file);
        const ext = (file.name.split('.').pop() ?? 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
        const path = `${serverId}/${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from('soundboard').upload(path, file, { contentType: file.type, upsert: false });
        if (up.error) throw new Error(up.error.message);
        const url = sb.storage.from('soundboard').getPublicUrl(path).data.publicUrl;
        return unwrap(
          await sb
            .from('soundboard_sounds')
            .insert({ server_id: serverId, name: name.trim().slice(0, 32) || 'Sound', emoji: emoji.trim() || null, url, volume })
            .select()
            .single(),
        ) as SoundboardSound;
      },
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<SoundboardSound, 'name' | 'emoji' | 'volume'>> }) =>
        unwrap(await sb.from('soundboard_sounds').update(patch).eq('id', id).select().single()),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (sound: SoundboardSound) => {
        unwrap(await sb.from('soundboard_sounds').delete().eq('id', sound.id).select());
        const marker = '/soundboard/';
        const i = sound.url.indexOf(marker);
        if (i >= 0) await sb.storage.from('soundboard').remove([sound.url.slice(i + marker.length)]);
      },
      onSuccess: refresh,
    }),
  };
}
