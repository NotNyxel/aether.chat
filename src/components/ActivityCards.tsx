/**
 * Rich activity UI: "Listening to Spotify" with album art and a live progress bar, "Playing" with
 * real game art, a compact one-line activity subtitle for lists, and the profile widget board.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useActivityOf, useListeningOf, type Listening } from '../hooks/usePresence';
import { AlbumArt, GameArtIcon, GameBanner, SpotifyMark } from '../lib/activityArt';
import type { ProfileWidget } from '../lib/profileDecor';
import { MusicIcon, QuoteIcon } from './icons';

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Ticks once a second while mounted. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{children}</h3>;
}

export function ListeningCard({ track, compact = false }: { track: Listening; compact?: boolean }) {
  const now = useNow(true);
  const elapsed = Math.min(track.duration_ms || Infinity, now - track.started_at);
  const pct = track.duration_ms > 0 ? Math.min(100, (elapsed / track.duration_ms) * 100) : 0;
  return (
    <section className="ae-enter">
      <SectionTitle>
        <SpotifyMark size={12} /> Listening to Spotify
      </SectionTitle>
      <div className="flex gap-3">
        <AlbumArt title={track.title} artist={track.artist} size={compact ? 48 : 64} />
        <div className="min-w-0 flex-1 self-center">
          <p className="truncate text-sm font-semibold" title={track.title}>
            {track.title}
          </p>
          <p className="truncate text-xs text-ae-muted" title={track.artist}>
            by {track.artist}
          </p>
          {track.album && !compact && (
            <p className="truncate text-xs text-ae-muted" title={track.album}>
              on {track.album}
            </p>
          )}
        </div>
      </div>
      {track.duration_ms > 0 && (
        <div className="mt-2">
          <div className="h-1 overflow-hidden rounded-full bg-ae-surface">
            <div className="h-full rounded-full bg-[#1db954] transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-0.5 flex justify-between text-[10px] text-ae-muted tabular-nums">
            <span>{fmt(elapsed)}</span>
            <span>{fmt(track.duration_ms)}</span>
          </div>
        </div>
      )}
    </section>
  );
}

export function PlayingCard({ name, startedLabel }: { name: string; startedLabel?: string }) {
  return (
    <section className="ae-enter">
      <SectionTitle>Playing a game</SectionTitle>
      <div className="flex items-center gap-3">
        <GameArtIcon name={name} size={56} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          {startedLabel && <p className="text-xs text-ae-muted">{startedLabel}</p>}
        </div>
      </div>
    </section>
  );
}

/** Both activity cards for a user (renders nothing if they share neither). */
export function ActivitySections({ userId }: { userId: string }) {
  const playing = useActivityOf(userId);
  const track = useListeningOf(userId);
  if (!playing && !track) return null;
  return (
    <>
      {playing && <PlayingCard name={playing} />}
      {track && <ListeningCard track={track} />}
    </>
  );
}

/** One-line activity for member lists and friend rows. Returns null when there's nothing to show. */
export function ActivityLine({ userId, fallback }: { userId: string; fallback?: ReactNode }) {
  const playing = useActivityOf(userId);
  const track = useListeningOf(userId);
  if (playing)
    return (
      <span className="flex min-w-0 items-center gap-1">
        <GameArtIcon name={playing} size={14} rounded="rounded-[3px]" />
        <span className="truncate">
          Playing <b>{playing}</b>
        </span>
      </span>
    );
  if (track)
    return (
      <span className="flex min-w-0 items-center gap-1">
        <SpotifyMark size={12} />
        <span className="truncate">
          Listening to <b>{track.title}</b>
        </span>
      </span>
    );
  return fallback ? <>{fallback}</> : null;
}

export function useHasActivity(userId: string): boolean {
  return !!useActivityOf(userId) || !!useListeningOf(userId);
}

// ── Profile board widgets ───────────────────────────────────────────────────────────────────

export function WidgetView({ w }: { w: ProfileWidget }) {
  switch (w.type) {
    case 'favorite_game':
      return (
        <div className="overflow-hidden rounded-ae border border-ae-border bg-ae-sunken/60">
          <GameBanner name={w.name} className="aspect-[460/215] w-full" />
          <div className="p-3">
            <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Favorite game</p>
            <p className="font-semibold">{w.name}</p>
            {w.note && <p className="mt-0.5 text-sm text-ae-muted">{w.note}</p>}
          </div>
        </div>
      );
    case 'games':
      return (
        <div className="rounded-ae border border-ae-border bg-ae-sunken/60 p-3">
          <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Games I like</p>
          <div className="grid grid-cols-3 gap-2">
            {w.names.slice(0, 6).map((n) => (
              <div key={n} className="min-w-0 text-center" title={n}>
                <GameBanner name={n} className="aspect-[460/215] w-full rounded-md" />
                <p className="mt-1 truncate text-[11px]">{n}</p>
              </div>
            ))}
          </div>
        </div>
      );
    case 'music':
      return (
        <div className="flex items-center gap-3 rounded-ae border border-ae-border bg-ae-sunken/60 p-3">
          <AlbumArt title={w.title} artist={w.artist} size={56} />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
              <MusicIcon size={11} /> On repeat
            </p>
            <p className="truncate font-semibold">{w.title}</p>
            <p className="truncate text-sm text-ae-muted">{w.artist}</p>
          </div>
        </div>
      );
    case 'about':
      return (
        <div className="rounded-ae border border-ae-border bg-ae-sunken/60 p-3">
          <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">{w.title}</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{w.text}</p>
        </div>
      );
    case 'quote':
      return (
        <figure className="relative rounded-ae border border-ae-border bg-ae-sunken/60 p-3 pl-9">
          <QuoteIcon size={18} className="absolute top-3 left-3 text-ae-accent" />
          <blockquote className="text-sm italic">{w.text}</blockquote>
        </figure>
      );
  }
}

export function WidgetBoard({ widgets, empty }: { widgets: ProfileWidget[]; empty?: ReactNode }) {
  if (!widgets.length) return empty ? <>{empty}</> : null;
  return (
    <div className="space-y-2.5">
      {widgets.map((w, i) => (
        <WidgetView key={i} w={w} />
      ))}
    </div>
  );
}
