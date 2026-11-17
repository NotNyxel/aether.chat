/**
 * The top of the bottom-left panel (2.1), above voice and your profile row: what you're playing,
 * with a quick Playing / Locked in / AFK switch, and a Spotify mini-player with the real cover,
 * progress you can click to seek, and previous / play-pause / next.
 */
import { useEffect, useState } from 'react';
import { useNowPlaying } from '../hooks/useDesktop';
import { MODE_LABEL, playedFor, useGameOf } from '../hooks/usePresence';
import { GameArtIcon, SpotifyMark } from '../lib/activityArt';
import { mediaAction, nowPlayingCover } from '../lib/desktop';
import { t } from '../lib/i18n';
import { isTauri } from '../lib/platform';
import { PLAY_MODES, useSettingsStore } from '../stores/settingsStore';
import { openContextMenu } from './ContextMenu';
import { CheckIcon, ChevronDownIcon, MusicIcon, PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from './icons';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function useTick(on: boolean, every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [on, every]);
  return now;
}

/** Your game, with how long you've played and a quick mode switch. */
function GameCard({ userId }: { userId: string }) {
  const game = useGameOf(userId);
  const mode = useSettingsStore((s) => s.activity.mode ?? 'playing');
  const setActivity = useSettingsStore((s) => s.setActivity);
  const now = useTick(!!game, 30_000);
  if (!game) return null;
  const time = playedFor(game.since, now);
  return (
    <div className="ae-activity-dock flex items-center gap-2.5 border-t border-ae-border px-3 py-2.5">
      <GameArtIcon name={game.name} size={38} rounded="rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold">{game.name}</span>
        <span className="block truncate text-[11px] text-ae-muted">{time ? (time === 'just started' ? t('Just started') : t('For {time}', { time })) : t('Playing')}</span>
      </span>
      <button
        type="button"
        aria-label={t('How you’re playing')}
        className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${mode === 'locked' ? 'bg-ae-accent text-ae-on-accent' : mode === 'afk' ? 'bg-ae-surface text-ae-muted' : 'bg-ae-success/20 text-ae-success'}`}
        onClick={(e) =>
          openContextMenu(e, [
            ...PLAY_MODES.map((m) => ({ label: t(m.label), hint: t(m.hint), icon: mode === m.id ? <CheckIcon size={15} /> : undefined, onClick: () => setActivity({ mode: m.id }) })),
            'divider',
            { label: t('Stop sharing my game'), onClick: () => setActivity({ shareActivity: false }) },
          ])
        }
      >
        {t(MODE_LABEL[mode])}
        <ChevronDownIcon size={12} />
      </button>
    </div>
  );
}

/** Spotify mini-player: controls the Spotify app through Windows' media controls. */
function MiniPlayer() {
  const track = useNowPlaying((s) => s.track);
  const [cover, setCover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useTick(!!track?.playing);
  const title = track?.title;
  useEffect(() => {
    if (!title) return setCover(null);
    let gone = false;
    // Spotify updates its cover a moment after the song changes.
    const t = setTimeout(() => void nowPlayingCover().then((c) => !gone && setCover(c)), 600);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [title]);
  if (!isTauri || !track) return null;
  // Paused songs are refreshed by the poller (their start moves), so this stays at the paused spot.
  const shown = Math.max(0, Math.min(track.duration_ms, (track.playing ? now : Date.now()) - track.started_at));
  const pct = track.duration_ms ? Math.min(100, (shown / track.duration_ms) * 100) : 0;
  const act = async (a: 'toggle' | 'next' | 'previous' | 'seek', ms?: number) => {
    if (busy) return;
    setBusy(true);
    await mediaAction(a, ms);
    setBusy(false);
  };
  const art = cover ?? track.art ?? null;
  return (
    <div className="ae-activity-dock border-t border-ae-border px-3 pt-2.5 pb-2">
      <div className="flex items-center gap-2.5">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-ae-surface">
          {art ? <img src={art} alt="" className="h-full w-full object-cover" draggable={false} /> : <MusicIcon size={18} className="text-ae-muted" />}
          <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-black/70 p-[2px]"><SpotifyMark size={11} /></span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold">{track.title}</span>
          <span className="block truncate text-[11px] text-ae-muted">{track.artist}</span>
        </span>
      </div>
      <button
        type="button"
        aria-label={t('Seek')}
        className="group mt-2 block h-3 w-full cursor-pointer"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          void act('seek', Math.round(((e.clientX - r.left) / r.width) * track.duration_ms));
        }}
      >
        <span className="block h-1 overflow-hidden rounded-full bg-ae-surface group-hover:h-1.5">
          <span className="block h-full rounded-full bg-ae-text" style={{ width: `${pct}%` }} />
        </span>
      </button>
      <div className="flex items-center text-[10px] text-ae-muted">
        <span className="w-9">{fmt(shown)}</span>
        <span className="flex flex-1 items-center justify-center gap-1">
          <button type="button" aria-label={t('Previous')} disabled={busy} onClick={() => void act('previous')} className="grid h-7 w-7 place-items-center rounded-full text-ae-text hover:bg-ae-hover">
            <SkipBackIcon size={14} />
          </button>
          <button type="button" aria-label={track.playing ? t('Pause') : t('Play')} disabled={busy} onClick={() => void act('toggle')} className="grid h-8 w-8 place-items-center rounded-full bg-ae-text text-ae-bg hover:scale-105">
            {track.playing ? <PauseIcon size={15} /> : <PlayIcon size={15} className="translate-x-px" />}
          </button>
          <button type="button" aria-label={t('Next')} disabled={busy} onClick={() => void act('next')} className="grid h-7 w-7 place-items-center rounded-full text-ae-text hover:bg-ae-hover">
            <SkipForwardIcon size={14} />
          </button>
        </span>
        <span className="w-9 text-right">{fmt(track.duration_ms)}</span>
      </div>
    </div>
  );
}

export function PanelDock({ userId }: { userId: string }) {
  return (
    <>
      <GameCard userId={userId} />
      <MiniPlayer />
    </>
  );
}
