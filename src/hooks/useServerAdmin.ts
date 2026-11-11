/**
 * Batch 2 data hooks: roles, member roles, server and channel settings, channel permission
 * overrides, invites, bans, moderation (kick/ban/timeout/nickname), audit log, reordering,
 * plus derived member styling (role colors, hoisted groups).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useSupabase } from '../lib/supabase';
import type {
  AuditEntry,
  Channel,
  ChannelOverwrite,
  MemberRole,
  Server,
  ServerBan,
  ServerInvite,
  ServerMember,
  ServerRole,
} from '../types/db';
import { unwrap } from './useChatData';

// ── Reads ──────────────────────────────────────────────────────────────────────────────────

export function useServerRoles(serverId: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['roles', serverId],
    enabled: !!serverId,
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(await sb.from('server_roles').select('*').eq('server_id', serverId!).order('position', { ascending: false })) as ServerRole[],
  });
}

export function useMemberRoles(serverId: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['member-roles', serverId],
    enabled: !!serverId,
    staleTime: 60_000,
    queryFn: async () => unwrap(await sb.from('member_roles').select('*').eq('server_id', serverId!)) as MemberRole[],
  });
}

/** Keeps roles, member roles and members live for the open server. */
export function useServerLive(serverId: string | null) {
  const sb = useSupabase();
  const qc = useQueryClient();
  useEffect(() => {
    if (!serverId) return;
    const filter = `server_id=eq.${serverId}`;
    const invalidate = (key: unknown[]) => () => void qc.invalidateQueries({ queryKey: key });
    const ch = sb
      .channel(`server-live:${serverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'server_roles', filter }, () => {
        void qc.invalidateQueries({ queryKey: ['roles', serverId] });
        void qc.invalidateQueries({ queryKey: ['server-permissions', serverId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_roles', filter }, () => {
        void qc.invalidateQueries({ queryKey: ['member-roles', serverId] });
        void qc.invalidateQueries({ queryKey: ['server-permissions', serverId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'server_members', filter }, invalidate(['server-members', serverId]))
      // Deletes can't be filtered; refresh when anything is removed.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'member_roles' }, invalidate(['member-roles', serverId]))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'server_members' }, invalidate(['server-members', serverId]))
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [qc, sb, serverId]);
}

export interface MemberStyle {
  color: string | null;
  topPosition: number;
  /** Highest hoisted role (for member-list grouping). */
  hoist: ServerRole | null;
  roleIds: string[];
}

/** Per-member display color (highest colored role), hoist group and role ids. */
export function useMemberStyles(serverId: string | null): Map<string, MemberStyle> {
  const { data: roles = [] } = useServerRoles(serverId);
  const { data: memberRoles = [] } = useMemberRoles(serverId);
  return useMemo(() => {
    const byId = new Map(roles.map((r) => [r.id, r]));
    const perUser = new Map<string, ServerRole[]>();
    for (const mr of memberRoles) {
      const role = byId.get(mr.role_id);
      if (role) perUser.set(mr.user_id, [...(perUser.get(mr.user_id) ?? []), role]);
    }
    const map = new Map<string, MemberStyle>();
    for (const [userId, list] of perUser) {
      const sorted = [...list].sort((a, b) => b.position - a.position); // highest first
      map.set(userId, {
        color: sorted.find((r) => r.color)?.color ?? null,
        topPosition: sorted[0]?.position ?? 0,
        hoist: sorted.find((r) => r.hoist) ?? null,
        roleIds: sorted.map((r) => r.id),
      });
    }
    return map;
  }, [roles, memberRoles]);
}

// ── Server ─────────────────────────────────────────────────────────────────────────────────

export function useUpdateServer(userId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<Server, 'name' | 'description' | 'icon_url' | 'banner_url'>> }) =>
      unwrap(await sb.from('servers').update(patch).eq('id', id).select('*').single()) as Server,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['servers', userId] }),
  });
}

// ── Roles ──────────────────────────────────────────────────────────────────────────────────

export function useRoleActions(serverId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['roles', serverId] });
    void qc.invalidateQueries({ queryKey: ['member-roles', serverId] });
    void qc.invalidateQueries({ queryKey: ['server-permissions', serverId] });
  };
  return {
    create: useMutation({
      mutationFn: async ({ name, position }: { name: string; position: number }) =>
        unwrap(await sb.from('server_roles').insert({ server_id: serverId, name, position, permissions: 0 }).select('*').single()) as ServerRole,
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<ServerRole, 'name' | 'color' | 'hoist' | 'mentionable' | 'permissions'>> }) =>
        unwrap(await sb.from('server_roles').update(patch).eq('id', id).select('*').single()) as ServerRole,
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await sb.from('server_roles').delete().eq('id', id);
        if (error) throw new Error(error.message);
      },
      onSuccess: refresh,
    }),
    reorder: useMutation({
      mutationFn: async (roleIdsHighestFirst: string[]) =>
        unwrap(await sb.rpc('reorder_roles', { p_server_id: serverId, p_role_ids: roleIdsHighestFirst })),
      onSettled: refresh,
    }),
    assign: useMutation({
      mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
        const { error } = await sb.from('member_roles').insert({ server_id: serverId, user_id: userId, role_id: roleId });
        if (error) throw new Error(error.message);
      },
      onSuccess: refresh,
    }),
    unassign: useMutation({
      mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
        const { error } = await sb.from('member_roles').delete().eq('user_id', userId).eq('role_id', roleId);
        if (error) throw new Error(error.message);
      },
      onSuccess: refresh,
    }),
  };
}

// ── Channels ───────────────────────────────────────────────────────────────────────────────

export function useChannelActions(serverId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['channels', serverId] });
    void qc.invalidateQueries({ queryKey: ['channel'] });
    void qc.invalidateQueries({ queryKey: ['channel-permissions'] });
  };
  return {
    update: useMutation({
      mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<Channel, 'name' | 'topic' | 'rate_limit_seconds' | 'user_limit' | 'nsfw' | 'parent_id' | 'subtype' | 'forum_tags' | 'require_tag' | 'default_sort' | 'default_layout'>> }) =>
        unwrap(await sb.from('channels').update(patch).eq('id', id).select('*').single()) as Channel,
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await sb.from('channels').delete().eq('id', id);
        if (error) throw new Error(error.message);
      },
      onSuccess: refresh,
    }),
    reorder: useMutation({
      mutationFn: async (items: { id: string; parent_id: string | null; position: number }[]) =>
        unwrap(await sb.rpc('reorder_channels', { p_server_id: serverId, p_items: items })),
      // Optimistic: apply positions locally so the drop feels instant.
      onMutate: (items) => {
        qc.setQueryData<Channel[]>(['channels', serverId], (list) =>
          list
            ?.map((c) => {
              const it = items.find((x) => x.id === c.id);
              return it ? { ...c, position: it.position, parent_id: c.type === 'category' ? null : it.parent_id } : c;
            })
            .sort((a, b) => a.position - b.position),
        );
      },
      onSettled: refresh,
    }),
  };
}

export function useChannelOverwrites(channelId: string | null) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['overwrites', channelId],
    enabled: !!channelId,
    queryFn: async () => unwrap(await sb.from('channel_overwrites').select('*').eq('channel_id', channelId!)) as ChannelOverwrite[],
  });
}

export function useOverwriteActions(channelId: string, serverId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['overwrites', channelId] });
    void qc.invalidateQueries({ queryKey: ['channels', serverId] });
  };
  return {
    save: useMutation({
      mutationFn: async (o: { target_type: 'role' | 'member'; target_id: string; allow: bigint; deny: bigint }) => {
        const row = { channel_id: channelId, target_type: o.target_type, target_id: o.target_id, allow: Number(o.allow), deny: Number(o.deny) };
        const { error } = await sb.from('channel_overwrites').upsert(row, { onConflict: 'channel_id,target_type,target_id' });
        if (error) throw new Error(error.message);
      },
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async ({ target_type, target_id }: { target_type: 'role' | 'member'; target_id: string }) => {
        const { error } = await sb
          .from('channel_overwrites')
          .delete()
          .eq('channel_id', channelId)
          .eq('target_type', target_type)
          .eq('target_id', target_id);
        if (error) throw new Error(error.message);
      },
      onSuccess: refresh,
    }),
  };
}

// ── Invites & bans ─────────────────────────────────────────────────────────────────────────

export function useInvites(serverId: string, enabled: boolean) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['invites', serverId],
    enabled,
    queryFn: async () =>
      unwrap(await sb.from('server_invites').select('*').eq('server_id', serverId).order('created_at', { ascending: false })) as ServerInvite[],
  });
}

export function useInviteActions(serverId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['invites', serverId] });
  return {
    create: useMutation({
      mutationFn: async ({ maxUses, expiresHours, code }: { maxUses: number | null; expiresHours: number | null; code?: string }) =>
        unwrap(
          await sb
            .from('server_invites')
            .insert({
              server_id: serverId,
              max_uses: maxUses,
              expires_at: expiresHours ? new Date(Date.now() + expiresHours * 3600_000).toISOString() : null,
              ...(code ? { code } : {}),
            })
            .select('*')
            .single(),
        ) as ServerInvite,
      onSuccess: refresh,
    }),
    revoke: useMutation({
      mutationFn: async (code: string) => {
        const { error } = await sb.from('server_invites').delete().eq('code', code);
        if (error) throw new Error(error.message);
      },
      onSuccess: refresh,
    }),
  };
}

export function useBans(serverId: string, enabled: boolean) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['bans', serverId],
    enabled,
    queryFn: async () => unwrap(await sb.from('server_bans').select('*').eq('server_id', serverId).order('created_at', { ascending: false })) as ServerBan[],
  });
}

// ── Moderation ─────────────────────────────────────────────────────────────────────────────

export function useModeration(serverId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['server-members', serverId] });
    void qc.invalidateQueries({ queryKey: ['bans', serverId] });
    void qc.invalidateQueries({ queryKey: ['audit', serverId] });
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => unwrap(await sb.rpc(fn, args));
  return {
    kick: useMutation({
      mutationFn: ({ userId, reason }: { userId: string; reason?: string }) => rpc('kick_member', { p_server_id: serverId, p_user_id: userId, p_reason: reason ?? null }),
      onSuccess: refresh,
    }),
    ban: useMutation({
      mutationFn: ({ userId, reason }: { userId: string; reason?: string }) => rpc('ban_member', { p_server_id: serverId, p_user_id: userId, p_reason: reason ?? null }),
      onSuccess: refresh,
    }),
    unban: useMutation({
      mutationFn: async (userId: string) => {
        const { error } = await sb.from('server_bans').delete().eq('server_id', serverId).eq('user_id', userId);
        if (error) throw new Error(error.message);
      },
      onSuccess: refresh,
    }),
    timeout: useMutation({
      mutationFn: ({ userId, minutes, reason }: { userId: string; minutes: number; reason?: string }) =>
        rpc('timeout_member', { p_server_id: serverId, p_user_id: userId, p_minutes: minutes, p_reason: reason ?? null }),
      onSuccess: refresh,
    }),
    nickname: useMutation({
      mutationFn: ({ userId, nickname }: { userId: string; nickname: string }) =>
        rpc('set_member_nickname', { p_server_id: serverId, p_user_id: userId, p_nickname: nickname }),
      onSuccess: refresh,
    }),
  };
}

export function useAuditLog(serverId: string, enabled: boolean) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['audit', serverId],
    enabled,
    queryFn: async () =>
      unwrap(await sb.from('audit_log').select('*').eq('server_id', serverId).order('id', { ascending: false }).limit(200)) as AuditEntry[],
  });
}

/** The caller's own membership row (for timeout state). */
export function useMyMembership(serverId: string | null, userId: string) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['server-members', serverId, 'me'],
    enabled: !!serverId,
    staleTime: 30_000,
    queryFn: async () =>
      unwrap(await sb.from('server_members').select('*').eq('server_id', serverId!).eq('user_id', userId).maybeSingle()) as ServerMember | null,
  });
}
