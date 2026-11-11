/**
 * Per-server / per-channel / per-conversation notification settings (public.notification_settings)
 * and the rules that turn them into "should this message notify me?".
 *
 * Resolution: channel setting → server setting → default ('mentions' in servers, 'all' in DMs).
 * Muting a server mutes all of its channels. Muted scopes never notify or show unread dots, but
 * mentions still get a badge unless the level is 'none' (like Discord).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSupabase } from '../lib/supabase';
import type { NotificationLevel, NotificationSetting } from '../types/db';
import { unwrap } from './useChatData';

export function useNotificationSettings() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['notification-settings'],
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await sb.from('notification_settings').select('*')) as NotificationSetting[],
  });
}

export type NotificationPatch = Partial<Pick<NotificationSetting, 'level' | 'muted_until' | 'suppress_everyone'>>;

export function useSetNotificationSetting() {
  const sb = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scopeId, kind, patch }: { scopeId: string; kind: NotificationSetting['scope_kind']; patch: NotificationPatch }) => {
      const current = qc.getQueryData<NotificationSetting[]>(['notification-settings'])?.find((r) => r.scope_id === scopeId);
      const row = {
        scope_id: scopeId,
        scope_kind: kind,
        level: current?.level ?? null,
        muted_until: current?.muted_until ?? null,
        suppress_everyone: current?.suppress_everyone ?? false,
        ...patch,
        updated_at: new Date().toISOString(),
      };
      return unwrap(await sb.from('notification_settings').upsert(row, { onConflict: 'user_id,scope_id' }).select().single()) as NotificationSetting;
    },
    onSuccess: (row) => {
      qc.setQueryData<NotificationSetting[]>(['notification-settings'], (rows = []) => [...rows.filter((r) => r.scope_id !== row.scope_id), row]);
      // Levels change which mentions count toward badges.
      void qc.invalidateQueries({ queryKey: ['unread'] });
    },
  });
}

function muteEnd(row: NotificationSetting | undefined): number {
  if (!row?.muted_until) return 0;
  return row.muted_until === 'infinity' ? Infinity : Date.parse(row.muted_until) || 0;
}

export function isMutedRow(row: NotificationSetting | undefined, now = Date.now()): boolean {
  return muteEnd(row) > now;
}

export interface EffectiveNotify {
  muted: boolean;
  level: NotificationLevel;
  suppressEveryone: boolean;
}

/** Returns a resolver for any channel or conversation, plus the raw map. */
export function useNotifyResolver() {
  const { data: rows = [] } = useNotificationSettings();
  const map = useMemo(() => new Map(rows.map((r) => [r.scope_id, r])), [rows]);
  const resolve = useCallback(
    (scope: { kind: 'channel' | 'conversation' | 'server'; id: string; serverId?: string | null }): EffectiveNotify =>
      resolveNotify(map, scope),
    [map],
  );
  return { map, resolve };
}

export function resolveNotify(
  map: ReadonlyMap<string, NotificationSetting>,
  scope: { kind: 'channel' | 'conversation' | 'server'; id: string; serverId?: string | null },
): EffectiveNotify {
  const own = map.get(scope.id);
  if (scope.kind === 'conversation') {
    return { muted: isMutedRow(own), level: own?.level ?? 'all', suppressEveryone: false };
  }
  const server = scope.kind === 'server' ? own : scope.serverId ? map.get(scope.serverId) : undefined;
  const channel = scope.kind === 'channel' ? own : undefined;
  return {
    muted: isMutedRow(server) || isMutedRow(channel),
    level: channel?.level ?? server?.level ?? 'mentions',
    suppressEveryone: server?.suppress_everyone ?? false,
  };
}

/** Mute durations offered in the menus. */
export const MUTE_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: 'For 15 minutes', minutes: 15 },
  { label: 'For 1 hour', minutes: 60 },
  { label: 'For 3 hours', minutes: 180 },
  { label: 'For 8 hours', minutes: 480 },
  { label: 'For 24 hours', minutes: 1440 },
  { label: 'Until I turn it back on', minutes: null },
];

export function muteUntil(minutes: number | null): string {
  return minutes === null ? 'infinity' : new Date(Date.now() + minutes * 60_000).toISOString();
}

export function describeMute(row: NotificationSetting | undefined): string | null {
  if (!isMutedRow(row)) return null;
  const t = muteEnd(row);
  if (t > Date.now() + 365 * 86_400_000) return 'Muted';
  return `Muted until ${new Date(t).toLocaleString([], { hour: 'numeric', minute: '2-digit', weekday: 'short' })}`;
}
