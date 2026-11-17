/** Clips (2.4): the recorder controller, the background inbox, and library queries. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { autoDownloadAllowed, pruneSeeds, receiveClip, startSeeding, type ClipShare } from '../lib/clipShare';
import {
  canRecord,
  ffmpegReady,
  listClips,
  localCopies,
  recorderStatus,
  saveClip,
  startRecorder,
  stopRecorder,
  storedClips,
  sweepClips,
  sweepStored,
  useClipSettings,
  type ClipInfo,
  type RecorderStatus,
} from '../lib/clips';
import { chatKey } from '../lib/e2e';
import { liveChannel } from '../lib/live';
import { isTauri } from '../lib/platform';
import { notify } from '../lib/desktop';
import { useDetectedGame } from './useDesktop';
import { useSupabase } from '../lib/supabase';
import { playSound } from '../lib/sounds';
import { toast } from '../components/Toaster';
import { t } from '../lib/i18n';

/** Recorder state for the gallery header and settings. */
export function useRecorderStatus(): RecorderStatus | null {
  const [st, setSt] = useState<RecorderStatus | null>(null);
  useEffect(() => {
    if (!canRecord) return;
    let gone = false;
    const tick = () => void recorderStatus().then((s) => !gone && setSt(s), () => undefined);
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      gone = true;
      clearInterval(id);
    };
  }, []);
  return st;
}

let saving = false;
/** Tell the user, in the app or (when it's in the background, e.g. mid-game) as a Windows notification. */
function tell(title: string, body: string, ok: boolean) {
  if (document.hasFocus()) (ok ? toast.success : toast.error)(body ? `${title}: ${body}` : title);
  else void notify(title, body || ' ');
}

// Squad clips: the call you're in, so a clip can ask everyone else to save the same moment.
let squad: { channel: RealtimeChannel; me: string; name: string } | null = null;

/** Save a clip now (the hotkey, the tray and the "Clip it" buttons). */
export async function clipNow(qc?: ReturnType<typeof useQueryClient>, fromSquad?: { id: string; by: string }) {
  if (saving) return;
  saving = true;
  try {
    const cfg = useClipSettings.getState();
    if (!(await ffmpegReady())) return tell(t('Clipping isn’t set up'), t('Open Aether → Settings → Clips.'), false);
    const st = await recorderStatus().catch(() => null);
    if (!st?.running) {
      // Off (or stopped by itself): start it, so the next press has something to save.
      if (!cfg.s.enabled) cfg.set({ enabled: true });
      await startRecorder(cfg.s);
      return tell(t('Clipping started'), t('Aether is recording now. Press the clip key again to save.'), true);
    }
    const id = fromSquad?.id ?? crypto.randomUUID();
    if (!fromSquad && squad) void squad.channel.send({ type: 'broadcast', event: 'clip', payload: { id, by: squad.name, from: squad.me } });
    await saveClip(fromSquad ?? (squad ? { id, by: squad.name } : undefined));
    if (cfg.s.sound) playSound('messageSent', true);
    tell(fromSquad ? t('Squad clip saved') : t('Clip saved'), fromSquad ? t('{name} clipped, so your side of it was saved too.', { name: fromSquad.by }) : '', true);
    void qc?.invalidateQueries({ queryKey: ['clips'] });
  } catch (e) {
    tell(t('Couldn’t save the clip'), e instanceof Error ? e.message : String(e), false);
  } finally {
    saving = false;
  }
}

/** While you're in a call: when someone clips, save your side of the same moment too. */
export function useSquadClips(roomId: string | null, me: string, name: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  useEffect(() => {
    if (!canRecord || !roomId) return;
    const channel = sb.channel(`squadclip:${roomId}`);
    channel.on('broadcast', { event: 'clip' }, ({ payload }) => {
      const p = payload as { id: string; by: string; from: string };
      if (p.from === me || !useClipSettings.getState().s.enabled) return;
      void clipNow(qc, { id: p.id, by: p.by });
    });
    channel.subscribe();
    squad = { channel, me, name };
    return () => {
      if (squad?.channel === channel) squad = null;
      void sb.removeChannel(channel);
    };
  }, [sb, qc, roomId, me, name]);
}

/**
 * Runs the replay buffer: all the time (default), or only while a game is running.
 * Lives in the main layout of the Windows app.
 */
export function useClipRecorder() {
  const s = useClipSettings((x) => x.s);
  const qc = useQueryClient();
  const game = useDetectedGame((x) => x.game?.name ?? null);
  const settingsKey = JSON.stringify([s.fps, s.resolution, s.quality, s.seconds, s.mic, s.includeCalls, s.monitor, s.cursor, s.folder]);
  const running = useRef<string | null>(null);

  const want = canRecord && s.enabled && (s.mode === 'always' || !!game);
  useEffect(() => {
    if (!canRecord) return;
    let cancelled = false;
    void (async () => {
      if (!want) {
        if (running.current) {
          running.current = null;
          await stopRecorder();
        }
        return;
      }
      const st = await recorderStatus().catch(() => null);
      if (running.current === settingsKey && st?.running) return;
      if (!(await ffmpegReady())) return;
      try {
        await startRecorder(s);
        if (!cancelled) running.current = settingsKey;
      } catch (e) {
        tell(t('Clipping couldn’t start'), e instanceof Error ? e.message : String(e), false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [want, settingsKey]);

  // If recording stops on its own (a display change, a driver hiccup), start it again.
  useEffect(() => {
    if (!canRecord || !want) return;
    const id = setInterval(() => {
      void recorderStatus().then((st) => {
        if (!st.running && running.current) {
          running.current = null;
          void startRecorder(useClipSettings.getState().s).then(() => (running.current = settingsKey), () => undefined);
        }
      }, () => undefined);
    }, 30_000);
    return () => clearInterval(id);
  }, [want, settingsKey]);

  useEffect(() => () => void (running.current && stopRecorder()), []);

  // New clips refresh the gallery; the tray can save a clip or switch clipping on and off.
  useEffect(() => {
    if (!canRecord) return;
    const uns: (() => void)[] = [];
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      uns.push(await listen('clip-saved', () => void qc.invalidateQueries({ queryKey: ['clips'] })));
      uns.push(
        await listen<string>('tray-action', (e) => {
          if (e.payload === 'clip') void clipNow(qc);
          if (e.payload === 'clips-toggle') {
            const on = !useClipSettings.getState().s.enabled;
            useClipSettings.getState().set({ enabled: on });
            tell(on ? t('Clipping on') : t('Clipping off'), on ? t('Press the clip key to save the last moments.') : '', true);
          }
        }),
      );
    });
    return () => uns.forEach((u) => u());
  }, [qc]);
}

export function useClipLibrary() {
  return useQuery({
    queryKey: ['clips', 'local'],
    enabled: isTauri,
    staleTime: 10_000,
    queryFn: () => (canRecord ? listClips() : Promise.resolve([] as ClipInfo[])),
  });
}
export function useStoredClips() {
  return useQuery({ queryKey: ['clips', 'stored'], enabled: !isTauri, queryFn: () => storedClips() });
}

export function useClipShare(id: string | null | undefined) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['clip-share', id],
    enabled: !!id,
    staleTime: 30_000,
    refetchInterval: (q) => ((q.state.data as ClipShare | undefined)?.status === 'uploading' ? 4000 : false),
    queryFn: async () => {
      const { data, error } = await sb.from('clip_shares').select('*').eq('id', id!).maybeSingle();
      if (error) throw new Error(error.message);
      return data as ClipShare | null;
    },
  });
}

async function senderName(sb: ReturnType<typeof useSupabase>, id: string) {
  const { data } = await sb.from('users').select('display_name, username').eq('id', id).maybeSingle();
  return (data as { display_name: string | null; username: string } | null)?.display_name || (data as { username?: string } | null)?.username || 'Someone';
}

/** Download a shared clip now (cards' "Download" button and the background inbox). */
export async function getClip(sb: ReturnType<typeof useSupabase>, me: string, share: ClipShare) {
  const conv = await sb.from('conversations').select('id').eq('id', share.scope_id).maybeSingle();
  const key = share.e2e && conv.data ? await chatKey(sb, me, share.scope_id) : null;
  await receiveClip(sb, me, share, key, await senderName(sb, share.sender_id));
}

/**
 * Background work: downloads new clips shared with you (when the setting allows), deletes
 * expired temporary clips, and sends your shared clips directly to people who ask.
 */
export function useClipInbox(me: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  useEffect(() => {
    let stopped = false;
    const queue: ClipShare[] = [];
    let working = false;
    const pump = async () => {
      if (working) return;
      working = true;
      while (queue.length && !stopped) {
        const share = queue.shift()!;
        try {
          await getClip(sb, me, share);
          void qc.invalidateQueries({ queryKey: ['clips'] });
        } catch {
          // Shown on the card; it can be retried there.
        }
      }
      working = false;
    };
    const consider = (rows: ClipShare[], received: Set<string>) => {
      if (!autoDownloadAllowed()) return;
      const have = localCopies();
      for (const r of rows) {
        if (r.sender_id === me || r.status === 'gone' || have[r.id] || received.has(r.id) || queue.some((q) => q.id === r.id)) continue;
        queue.push(r);
      }
      void pump();
    };
    const scan = async () => {
      const since = new Date(Date.now() - 72 * 3600_000).toISOString();
      const { data } = await sb.from('clip_shares').select('*').neq('sender_id', me).neq('status', 'gone').gt('created_at', since).order('created_at').limit(50);
      const rows = (data ?? []) as ClipShare[];
      if (!rows.length) return;
      const { data: rec } = await sb.from('clip_receipts').select('share_id').eq('user_id', me).in('share_id', rows.map((r) => r.id));
      consider(rows, new Set(((rec ?? []) as { share_id: string }[]).map((r) => r.share_id)));
    };
    const sweep = () => void (canRecord ? sweepClips().then((n) => void (n && qc.invalidateQueries({ queryKey: ['clips'] }))) : sweepStored()).catch(() => undefined);
    const first = setTimeout(() => {
      void scan();
      sweep();
      void pruneSeeds();
    }, 5000);
    const hourly = setInterval(() => {
      sweep();
      void pruneSeeds();
    }, 3600_000);
    const stopLive = liveChannel(
      sb,
      `clips:${me}`,
      (c) =>
        c.on('postgres_changes', { event: '*', schema: 'public', table: 'clip_shares' }, (p) => {
          const row = p.new as ClipShare | undefined;
          if (row?.id) {
            qc.setQueryData(['clip-share', row.id], row);
            consider([row], new Set());
          }
        }),
      () => void scan(),
    );
    const stopSeeding = startSeeding(sb, me);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(hourly);
      stopLive();
      stopSeeding();
    };
  }, [sb, me, qc]);
}
