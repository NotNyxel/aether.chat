/**
 * Clips (2.4), app side: settings, the recorder (Windows app), saving with the game (and the
 * Roblox experience), and where clips live: files on a PC, browser storage on phones and the web
 * (received clips only; recording needs the Windows app). See src-tauri/src/clips.rs.
 */
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isTauri } from './platform';

export const canRecord = isTauri && /Windows/i.test(navigator.userAgent);

export interface ClipSettings {
  enabled: boolean;
  /** Record only while a game is running, or all the time. */
  mode: 'games' | 'always';
  fps: number;
  resolution: 'native' | '2160' | '1440' | '1080' | '720';
  quality: 'high' | 'medium' | 'low';
  seconds: number;
  mic: boolean;
  includeCalls: boolean;
  monitor: number;
  cursor: boolean;
  folder: string;
  sound: boolean;
  /** Only the game's window (when a game is running), or the whole screen. */
  capture: 'game' | 'screen';
  /** Microphone volume in clips, in percent. */
  micVolume: number;
  /** Send every new clip to your other devices. */
  syncDevices: boolean;
  /** Received clips: download in the background ("smart": computers and Wi-Fi), always, or when tapped. */
  autoDownload: 'smart' | 'always' | 'tap';
  /** Received clips delete themselves after this many days unless kept (0 = keep). */
  keepDays: number;
}

export const DEFAULT_CLIP_SETTINGS: ClipSettings = {
  enabled: false,
  mode: 'always',
  fps: 60,
  resolution: '1080',
  quality: 'medium',
  seconds: 30,
  mic: true,
  includeCalls: false,
  monitor: 0,
  cursor: false,
  folder: '',
  sound: true,
  capture: 'game',
  micVolume: 100,
  syncDevices: false,
  autoDownload: 'smart',
  keepDays: 7,
};

/** Clip settings are per device (the folder and screen differ), so they don't sync. */
export const useClipSettings = create<{ s: ClipSettings; set: (p: Partial<ClipSettings>) => void }>()(
  persist(
    (set) => ({ s: DEFAULT_CLIP_SETTINGS, set: (p) => set((st) => ({ s: { ...st.s, ...p } })) }),
    {
      name: 'aether.clips',
      version: 2,
      // 2.4.1: record all the time by default (game detection can miss games).
      migrate: (p, from) => {
        const st = (p ?? {}) as { s?: Partial<ClipSettings> };
        if (from < 2 && st.s) st.s.mode = 'always';
        return st as never;
      },
      storage: createJSONStorage(() => localStorage),
      merge: (p, c) => ({ ...c, s: { ...DEFAULT_CLIP_SETTINGS, ...((p as { s?: ClipSettings })?.s ?? {}) } }) },
  ),
);

export interface ClipMeta {
  aether?: number;
  game?: string | null;
  detail?: string | null;
  created?: number;
  fps?: number;
  duration?: number;
  mic?: boolean;
  /** Received clips. */
  received?: boolean;
  from?: string;
  shareId?: string;
  /** When a temporary received clip deletes itself (ms). Missing = kept. */
  expires?: number | null;
  favorite?: boolean;
}

export interface ClipInfo {
  path: string;
  file: string;
  title: string;
  meta: ClipMeta;
  duration: number;
  width: number;
  height: number;
  fps: number;
  size: number;
  modified: number;
  audio_tracks: string[];
  thumb: string | null;
  received: boolean;
}

// ── Recorder ──────────────────────────────────────────────────────────────────────────────────

export const ffmpegReady = () => (canRecord ? invoke<boolean>('clips_ready') : Promise.resolve(false));
export const installFfmpeg = () => invoke<void>('clips_install_ffmpeg');
export const defaultFolder = () => invoke<string>('clips_default_folder');
export const pickFolder = () => invoke<string | null>('clips_pick_folder');
export interface RecorderStatus {
  running: boolean;
  encoder: string | null;
  seconds: number;
  since: number;
  /** Recording just the game's window. */
  window: boolean;
}
export const recorderStatus = () => invoke<RecorderStatus>('clips_status');

export async function startRecorder(s: ClipSettings, gameExe: string | null = null) {
  const folder = s.folder || (await defaultFolder());
  await invoke('clips_start', {
    settings: { fps: Math.round(s.fps), resolution: s.resolution, quality: s.quality, seconds: s.seconds, mic: s.mic, include_calls: s.includeCalls, monitor: s.monitor, cursor: s.cursor, folder, capture: s.capture, game_exe: gameExe, mic_volume: Math.round(s.micVolume) },
  });
}
export const stopRecorder = () => invoke<void>('clips_stop');

/** The game being played, and for Roblox, which experience (the always-on detector, else a fresh look). */
export async function currentGame(): Promise<{ game: string | null; detail: string | null }> {
  const { useDetectedGame, detectRunningGame } = await import('../hooks/useDesktop');
  const known = useDetectedGame.getState().game;
  if (known) return { game: known.name, detail: known.detail };
  const found = await detectRunningGame().catch(() => null);
  return { game: found?.name ?? null, detail: found?.detail ?? null };
}

export async function saveClip(squad?: { id: string; by: string }): Promise<string> {
  const { game, detail } = await currentGame();
  const micVolume = Math.round(useClipSettings.getState().s.micVolume);
  return invoke<string>('clips_save', { input: { game, detail, squad: squad?.id ?? null, squad_by: squad?.by ?? null, mic_volume: micVolume } });
}

// ── Library (PC) ──────────────────────────────────────────────────────────────────────────────

export async function listClips(): Promise<ClipInfo[]> {
  const folder = useClipSettings.getState().s.folder || (await defaultFolder());
  return invoke<ClipInfo[]>('clips_list', { folder });
}
export const deleteClip = (path: string) => invoke<void>('clips_delete', { path });
export const setClipMeta = (path: string, meta: Partial<ClipMeta> | Record<string, unknown>, title?: string) => invoke<void>('clips_set_meta', { path, meta, title: title ?? null });
export interface ExportOptions {
  path: string;
  start: number;
  end: number;
  gameAudio: boolean;
  mic: boolean;
  title?: string;
  quality: 'original' | 'high' | 'saver';
  out: 'replace' | 'copy' | 'temp';
  meta?: Partial<ClipMeta>;
}
export const exportClip = (o: ExportOptions) =>
  invoke<string>('clips_export', { input: { path: o.path, start: o.start, end: o.end, game_audio: o.gameAudio, mic: o.mic, title: o.title ?? null, quality: o.quality, out: o.out, meta: o.meta ?? null } });
export const sweepClips = async () => {
  const folder = useClipSettings.getState().s.folder || (await defaultFolder());
  return invoke<number>('clips_sweep', { folder });
};
export const fileSize = (path: string) => invoke<number>('clips_file_size', { path });
export const hashFile = (path: string) => invoke<string>('clips_hash', { path });
export const readChunk = async (path: string, offset: number, len: number) => new Uint8Array(await invoke<ArrayBuffer>('clips_read', { path, offset, len }));
export const writeChunk = (path: string, offset: number, bytes: Uint8Array) => invoke<void>('clips_write', bytes, { headers: { path: encodeURIComponent(path), offset: String(offset) } });

/** A local file as something the page can show (asset protocol). */
export async function fileUrl(path: string): Promise<string> {
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return convertFileSrc(path);
}

export async function receivedPath(title: string, from: string): Promise<string> {
  const folder = useClipSettings.getState().s.folder || (await defaultFolder());
  const safe = `${title} - ${from}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim().slice(0, 80) || 'Clip';
  return `${folder}\\Received\\${safe} ${Date.now().toString(36)}.mp4`;
}

// ── Library (phones and the web): received clips in IndexedDB ────────────────────────────────

export interface StoredClip {
  shareId: string;
  title: string;
  game: string | null;
  detail: string | null;
  from: string;
  duration: number;
  size: number;
  width: number;
  height: number;
  created: number;
  expires: number | null;
  thumb?: Blob;
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('aether-clips', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('meta', { keyPath: 'shareId' });
      r.result.createObjectStore('files');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(store: 'meta' | 'files', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const storedClips = () => tx<StoredClip[]>('meta', 'readonly', (s) => s.getAll() as IDBRequest<StoredClip[]>);
export const storedFile = (id: string) => tx<Blob | undefined>('files', 'readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);
export async function storeClip(meta: StoredClip, file: Blob) {
  await tx('files', 'readwrite', (s) => s.put(file, meta.shareId));
  await tx('meta', 'readwrite', (s) => s.put(meta));
}
export async function updateStored(id: string, patch: Partial<StoredClip>) {
  const cur = await tx<StoredClip | undefined>('meta', 'readonly', (s) => s.get(id) as IDBRequest<StoredClip | undefined>);
  if (cur) await tx('meta', 'readwrite', (s) => s.put({ ...cur, ...patch }));
}
export async function removeStored(id: string) {
  await tx('files', 'readwrite', (s) => s.delete(id));
  await tx('meta', 'readwrite', (s) => s.delete(id));
}
export async function sweepStored() {
  const now = Date.now();
  for (const c of await storedClips().catch(() => [])) if (c.expires && c.expires < now) await removeStored(c.shareId);
}

// ── Which shares this device already has ──────────────────────────────────────────────────────

const HAVE = 'aether.clips.have';
/** shareId → local path (PC) or "idb" (phone/web). */
export function localCopies(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(HAVE) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}
export function rememberLocal(shareId: string, where: string) {
  try {
    localStorage.setItem(HAVE, JSON.stringify({ ...localCopies(), [shareId]: where }));
  } catch {
    /* storage blocked */
  }
}
export function forgetLocal(shareId: string) {
  const all = localCopies();
  delete all[shareId];
  try {
    localStorage.setItem(HAVE, JSON.stringify(all));
  } catch {
    /* storage blocked */
  }
}

export const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export const fmtSize = (n: number) => (n <= 0 ? '0 KB' : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
