/**
 * Reminders (2.0): "remind me about this message" from the message menu. Listed in Inbox →
 * Reminders, and when one is due the app plays a sound, shows a toast and a system notification
 * that jumps to the message. Each reminder fires once, even with Aether open on several devices
 * (the device that marks it done first is the one that shows it).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSupabase } from '../lib/supabase';
import type { Message } from '../types/db';

export interface Reminder {
  id: string;
  message_id: string | null;
  scope_id: string | null;
  server_id: string | null;
  note: string | null;
  remind_at: string;
  done_at: string | null;
  messages: Message | null;
}

export function useReminders(enabled = true) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['reminders'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data, error } = await sb
        .from('reminders')
        .select('id, message_id, scope_id, server_id, note, remind_at, done_at, messages(*)')
        .or(`done_at.is.null,done_at.gte.${since}`)
        .order('remind_at')
        .limit(200);
      if (error) throw new Error(error.message);
      return data as unknown as Reminder[];
    },
  });
}

export function useReminderActions() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['reminders'] });
  return {
    add: useMutation({
      mutationFn: async ({ message, serverId, at, note }: { message: Message; serverId: string | null; at: Date; note?: string }) => {
        const { error } = await sb.from('reminders').insert({
          message_id: message.id,
          scope_id: message.channel_id ?? message.conversation_id,
          server_id: serverId,
          remind_at: at.toISOString(),
          note: note?.trim().slice(0, 300) || null,
        });
        if (error) throw new Error(error.message.includes('row-level') ? 'You have too many reminders. Clear some in Inbox → Reminders.' : error.message);
      },
      onSuccess: refresh,
    }),
    done: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await sb.from('reminders').update({ done_at: new Date().toISOString() }).eq('id', id);
        if (error) throw new Error(error.message);
      },
      onMutate: (id) => qc.setQueryData<Reminder[]>(['reminders'], (rows) => rows?.map((r) => (r.id === id ? { ...r, done_at: new Date().toISOString() } : r))),
      onSettled: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await sb.from('reminders').delete().eq('id', id);
        if (error) throw new Error(error.message);
      },
      onMutate: (id) => qc.setQueryData<Reminder[]>(['reminders'], (rows) => rows?.filter((r) => r.id !== id)),
      onSettled: refresh,
    }),
    snooze: useMutation({
      mutationFn: async ({ id, at }: { id: string; at: Date }) => {
        const { error } = await sb.from('reminders').update({ remind_at: at.toISOString(), done_at: null }).eq('id', id);
        if (error) throw new Error(error.message);
      },
      onSettled: refresh,
    }),
  };
}

/** Preset times for the "Remind me" menu. */
export function reminderPresets(now = new Date()): { label: string; at: Date }[] {
  const at = (h: number, addDays = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + addDays);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const list = [
    { label: 'In 20 minutes', at: new Date(now.getTime() + 20 * 60_000) },
    { label: 'In 1 hour', at: new Date(now.getTime() + 3_600_000) },
    { label: 'In 3 hours', at: new Date(now.getTime() + 3 * 3_600_000) },
  ];
  if (now.getHours() < 18) list.push({ label: 'This evening', at: at(19) });
  list.push({ label: 'Tomorrow morning', at: at(9, 1) });
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  list.push({ label: 'Next week', at: at(9, toMonday) });
  return list;
}

/** "45m", "2h", "3 days", "1d 4h" → a time from now, or null. */
export function parseReminderIn(text: string, now = Date.now()): Date | null {
  let ms = 0;
  for (const m of text.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)\b/g)) {
    const n = Number(m[1]);
    const u = m[2]![0];
    ms += n * (u === 'm' ? 60_000 : u === 'h' ? 3_600_000 : u === 'd' ? 86_400_000 : 7 * 86_400_000);
  }
  return ms > 0 && ms <= 366 * 86_400_000 ? new Date(now + ms) : null;
}

export function whenText(iso: string): string {
  const d = new Date(iso);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Tomorrow at ${time}`;
  if (days === -1) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

/** Mounted once in the main layout: fires due reminders while the app is open. */
export function useReminderWatcher(onDue: (r: Reminder) => void) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const { data } = useReminders();
  useEffect(() => {
    const pending = (data ?? []).filter((r) => !r.done_at);
    if (!pending.length) return;
    const fire = async (r: Reminder) => {
      // Claim it: only the device whose update changes the row shows the reminder.
      const { data: claimed } = await sb.from('reminders').update({ done_at: new Date().toISOString() }).eq('id', r.id).is('done_at', null).select('id');
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      if (!claimed?.length) return;
      onDue(r);
    };
    const timers = pending.map((r) => {
      const wait = new Date(r.remind_at).getTime() - Date.now();
      // Timers longer than ~24 days overflow; the list is refetched long before then anyway.
      return wait > 2_000_000_000 ? undefined : setTimeout(() => void fire(r), Math.max(0, wait));
    });
    return () => timers.forEach((t) => t && clearTimeout(t));
  }, [data, sb, qc, onDue]);
  // Refresh every 10 minutes so reminders set on another device are picked up.
  useEffect(() => {
    const t = setInterval(() => void qc.invalidateQueries({ queryKey: ['reminders'] }), 10 * 60_000);
    return () => clearInterval(t);
  }, [qc]);
}
