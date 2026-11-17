/**
 * Moments (2.1): 24-hour photos, videos and text cards with an audience (everyone you know, friends,
 * or close friends). The server decides who can see what; this groups them by person and tracks
 * which ones you've seen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useSupabase } from '../lib/supabase';
import { useMeId } from './useMe';

export type MomentAudience = 'everyone' | 'friends' | 'close';

export interface Moment {
  id: string;
  user_id: string;
  kind: 'image' | 'video' | 'text';
  media_path: string | null;
  body: string | null;
  background: string | null;
  audience: MomentAudience;
  created_at: string;
  expires_at: string;
}

export interface PersonMoments {
  userId: string;
  moments: Moment[];
  /** Every one of them seen already. */
  seen: boolean;
}

export function useMomentFeed() {
  const sb = useSupabase();
  const me = useMeId();
  const feed = useQuery({
    queryKey: ['moments'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await sb
        .from('moments')
        .select('id, user_id, kind, media_path, body, background, audience, created_at, expires_at')
        .gt('expires_at', new Date().toISOString())
        .order('created_at')
        .limit(500);
      if (error) throw new Error(error.message);
      return data as Moment[];
    },
  });
  const seen = useQuery({
    queryKey: ['moment-views', me],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await sb.from('moment_views').select('moment_id').eq('viewer_id', me).limit(2000);
      if (error) throw new Error(error.message);
      return new Set((data as { moment_id: string }[]).map((r) => r.moment_id));
    },
  });
  return useMemo(() => {
    const viewed = seen.data ?? new Set<string>();
    const byUser = new Map<string, Moment[]>();
    for (const m of feed.data ?? []) byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m]);
    const people: PersonMoments[] = [...byUser.entries()].map(([userId, moments]) => ({
      userId,
      moments,
      seen: userId === me || moments.every((m) => viewed.has(m.id)),
    }));
    // Yours first, then people with new ones (newest first), then the ones you've seen.
    people.sort((a, b) => (a.userId === me ? -1 : b.userId === me ? 1 : a.seen !== b.seen ? (a.seen ? 1 : -1) : b.moments.at(-1)!.created_at.localeCompare(a.moments.at(-1)!.created_at)));
    return { people, byUser: new Map(people.map((p) => [p.userId, p])), viewed, loading: feed.isLoading };
  }, [feed.data, feed.isLoading, seen.data, me]);
}

export function useMarkMomentSeen() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const me = useMeId();
  return (id: string) => {
    qc.setQueryData<Set<string>>(['moment-views', me], (s) => new Set([...(s ?? []), id]));
    void sb.from('moment_views').upsert({ moment_id: id }, { onConflict: 'moment_id,viewer_id', ignoreDuplicates: true }).then(() => undefined);
  };
}

/** Who has seen one of your moments. */
export function useMomentViewers(id: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['moment-viewers', id],
    enabled: !!id,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await sb.from('moment_views').select('viewer_id, viewed_at').eq('moment_id', id!).order('viewed_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data as { viewer_id: string; viewed_at: string }[];
    },
  });
}

/** A signed link to a moment's photo or video (private storage). */
export function useMomentMedia(path: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['moment-media', path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => (await sb.storage.from('moments').createSignedUrl(path!, 3600)).data?.signedUrl ?? null,
  });
}

export function usePostMoment() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const me = useMeId();
  return useMutation({
    mutationFn: async (input: { file?: File; body?: string; background?: string; audience: MomentAudience }) => {
      let media_path: string | null = null;
      let kind: Moment['kind'] = 'text';
      if (input.file) {
        if (input.file.size > 20 * 1024 * 1024) throw new Error('Moments can be up to 20 MB.');
        kind = input.file.type.startsWith('video/') ? 'video' : 'image';
        const ext = (input.file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
        media_path = `${me}/${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from('moments').upload(media_path, input.file, { contentType: input.file.type });
        if (up.error) throw new Error(up.error.message);
      }
      const { error } = await sb.from('moments').insert({
        kind,
        media_path,
        body: input.body?.trim().slice(0, 300) || null,
        background: kind === 'text' ? (input.background ?? '#7658fb') : null,
        audience: input.audience,
      });
      if (error) {
        if (media_path) void sb.storage.from('moments').remove([media_path]);
        throw new Error(error.message.includes('row-level') ? 'You have a lot of moments up already. Wait for some to expire.' : error.message);
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['moments'] }),
  });
}

export function useDeleteMoment() {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: Moment) => {
      const { error } = await sb.from('moments').delete().eq('id', m.id);
      if (error) throw new Error(error.message);
      if (m.media_path) await sb.storage.from('moments').remove([m.media_path]);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['moments'] }),
  });
}

export function useCloseFriends() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['close-friends'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('close_friends').select('friend_id');
      if (error) throw new Error(error.message);
      return new Set((data as { friend_id: string }[]).map((r) => r.friend_id));
    },
  });
}

export function useToggleCloseFriend() {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      const { error } = on ? await sb.from('close_friends').insert({ friend_id: id }) : await sb.from('close_friends').delete().eq('friend_id', id);
      if (error) throw new Error(error.message);
    },
    onMutate: ({ id, on }) =>
      qc.setQueryData<Set<string>>(['close-friends'], (s) => {
        const next = new Set(s ?? []);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    onError: () => void qc.invalidateQueries({ queryKey: ['close-friends'] }),
  });
}

/** Ring styles: your accent, four gradients, or your own colour. */
export const RING_PRESETS: Record<string, string> = {
  sunset: 'conic-gradient(from 210deg, #ff7e5f, #feb47b, #ff5e8a, #ff7e5f)',
  ocean: 'conic-gradient(from 210deg, #2193b0, #6dd5ed, #3a7bd5, #2193b0)',
  aurora: 'conic-gradient(from 210deg, #3ee0b0, #7658fb, #3ee0b0)',
  candy: 'conic-gradient(from 210deg, #ff6fb5, #8f7bff, #ff6fb5)',
};

export function ringBackground(ring: string | null | undefined, accent: string | null | undefined): string {
  if (ring && RING_PRESETS[ring]) return RING_PRESETS[ring]!;
  if (ring && /^#[0-9a-fA-F]{6}$/.test(ring)) return ring;
  return accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : 'var(--ae-accent)';
}
