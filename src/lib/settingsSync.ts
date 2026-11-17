/**
 * Settings sync (2.3): keeps app settings the same on every device you sign in on.
 *
 * Sections (theme, a11y, sounds, …) are stored per account in public.user_settings with the time
 * they last changed. On start, on window focus and live over Realtime, any section that's newer on
 * the server replaces the local one; any section changed here since the last sync is pushed.
 * save_settings() keeps the newer copy of each section, so devices never undo each other.
 *
 * Not synced on purpose: microphone/camera/screen-share devices and window/tray options (they
 * depend on the machine), and the backend profile accent (comes from your profile).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect } from 'react';
import { DEFAULT_A11Y, DEFAULT_ACTIVITY, DEFAULT_KEYBINDS, DEFAULT_NOTIFICATIONS, DEFAULT_SOUNDS, DEFAULT_THEME, useSettingsStore } from '../stores/settingsStore';
import { liveChannel } from './live';
import { useSupabase } from './supabase';

type Remote = Record<string, { v: unknown; at: number }>;
type Meta = Record<string, { at: number; hash: string }>;

/** Browser-storage settings that belong to the account, not the device. */
const localKeys = (me: string) => ['aether.lang', 'aether.recentColors', 'aether.dmProfilePanel', `aether.voice.volumes.${me}`];

function readLocal(me: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const k of localKeys(me)) {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    }
  } catch {
    /* storage blocked */
  }
  return out;
}

function snapshot(me: string): Record<string, unknown> {
  const s = useSettingsStore.getState();
  return {
    theme: s.theme,
    a11y: s.a11y,
    sounds: s.sounds,
    notifications: s.notifications,
    keybinds: s.keybinds,
    activity: s.activity,
    prefs: { e2eAuto: s.e2eAuto, secretsUnlocked: s.secretsUnlocked },
    local: readLocal(me),
  };
}

/** JSON with sorted keys, so the same settings always hash the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function apply(me: string, section: string, v: unknown) {
  if (!v || typeof v !== 'object') return;
  const st = useSettingsStore;
  const o = v as Record<string, unknown>;
  switch (section) {
    case 'theme':
      st.setState({ theme: { ...DEFAULT_THEME, ...(o as object) } });
      break;
    case 'a11y':
      st.setState({ a11y: { ...DEFAULT_A11Y, ...(o as object) } });
      break;
    case 'sounds':
      st.setState({ sounds: { ...DEFAULT_SOUNDS, ...(o as object) } });
      break;
    case 'notifications':
      st.setState({ notifications: { ...DEFAULT_NOTIFICATIONS, ...(o as object) } });
      break;
    case 'keybinds':
      st.setState({ keybinds: { ...DEFAULT_KEYBINDS, ...(o as object) } });
      break;
    case 'activity':
      st.setState({ activity: { ...DEFAULT_ACTIVITY, ...(o as object) } });
      break;
    case 'prefs':
      st.setState({
        ...(typeof o.e2eAuto === 'boolean' ? { e2eAuto: o.e2eAuto } : {}),
        ...(Array.isArray(o.secretsUnlocked) ? { secretsUnlocked: o.secretsUnlocked as never } : {}),
      });
      break;
    case 'local':
      try {
        // The language takes effect the next time Aether starts (switching reloads the window).
        for (const k of localKeys(me)) {
          const val = o[k];
          if (typeof val === 'string') localStorage.setItem(k, val);
        }
      } catch {
        /* storage blocked */
      }
      break;
  }
}

const metaKey = (me: string) => `aether.sync.${me}`;
function readMeta(me: string): Meta {
  try {
    return JSON.parse(localStorage.getItem(metaKey(me)) ?? '{}') as Meta;
  } catch {
    return {};
  }
}
function writeMeta(me: string, m: Meta) {
  try {
    localStorage.setItem(metaKey(me), JSON.stringify(m));
  } catch {
    /* storage blocked: we'll just re-sync next time */
  }
}

/** Take anything newer from the server. */
export function pull(me: string, remote: Remote) {
  const meta = readMeta(me);
  let changed = false;
  for (const [section, r] of Object.entries(remote)) {
    if (!r || typeof r.at !== 'number' || r.at <= (meta[section]?.at ?? 0)) continue;
    apply(me, section, r.v);
    meta[section] = { at: r.at, hash: stable(snapshot(me)[section]) };
    changed = true;
  }
  if (changed) writeMeta(me, meta);
}

/** Send every section that changed here since it was last synced. */
export async function push(sb: SupabaseClient, me: string) {
  const meta = readMeta(me);
  const snap = snapshot(me);
  const patch: Remote = {};
  const now = Date.now();
  for (const [section, v] of Object.entries(snap)) {
    const hash = stable(v);
    if (meta[section]?.hash === hash) continue;
    patch[section] = { v, at: now };
    meta[section] = { at: now, hash };
  }
  if (!Object.keys(patch).length) return;
  const { data, error } = await sb.rpc('save_settings', { p_patch: patch });
  if (error) return; // offline or signed out: the hashes stay stale, so we retry next time
  writeMeta(me, meta);
  // The server keeps the newer copy; if another device won a section, take it.
  pull(me, data as Remote);
}

export function useSettingsSync(me: string | null | undefined) {
  const sb = useSupabase();
  useEffect(() => {
    if (!me) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ready = false;
    const schedule = () => {
      if (!ready) return;
      clearTimeout(timer);
      timer = setTimeout(() => void push(sb, me), 1500);
    };
    const refresh = async () => {
      const { data } = await sb.from('user_settings').select('data').eq('user_id', me).maybeSingle();
      if (stopped) return;
      if (data?.data) pull(me, data.data as Remote);
      ready = true;
      await push(sb, me);
    };
    void refresh();
    const unsub = useSettingsStore.subscribe(schedule);
    // Browser-storage settings change without events in this tab; check them now and then.
    let lastLocal = stable(readLocal(me));
    const poll = setInterval(() => {
      const now = stable(readLocal(me));
      if (now !== lastLocal) {
        lastLocal = now;
        schedule();
      }
    }, 4000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const stopLive = liveChannel(
      sb,
      `settings:${me}`,
      (c) =>
        c.on('postgres_changes', { event: '*', schema: 'public', table: 'user_settings', filter: `user_id=eq.${me}` }, (p) => {
          const row = p.new as { data?: Remote } | null;
          if (row?.data) pull(me, row.data);
        }),
      () => void refresh(),
    );
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(poll);
      unsub();
      window.removeEventListener('focus', onFocus);
      stopLive();
    };
  }, [sb, me]);
}
