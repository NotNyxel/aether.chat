/**
 * Watch together: a shared YouTube player for a chat (channel, DM or group). Start one from the TV
 * button in the chat header by pasting a YouTube link. Everyone in the chat sees a bar to join;
 * play, pause, seeking and changing the video are shared through public.watch_parties.
 *
 * Sync: the row stores where the video was and when (position + updated_at) and whether it's
 * playing. Each viewer works out where it should be now and corrects itself if it's off by more
 * than ~2 seconds. Your own play/pause/seek is written back for everyone.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useProfile } from '../hooks/useChatData';
import { liveChannel } from '../lib/live';
import { useSupabase } from '../lib/supabase';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, PlayIcon, TvIcon } from './icons';
import { toast } from './Toaster';

interface Party {
  scope_id: string;
  video_id: string;
  title: string | null;
  playing: boolean;
  position: number;
  started_by: string | null;
  updated_by: string | null;
  updated_at: string;
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  getVideoData?(): { video_id?: string; title?: string };
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let api: Promise<void> | null = null;
function loadYouTube(): Promise<void> {
  api ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => reject(new Error('Could not load the YouTube player.'));
    document.head.appendChild(s);
  });
  return api;
}

/** The video id from any YouTube link (watch, youtu.be, shorts, embed, live) or a bare id. */
export function youtubeId(input: string): string | null {
  const t = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(t);
  return m?.[1] ?? null;
}

const expected = (p: Party) => (p.playing ? p.position + Math.max(0, (Date.now() - new Date(p.updated_at).getTime()) / 1000) : p.position);

export function useWatchParty(scopeId: string) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const key = ['watch-party', scopeId];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data } = await sb.from('watch_parties').select('*').eq('scope_id', scopeId).maybeSingle();
      return (data as Party | null) ?? null;
    },
  });
  useEffect(
    () =>
      liveChannel(
        sb,
        `watch:${scopeId}`,
        (c) =>
          c.on('postgres_changes', { event: '*', schema: 'public', table: 'watch_parties', filter: `scope_id=eq.${scopeId}` }, (p) =>
            qc.setQueryData(['watch-party', scopeId], p.eventType === 'DELETE' ? null : (p.new as Party)),
          ),
        () => void qc.invalidateQueries({ queryKey: ['watch-party', scopeId] }),
      ),
     
    [scopeId, sb],
  );
  return q.data ?? null;
}

async function oembedTitle(id: string): Promise<string | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
    return r.ok ? (((await r.json()) as { title?: string }).title ?? null) : null;
  } catch {
    return null;
  }
}

/** Header button: start a watch party (or show the one that's on). */
export function WatchButton({ scopeId, onOpen }: { scopeId: string; onOpen: () => void }) {
  const party = useWatchParty(scopeId);
  return (
    <button type="button" data-tip={party ? 'Watching together' : 'Watch together'} aria-label="Watch together" onClick={onOpen} className={`relative ${party ? 'text-ae-accent' : 'opacity-60 hover:opacity-100'}`}>
      <TvIcon size={17} />
      {party?.playing && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-ae-danger" />}
    </button>
  );
}

/** The panel above the messages: a "join" bar, the player, or the box to start one. */
export function WatchPanel({ scopeId, open, onOpenChange }: { scopeId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const sb = useSupabase();
  const party = useWatchParty(scopeId);
  const { data: starter } = useProfile(party?.started_by ?? null);
  const [link, setLink] = useState('');
  const [joined, setJoined] = useState(false);
  const [small, setSmall] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const applyingUntil = useRef(0);
  const partyRef = useRef(party);
  partyRef.current = party;

  // The party ended (or none yet): close the player.
  useEffect(() => {
    if (!party) {
      setJoined(false);
      player.current?.destroy();
      player.current = null;
    }
  }, [party]);

  const write = async (patch: Partial<Pick<Party, 'playing' | 'position' | 'video_id' | 'title'>>) => {
    const { error } = await sb.from('watch_parties').update(patch).eq('scope_id', scopeId);
    if (error) toast.error(error.message);
  };

  const start = async () => {
    const id = youtubeId(link);
    if (!id) return toast.error('Paste a YouTube link (youtube.com/watch?v=… or youtu.be/…).');
    const title = await oembedTitle(id);
    const { error } = party
      ? await sb.from('watch_parties').update({ video_id: id, title, position: 0, playing: true }).eq('scope_id', scopeId)
      : await sb.from('watch_parties').insert({ scope_id: scopeId, video_id: id, title, position: 0, playing: true });
    if (error) return toast.error(error.message);
    setLink('');
    setJoined(true);
    onOpenChange(true);
  };

  // Create the player once joined.
  useEffect(() => {
    if (!joined || !party || !holder.current || player.current) return;
    let gone = false;
    void loadYouTube()
      .then(() => {
        if (gone || !holder.current || !window.YT) return;
        const el = document.createElement('div');
        holder.current.replaceChildren(el);
        applyingUntil.current = Date.now() + 2500;
        player.current = new window.YT.Player(el, {
          host: 'https://www.youtube-nocookie.com',
          videoId: party.video_id,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(expected(party)), autoplay: party.playing ? 1 : 0 },
          events: {
            onStateChange: (e: { data: number }) => {
              const p = partyRef.current;
              if (!p || Date.now() < applyingUntil.current) return;
              const t = player.current?.getCurrentTime() ?? 0;
              if (e.data === 1 && !p.playing) void write({ playing: true, position: t });
              if (e.data === 2 && p.playing) void write({ playing: false, position: t });
            },
          },
        });
      })
      .catch((e: Error) => toast.error(e.message));
    return () => {
      gone = true;
    };
     
  }, [joined, !!party]);

  // Follow the shared state.
  useEffect(() => {
    const pl = player.current;
    if (!pl || !party) return;
    const data = pl.getVideoData?.();
    applyingUntil.current = Date.now() + 1200;
    if (data?.video_id && data.video_id !== party.video_id) {
      pl.loadVideoById({ videoId: party.video_id, startSeconds: expected(party) });
      if (!party.playing) setTimeout(() => pl.pauseVideo(), 800);
      return;
    }
    if (Math.abs(pl.getCurrentTime() - expected(party)) > 2) pl.seekTo(expected(party), true);
    const state = pl.getPlayerState();
    if (party.playing && state !== 1 && state !== 3) pl.playVideo();
    if (!party.playing && state === 1) pl.pauseVideo();
  }, [party]);

  // Notice seeks (YouTube has no seek event): if we're far from where the room is, we moved it.
  useEffect(() => {
    if (!joined) return;
    const t = setInterval(() => {
      const pl = player.current;
      const p = partyRef.current;
      if (!pl || !p || Date.now() < applyingUntil.current) return;
      const now = pl.getCurrentTime();
      if (Math.abs(now - expected(p)) > 3) void write({ position: now, playing: pl.getPlayerState() === 1 });
    }, 1500);
    return () => clearInterval(t);
     
  }, [joined]);

  if (!party && !open) return null;

  if (!party)
    return (
      <div className="flex items-center gap-2 border-b border-ae-border bg-ae-sunken/60 px-4 py-2.5">
        <TvIcon size={18} className="shrink-0 text-ae-accent" />
        <input
          autoFocus
          className="ae-input min-w-0 flex-1 text-sm"
          placeholder="Paste a YouTube link to watch together"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void start()}
        />
        <button type="button" className="ae-press shrink-0 rounded-ae bg-ae-accent px-3 py-1.5 text-sm font-semibold text-ae-on-accent" onClick={() => void start()}>
          Start
        </button>
        <button type="button" aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ae-muted hover:bg-ae-hover" onClick={() => onOpenChange(false)}>
          <CloseIcon size={16} />
        </button>
      </div>
    );

  const who = starter?.display_name || starter?.username || 'Someone';
  return (
    <div className="border-b border-ae-border bg-ae-sunken/60">
      <div className="flex items-center gap-2 px-4 py-2">
        <TvIcon size={17} className="shrink-0 text-ae-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{party.title || 'YouTube video'}</p>
          <p className="truncate text-xs text-ae-muted">
            {who} started watching together{party.playing ? '' : ' · paused'}
          </p>
        </div>
        {!joined ? (
          <button type="button" className="ae-press flex shrink-0 items-center gap-1.5 rounded-ae bg-ae-accent px-3 py-1.5 text-sm font-semibold text-ae-on-accent" onClick={() => (setJoined(true), setSmall(false))}>
            <PlayIcon size={14} /> Join
          </button>
        ) : (
          <>
            <button type="button" aria-label={small ? 'Bigger player' : 'Smaller player'} data-tip={small ? 'Bigger player' : 'Smaller player'} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ae-muted hover:bg-ae-hover" onClick={() => setSmall((v) => !v)}>
              {small ? <ChevronDownIcon size={16} /> : <ChevronUpIcon size={16} />}
            </button>
            <button type="button" className="shrink-0 rounded-ae px-2.5 py-1.5 text-xs text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={() => setJoined(false)}>
              Leave
            </button>
          </>
        )}
        <button
          type="button"
          data-tip="Stop for everyone"
          aria-label="Stop watching for everyone"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ae-muted hover:bg-ae-hover hover:text-ae-danger"
          onClick={async () => {
            await sb.from('watch_parties').delete().eq('scope_id', scopeId);
            onOpenChange(false);
          }}
        >
          <CloseIcon size={16} />
        </button>
      </div>
      {joined && (
        <>
          <div className={`mx-auto w-full px-4 transition-[max-width] ${small ? 'max-w-[360px]' : 'max-w-[880px]'}`}>
            <div ref={holder} className="aspect-video w-full overflow-hidden rounded-ae bg-black" />
          </div>
          <div className="flex items-center gap-2 px-4 py-2">
            <input className="ae-input min-w-0 flex-1 text-xs" placeholder="Change video: paste another YouTube link" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void start()} />
          </div>
        </>
      )}
    </div>
  );
}
