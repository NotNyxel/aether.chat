/** Account, privacy and safety data: privacy settings, notes, mutuals, reports, AutoMod, exports. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '../lib/supabase';
import type { AutomodEvent, AutomodRule, PrivacySettings, Report, ReportReason, Server, UserNote } from '../types/db';
import { unwrap } from './useChatData';

export const DEFAULT_PRIVACY: Omit<PrivacySettings, 'user_id' | 'updated_at'> = {
  dm_policy: 'servers',
  friend_request_policy: 'everyone',
  message_requests: true,
};

export function usePrivacySettings(userId: string) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['privacy', userId],
    queryFn: async () => (unwrap(await sb.from('privacy_settings').select('*').eq('user_id', userId).maybeSingle()) as PrivacySettings | null) ?? null,
  });
}

export function useSavePrivacy(userId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<typeof DEFAULT_PRIVACY>) =>
      unwrap(
        await sb
          .from('privacy_settings')
          .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
          .select()
          .single(),
      ) as PrivacySettings,
    onSuccess: (row) => qc.setQueryData(['privacy', userId], row),
  });
}

export function useNotes() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['notes'],
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await sb.from('user_notes').select('*')) as UserNote[],
  });
}

export function useSaveNote() {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ targetId, note, nickname }: { targetId: string; note?: string | null; nickname?: string | null }) => {
      const cur = qc.getQueryData<UserNote[]>(['notes'])?.find((n) => n.target_id === targetId);
      const next = { note: note === undefined ? (cur?.note ?? null) : note || null, nickname: nickname === undefined ? (cur?.nickname ?? null) : nickname || null };
      if (!next.note && !next.nickname) {
        unwrap(await sb.from('user_notes').delete().eq('target_id', targetId).select());
        return null;
      }
      return unwrap(
        await sb.from('user_notes').upsert({ target_id: targetId, ...next, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,target_id' }).select().single(),
      ) as UserNote;
    },
    onSuccess: (row, vars) =>
      qc.setQueryData<UserNote[]>(['notes'], (rows = []) => [...rows.filter((r) => r.target_id !== vars.targetId), ...(row ? [row] : [])]),
  });
}

/** Your private nickname for someone, if you set one. */
export function useFriendNickname(userId: string | null | undefined): string | null {
  const { data } = useNotes();
  return (userId && data?.find((n) => n.target_id === userId)?.nickname) || null;
}

export function useMutuals(userId: string | null, enabled: boolean) {
  const sb = useSupabase();
  const servers = useQuery({
    queryKey: ['mutual-servers', userId],
    enabled: enabled && !!userId,
    staleTime: 60_000,
    queryFn: async () => unwrap(await sb.rpc('mutual_servers', { p_user_id: userId })) as Server[],
  });
  const friends = useQuery({
    queryKey: ['mutual-friends', userId],
    enabled: enabled && !!userId,
    staleTime: 60_000,
    queryFn: async () => unwrap(await sb.rpc('mutual_friends', { p_user_id: userId })) as string[],
  });
  return { servers: servers.data ?? [], friends: friends.data ?? [] };
}

export function useReport() {
  const sb = useSupabase();
  return useMutation({
    mutationFn: async (input: { messageId?: string | null; targetUserId?: string | null; serverId?: string | null; reason: ReportReason; details: string }) =>
      unwrap(
        await sb
          .from('reports')
          .insert({
            message_id: input.messageId ?? null,
            target_user_id: input.messageId ? null : (input.targetUserId ?? null),
            server_id: input.messageId ? null : (input.serverId ?? null),
            reason: input.reason,
            details: input.details.trim() || null,
          })
          .select('id')
          .single(),
      ),
  });
}

export function useServerReports(serverId: string | null, enabled: boolean) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['reports', serverId],
    enabled: enabled && !!serverId,
    refetchInterval: 60_000,
    queryFn: async () => unwrap(await sb.from('reports').select('*').eq('server_id', serverId!).order('created_at', { ascending: false }).limit(100)) as Report[],
  });
}

export function useResolveReport(serverId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, resolution }: { id: string; status: Report['status']; resolution?: string }) =>
      unwrap(await sb.rpc('resolve_report', { p_report_id: id, p_status: status, p_resolution: resolution ?? null })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['reports', serverId] }),
  });
}

export function useAutomod(serverId: string | null, enabled: boolean) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const rules = useQuery({
    queryKey: ['automod-rules', serverId],
    enabled: enabled && !!serverId,
    queryFn: async () => unwrap(await sb.from('automod_rules').select('*').eq('server_id', serverId!).order('created_at')) as AutomodRule[],
  });
  const events = useQuery({
    queryKey: ['automod-events', serverId],
    enabled: enabled && !!serverId,
    refetchInterval: 60_000,
    queryFn: async () => unwrap(await sb.from('automod_events').select('*').eq('server_id', serverId!).order('id', { ascending: false }).limit(100)) as AutomodEvent[],
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['automod-rules', serverId] });
  return {
    rules: rules.data ?? [],
    events: events.data ?? [],
    save: useMutation({
      mutationFn: async (rule: Partial<AutomodRule> & { id?: string }) => {
        const { id, created_at: _c, ...rest } = rule;
        return id
          ? unwrap(await sb.from('automod_rules').update(rest).eq('id', id).select().single())
          : unwrap(await sb.from('automod_rules').insert({ ...rest, server_id: serverId }).select().single());
      },
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await sb.from('automod_rules').delete().eq('id', id).select()),
      onSuccess: refresh,
    }),
  };
}

/** Why the server dropped my last message (AutoMod), if it was in the last minute. */
export async function lastAutomodBlock(sb: ReturnType<typeof useSupabase>, userId: string): Promise<AutomodEvent | null> {
  const { data } = await sb
    .from('automod_events')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 60_000).toISOString())
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AutomodEvent | null) ?? null;
}
