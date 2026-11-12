/**
 * Desktop integration: native notifications, taskbar badge and flashing, the system tray,
 * start on boot, background (global) shortcuts, idle time and game detection.
 *
 * Every function works in a plain browser too: it falls back to the web equivalent or does nothing.
 * Tauri modules are imported lazily so the web build never loads them.
 */
import { isTauri } from './platform';

// ── Notifications ───────────────────────────────────────────────────────────────────────────

let permission: Promise<boolean> | null = null;

async function canNotify(): Promise<boolean> {
  permission ??= (async () => {
    if (isTauri) {
      const n = await import('@tauri-apps/plugin-notification');
      if (await n.isPermissionGranted()) return true;
      return (await n.requestPermission()) === 'granted';
    }
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  })().catch(() => false);
  const ok = await permission;
  if (!ok) permission = null; // ask again next time (the user may have changed it in Windows)
  return ok;
}

/** Shows an OS notification. `onClick` only works in the browser; on desktop clicking focuses the app. */
export async function notify(title: string, body: string, onClick?: () => void): Promise<void> {
  if (!(await canNotify())) return;
  if (isTauri) {
    const n = await import('@tauri-apps/plugin-notification');
    n.sendNotification({ title, body });
    return;
  }
  const note = new Notification(title, { body, icon: '/icon.svg', silent: true });
  note.onclick = () => {
    window.focus();
    onClick?.();
    note.close();
  };
}

// ── Taskbar ─────────────────────────────────────────────────────────────────────────────────

const BASE_TITLE = 'Aether';
let lastBadge = -1;

/** Red count overlay on the taskbar icon (Windows) and "(n)" in the window title. */
export async function setBadge(count: number): Promise<void> {
  if (count === lastBadge) return;
  lastBadge = count;
  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${BASE_TITLE}` : BASE_TITLE;
  if (!isTauri) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (count <= 0) {
      await win.setOverlayIcon(undefined);
      return;
    }
    const { Image } = await import('@tauri-apps/api/image');
    await win.setOverlayIcon(await Image.fromBytes(await badgePng(count)));
  } catch {
    // overlay icons are Windows-only; ignore elsewhere
  }
}

async function badgePng(count: number): Promise<Uint8Array> {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ed4245';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const label = count > 9 ? '9+' : String(count);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${label.length > 1 ? 17 : 21}px Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 1);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Flashes the taskbar button until the window is focused (incoming calls). */
export async function flashTaskbar(): Promise<void> {
  if (!isTauri || document.hasFocus()) return;
  try {
    const { getCurrentWindow, UserAttentionType } = await import('@tauri-apps/api/window');
    await getCurrentWindow().requestUserAttention(UserAttentionType.Critical);
  } catch {
    // not supported
  }
}

// ── Tray, start on boot ─────────────────────────────────────────────────────────────────────

export async function setCloseToTray(enabled: boolean): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_close_to_tray', { enabled });
}

/** Runs `handler` for "Toggle mute" / "Toggle deafen" in the tray menu. Returns an unsubscribe. */
export function onTrayAction(handler: (action: 'mute' | 'deafen') => void): () => void {
  if (!isTauri) return () => undefined;
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen<'mute' | 'deafen'>('tray-action', (e) => handler(e.payload)).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    }),
  );
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export async function getAutostart(): Promise<boolean> {
  if (!isTauri) return false;
  const { isEnabled } = await import('@tauri-apps/plugin-autostart');
  return isEnabled();
}

export async function setAutostart(on: boolean): Promise<void> {
  if (!isTauri) return;
  const a = await import('@tauri-apps/plugin-autostart');
  if (on) await a.enable();
  else await a.disable();
}

// ── Global shortcuts ────────────────────────────────────────────────────────────────────────

/** "Ctrl+Shift+KeyM" (our format, physical key codes) → "Control+Shift+KeyM" (global-hotkey format). */
export function toGlobalShortcut(combo: string): string {
  return combo
    .split('+')
    .map((p) => (p === 'Ctrl' ? 'Control' : p === 'Meta' ? 'Super' : p))
    .join('+');
}

export interface GlobalBinding {
  combo: string;
  onPress: () => void;
  onRelease?: () => void;
}

/**
 * Registers system-wide shortcuts. Returns the combos that registered (another app may already
 * own a combo) and a cleanup function.
 */
export async function registerGlobalShortcuts(bindings: GlobalBinding[]): Promise<{ registered: string[]; failed: string[]; dispose: () => Promise<void> }> {
  const registered: string[] = [];
  const failed: string[] = [];
  if (!isTauri || bindings.length === 0) return { registered, failed, dispose: async () => undefined };
  const gs = await import('@tauri-apps/plugin-global-shortcut');
  for (const b of bindings) {
    const accel = toGlobalShortcut(b.combo);
    try {
      await gs.register(accel, (e) => {
        if (e.state === 'Pressed') b.onPress();
        else b.onRelease?.();
      });
      registered.push(b.combo);
    } catch {
      failed.push(b.combo);
    }
  }
  return {
    registered,
    failed,
    dispose: async () => {
      for (const combo of registered) await gs.unregister(toGlobalShortcut(combo)).catch(() => undefined);
    },
  };
}

// ── Idle time and running games ─────────────────────────────────────────────────────────────

let lastWebInput = Date.now();
if (typeof window !== 'undefined') {
  const bump = () => (lastWebInput = Date.now());
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, bump, { passive: true });
}

/** Seconds since the last keyboard/mouse input: system-wide on desktop, inside the page in a browser. */
export async function idleSeconds(): Promise<number> {
  if (!isTauri) return Math.floor((Date.now() - lastWebInput) / 1000);
  const { invoke } = await import('@tauri-apps/api/core');
  const system = await invoke<number>('idle_seconds').catch(() => Number.MAX_SAFE_INTEGER);
  // macOS and Linux builds can't read system idle time yet: use input inside the app instead.
  return system > 1e12 ? Math.floor((Date.now() - lastWebInput) / 1000) : system;
}

export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  position_ms: number;
  duration_ms: number;
  playing: boolean;
}

/** The track Spotify is playing (desktop only, via Windows' media session API). */
export async function nowPlaying(): Promise<NowPlaying | null> {
  if (!isTauri) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<NowPlaying | null>('now_playing');
}

/** Lower-cased executable names currently running (desktop only). */
export async function runningProcesses(): Promise<string[]> {
  if (!isTauri) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string[]>('running_processes');
}
