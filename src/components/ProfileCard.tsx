/**
 * Profile rendering: Avatar (with animated frames and speaking ring), badges, the full ProfileCard
 * (banner, colors, markdown bio, audio status clip, scoped custom CSS), and a popover wrapper.
 *
 * Profile custom CSS is compiled with remote URLs disabled and scoped to the card. The card uses
 * `contain: layout paint style` and `isolation: isolate`, so nothing can paint outside it,
 * including position: fixed overlays.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { activeCustomStatus } from '../hooks/useDesktop';
import { useActivityOf } from '../hooks/usePresence';
import { Markdown } from '../lib/markdown';
import { isHexColor } from '../theme/presets';
import type { UserProfile } from '../types/db';
import { PauseIcon, PlayIcon } from './icons';
import { ScopedCss } from './ThemeEngine';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Badges
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const BADGE_CATALOG: Record<string, { label: string; glyph: string; color: string }> = {
  founder: { label: 'Founder', glyph: '✦', color: '#f5c542' },
  staff: { label: 'aether.chat Staff', glyph: '◆', color: '#7c5cff' },
  'early-supporter': { label: 'Early Supporter', glyph: '❖', color: '#ff7ab6' },
  developer: { label: 'Developer', glyph: '⌘', color: '#00d4ff' },
  moderator: { label: 'Moderator', glyph: '⛨', color: '#2ecc71' },
  'bug-hunter': { label: 'Bug Hunter', glyph: '✱', color: '#ff9f43' },
  'voice-veteran': { label: 'Voice Veteran', glyph: '♪', color: '#a29bfe' },
  velox: { label: 'velox Native', glyph: '⟁', color: '#5ee6a8' },
};

export function BadgeRow({ badgeIds }: { badgeIds: string[] }) {
  if (!badgeIds.length) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Badges">
      {badgeIds.map((id) => {
        const badge = BADGE_CATALOG[id] ?? { label: id, glyph: '•', color: 'var(--ae-text-muted)' };
        return (
          <li
            key={id}
            title={badge.label}
            className="grid h-6 w-6 place-items-center rounded-md bg-ae-sunken text-sm"
            style={{ color: badge.color }}
          >
            {badge.glyph}
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Avatar
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface AvatarProps {
  profile: Pick<UserProfile, 'username' | 'display_name' | 'avatar_url' | 'avatar_frame' | 'accent_color'> | null | undefined;
  size?: number;
  speaking?: boolean;
  /** Show the animated frame. Turn off in dense lists to save GPU. */
  showFrame?: boolean;
}

export function Avatar({ profile, size = 40, speaking = false, showFrame = true }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const name = profile?.display_name || profile?.username || '?';
  const frame = showFrame && profile?.avatar_frame ? profile.avatar_frame : 'none';
  const style = {
    '--avatar-size': `${size}px`,
    ...(isHexColor(profile?.accent_color) ? { '--frame-color': profile.accent_color } : {}),
  } as CSSProperties;

  useEffect(() => setBroken(false), [profile?.avatar_url]);

  return (
    <div className="ae-avatar" data-frame={frame} data-speaking={speaking} style={style}>
      <div className="ae-avatar-inner" style={{ fontSize: size * 0.4 }}>
        {profile?.avatar_url && !broken ? (
          <img src={profile.avatar_url} alt="" draggable={false} onError={() => setBroken(true)} />
        ) : (
          <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Audio status clip
// ─────────────────────────────────────────────────────────────────────────────────────────────

function AudioStatusClip({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    audio.src = url;
    audio.volume = 0.8;
    const stop = () => setPlaying(false);
    audio.addEventListener('ended', stop);
    audio.addEventListener('pause', stop);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener('ended', stop);
      audio.removeEventListener('pause', stop);
      audioRef.current = null;
    };
  }, [url]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    audio.currentTime = 0;
    void audio.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center gap-2 rounded-ae bg-ae-sunken px-3 py-1.5 text-xs text-ae-muted hover:text-ae-text"
    >
      {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      {playing ? 'Playing audio status' : 'Play audio status'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Profile card
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface ProfileCardProps {
  profile: UserProfile;
  className?: string;
}

export function ProfileCard({ profile, className = '' }: ProfileCardProps) {
  const scopeId = `p-${profile.id.replace(/[^a-z0-9-]/gi, '')}`;
  const customStatus = activeCustomStatus(profile);
  const playing = useActivityOf(profile.id);
  const primary = isHexColor(profile.primary_color) ? profile.primary_color : 'var(--ae-surface)';
  const accent = isHexColor(profile.accent_color) ? profile.accent_color : 'var(--ae-accent)';
  const memberSince = new Date(profile.created_at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <article
      data-ae-profile={scopeId}
      className={`ae-profile-card relative w-[340px] overflow-hidden rounded-ae border border-ae-border text-ae-text shadow-2xl ${className}`}
      style={
        {
          '--pf-primary': primary,
          '--pf-accent': accent,
          background: `linear-gradient(180deg, color-mix(in srgb, ${primary} 35%, var(--ae-bg-elevated)) 0%, var(--ae-bg-elevated) 55%)`,
          contain: 'layout paint style',
          isolation: 'isolate',
        } as CSSProperties
      }
    >
      <ScopedCss css={profile.custom_css} scopeSelector={`[data-ae-profile="${scopeId}"]`} />

      <div className="ae-profile-banner h-28 w-full" style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
        {profile.banner_url && <img src={profile.banner_url} alt="" className="h-full w-full object-cover" draggable={false} />}
      </div>

      <div className="relative px-4 pb-4">
        <div className="-mt-10 mb-2 flex items-end justify-between">
          <div className="rounded-full p-1" style={{ background: 'var(--ae-bg-elevated)' }}>
            <Avatar profile={profile} size={80} />
          </div>
          <BadgeRow badgeIds={profile.badge_ids ?? []} />
        </div>

        <div className="ae-profile-body space-y-3 rounded-ae bg-ae-sunken/60 p-3">
          <header>
            <h2 className="text-lg leading-tight font-bold">{profile.display_name || profile.username}</h2>
            <p className="text-sm text-ae-muted">@{profile.username}</p>
            {customStatus && (
              <p className="mt-1 text-sm">
                {profile.status_emoji && <span className="mr-1">{profile.status_emoji}</span>}
                {customStatus}
              </p>
            )}
          </header>

          {playing && (
            <section>
              <h3 className="mb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Playing a game</h3>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className="grid h-8 w-8 place-items-center rounded-ae bg-ae-surface text-base">🎮</span>
                {playing}
              </p>
            </section>
          )}

          {profile.bio && (
            <section>
              <h3 className="mb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">About me</h3>
              <Markdown source={profile.bio} className="text-sm" />
            </section>
          )}

          {profile.audio_status_url && <AudioStatusClip url={profile.audio_status_url} />}

          <section>
            <h3 className="mb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Member since</h3>
            <p className="text-sm">{memberSince}</p>
          </section>
        </div>
      </div>
    </article>
  );
}

/** Centered modal wrapper for viewing someone's profile. Click the backdrop or press Esc to close. */
export function ProfilePopover({ profile, onClose, footer }: { profile: UserProfile; onClose: () => void; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="space-y-2">
        <ProfileCard profile={profile} />
        {footer}
      </div>
    </div>
  );
}
