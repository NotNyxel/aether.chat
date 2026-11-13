/**
 * Profile rendering: Avatar (with animated frames and speaking ring), badges, the full ProfileCard
 * (banner, colors, markdown bio, audio status clip, scoped custom CSS), and a popover wrapper.
 *
 * Profile custom CSS is compiled with remote URLs disabled and scoped to the card. The card uses
 * `contain: layout paint style` and `isolation: isolate`, so nothing can paint outside it,
 * including position: fixed overlays.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { activeCustomStatus } from '../hooks/useDesktop';
import { Markdown } from '../lib/markdown';
import { isHexColor } from '../theme/presets';
import type { ProfileEffect, UserProfile } from '../types/db';
import { openExternal } from '../lib/platform';
import type { LucideIcon } from 'lucide-react';
import { AdminIcon, BadgeIcon, BrushIcon, BugIcon, CodeIcon, CrownIcon, FlaskIcon, GavelIcon, GemIcon, HeadsetIcon, HeartIcon, LinkIcon, PauseIcon, PlayIcon, RocketIcon, TrophyIcon, ZapIcon } from './icons';
import { ActivitySections } from './ActivityCards';
import { ScopedCss } from './ThemeEngine';
import { useEscape } from '../lib/escape';
import { DEFAULT_PROFILE_ACCENT, DEFAULT_PROFILE_PRIMARY } from '../lib/profileDecor';
import { avatarDecoStyle } from '../lib/decoArt';
import { effectDef, frameProps, loadNameFont, nameEffectAttrs, nameFontFamily, shapeDef, type Crop, type EffectDef, type Motion } from '../lib/cosmetics';
import { cardFrameAttrs, cardVars } from '../lib/cardDecor';
import { themeAttrs } from '../lib/cosmetics';
import { EmojiText } from '../lib/twemoji';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Badges
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const BADGE_CATALOG: Record<string, { label: string; Icon: LucideIcon; color: string }> = {
  founder: { label: 'Founder', Icon: CrownIcon, color: '#f5c542' },
  staff: { label: 'Aether Staff', Icon: AdminIcon, color: '#7c5cff' },
  'early-supporter': { label: 'Early Supporter', Icon: HeartIcon, color: '#ff7ab6' },
  developer: { label: 'Developer', Icon: CodeIcon, color: '#00d4ff' },
  moderator: { label: 'Moderator', Icon: GavelIcon, color: '#2ecc71' },
  'bug-hunter': { label: 'Bug Hunter', Icon: BugIcon, color: '#ff9f43' },
  'voice-veteran': { label: 'Voice Veteran', Icon: HeadsetIcon, color: '#a29bfe' },
  velox: { label: 'velox Native', Icon: ZapIcon, color: '#5ee6a8' },
  supporter: { label: 'Supporter', Icon: GemIcon, color: '#ff5ac8' },
  artist: { label: 'Artist', Icon: BrushIcon, color: '#ffb86b' },
  tester: { label: 'Beta Tester', Icon: FlaskIcon, color: '#7bd88f' },
  pioneer: { label: 'Pioneer', Icon: RocketIcon, color: '#5ab0ff' },
  champion: { label: 'Champion', Icon: TrophyIcon, color: '#ffd166' },
};

export function BadgeRow({ badgeIds, size = 24 }: { badgeIds: string[]; size?: number }) {
  if (!badgeIds.length) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Badges">
      {badgeIds.map((id) => {
        const badge = BADGE_CATALOG[id] ?? { label: id, Icon: BadgeIcon, color: 'var(--ae-text-muted)' };
        return (
          <li
            key={id}
            data-tip={badge.label}
            aria-label={badge.label}
            className="ae-lift grid place-items-center rounded-md bg-ae-sunken/80"
            style={{ color: badge.color, width: size, height: size, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${badge.color} 35%, transparent)` }}
          >
            <badge.Icon size={size * 0.6} strokeWidth={2.2} />
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
  profile:
    | (Pick<UserProfile, 'username' | 'display_name' | 'avatar_url' | 'avatar_frame' | 'accent_color'> & Partial<Pick<UserProfile, 'avatar_shape' | 'decor'>>)
    | null
    | undefined;
  size?: number;
  speaking?: boolean;
  /** Show the animated frame. Turn off in dense lists to save GPU. */
  showFrame?: boolean;
}

/** A stable, pleasant two-tone gradient for people without an avatar. */
function fallbackGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 65% 42%))`;
}

export function Avatar({ profile, size = 40, speaking = false, showFrame = true }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const name = profile?.display_name || profile?.username || '?';
  const frame = showFrame && profile?.avatar_frame ? profile.avatar_frame : 'none';
  const gen = frameProps(frame, profile?.decor);
  const deco = avatarDecoStyle(frame, profile?.decor?.deco);
  const shape = shapeDef(profile?.avatar_shape);
  const style = {
    '--avatar-size': `${size}px`,
    '--frame-color': isHexColor(profile?.accent_color) ? profile.accent_color : DEFAULT_PROFILE_ACCENT,
    ...gen.style,
    ...(deco ?? {}),
    ...(shape ? { '--shape-clip': shape.clip ?? 'none', '--shape-radius': shape.radius ?? '0' } : {}),
  } as CSSProperties;

  useEffect(() => setBroken(false), [profile?.avatar_url]);

  return (
    <div className="ae-avatar" data-frame={frame} data-fs={gen.fam} data-deco={deco ? '' : undefined} data-shape={profile?.avatar_shape ?? 'circle'} data-shape-custom={shape ? '' : undefined} data-speaking={speaking} style={style}>
      <div
        className="ae-avatar-inner"
        style={{
          fontSize: size * 0.4,
          ...(!profile?.avatar_url || broken ? { background: fallbackGradient(profile?.username ?? name), color: '#fff' } : {}),
        }}
      >
        {profile?.avatar_url && !broken ? (
          <img src={profile.avatar_url} alt="" draggable={false} onError={() => setBroken(true)} style={cropStyle(profile.decor?.avatarCrop)} />
        ) : (
          <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Styled display names
// ─────────────────────────────────────────────────────────────────────────────────────────────

type NameProfile = Partial<Pick<UserProfile, 'display_name' | 'username' | 'name_font' | 'name_effect' | 'name_color_a' | 'name_color_b' | 'accent_color'>>;

/** CSS for a stored crop (focus point + zoom); works for GIFs too since the file isn't touched. */
export function cropStyle(c: Crop | null | undefined): CSSProperties | undefined {
  if (!c) return undefined;
  return { objectPosition: `${c.x}% ${c.y}%`, transform: c.z > 1 ? `scale(${c.z})` : undefined, transformOrigin: `${c.x}% ${c.y}%` };
}

/**
 * A display name with the user's chosen font and effect. `color` (e.g. a role colour) applies
 * unless the user picked a colour effect, which wins, like Discord's gradient role names.
 */
export function StyledName({ profile, text, color, className = '' }: { profile: NameProfile | null | undefined; text?: string; color?: string | null; className?: string }) {
  const a = isHexColor(profile?.name_color_a) ? profile!.name_color_a! : isHexColor(profile?.accent_color) ? profile!.accent_color! : DEFAULT_PROFILE_ACCENT;
  const b = isHexColor(profile?.name_color_b) ? profile!.name_color_b! : `color-mix(in srgb, ${a} 30%, #ffffff)`;
  const effect = profile?.name_effect ?? 'none';
  const fx = nameEffectAttrs(effect);
  const family = nameFontFamily(profile?.name_font);
  useEffect(() => loadNameFont(profile?.name_font), [profile?.name_font]);
  return (
    <span
      className={`ae-name ${className}`}
      data-font={profile?.name_font ?? 'default'}
      data-effect={effect}
      data-fill={fx.fill}
      data-tr={fx.tr}
      style={{ '--name-a': a, '--name-b': b, color: effect === 'none' ? (color ?? undefined) : undefined, ...(family ? { fontFamily: `'Twemoji', '${family}', system-ui, sans-serif` } : {}) } as CSSProperties}
    >
      {text ?? (profile?.display_name || profile?.username || '…')}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Profile effects (particles over the card)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const EFFECTS: Record<Exclude<ProfileEffect, 'none'>, { glyphs: string[]; count: number; motion: 'fall' | 'rise' | 'twinkle' | 'wander'; size: [number, number] }> = {
  sparkles: { glyphs: ['✦', '✧', '⋆'], count: 16, motion: 'twinkle', size: [10, 18] },
  snow: { glyphs: ['❄', '•', '❅'], count: 22, motion: 'fall', size: [8, 16] },
  hearts: { glyphs: ['💗', '💖', '💕'], count: 12, motion: 'rise', size: [12, 20] },
  fireflies: { glyphs: ['●'], count: 14, motion: 'wander', size: [4, 7] },
  confetti: { glyphs: ['▮', '▲', '●', '■'], count: 26, motion: 'fall', size: [6, 10] },
  rain: { glyphs: ['│'], count: 30, motion: 'fall', size: [10, 16] },
  stars: { glyphs: ['★', '☆', '✶'], count: 14, motion: 'twinkle', size: [8, 16] },
  bubbles: { glyphs: ['○', '◯'], count: 14, motion: 'rise', size: [10, 22] },
  petals: { glyphs: ['🌸', '🌺', '❀'], count: 12, motion: 'fall', size: [12, 18] },
  embers: { glyphs: ['●', '•'], count: 22, motion: 'rise', size: [3, 7] },
  leaves: { glyphs: ['🍂', '🍁', '🍃'], count: 12, motion: 'fall', size: [12, 18] },
  music: { glyphs: ['♪', '♫', '♬'], count: 14, motion: 'rise', size: [12, 20] },
  lightning: { glyphs: ['ϟ'], count: 8, motion: 'twinkle', size: [14, 26] },
};
const CONFETTI_COLORS = ['#ff5f6d', '#ffc371', '#5ee6a8', '#4facfe', '#a18cd1', '#f9f871'];

export function ProfileEffectLayer({ effect, color, angle = 12, decorColor, motion }: { effect: ProfileEffect | null | undefined; color?: string; angle?: number; decorColor?: string; motion?: Motion }) {
  const parts = useMemo(() => {
    if (!effect || effect === 'none') return [];
    const legacy = EFFECTS[effect as Exclude<ProfileEffect, 'none'>] as EffectDef | undefined;
    const fx = legacy ? { ...legacy, aligned: effect === 'rain' } : effectDef(effect, motion);
    if (!fx) return [];
    const rad = (Math.max(-45, Math.min(45, angle)) * Math.PI) / 180;
    const slide = Math.tan(rad) * 620; // sideways travel over the card's height at this angle
    // Deterministic pseudo-random layout so the card doesn't reshuffle on every render.
    let seed = effect.length * 9301;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    return Array.from({ length: fx.count }, (_, i) => {
      const size = fx.size[0] + rand() * (fx.size[1] - fx.size[0]);
      const duration = fx.motion === 'fall' ? 5 + rand() * 6 : fx.motion === 'rise' ? 6 + rand() * 5 : 2 + rand() * 3;
      const style = {
        left: `${rand() * 100}%`,
        top: fx.motion === 'fall' ? '-6%' : fx.motion === 'rise' ? '100%' : `${rand() * 100}%`,
        fontSize: size,
        opacity: fx.motion === 'fall' ? 0.85 : undefined,
        animation: `ae-${fx.motion === 'drift' ? 'fall' : fx.motion} ${duration}s ${fx.motion === 'fall' || fx.motion === 'rise' || fx.motion === 'drift' ? 'linear' : 'ease-in-out'} ${-rand() * duration}s infinite`,
        // Falling things travel along one angle. Streaks (rain) also point that way instead of tumbling.
        '--drift': `${(fx.motion === 'fall' || fx.motion === 'drift' ? -slide : 0) + (fx.aligned ? 0 : (rand() - 0.5) * (fx.motion === 'drift' ? 160 : 60))}px`,
        '--spin': fx.aligned ? '0deg' : `${(rand() - 0.5) * (fx.motion === 'drift' ? 180 : 720)}deg`,
        '--rot': fx.aligned ? `${angle}deg` : '0deg',
        color: decorColor ??
          (effect === 'confetti'
            ? CONFETTI_COLORS[i % CONFETTI_COLORS.length]
            : effect === 'fireflies'
              ? '#ffe96b'
              : effect === 'embers'
                ? ['#ff6a00', '#ffb347', '#ff3d00'][i % 3]
                : effect === 'lightning'
                  ? '#c9e6ff'
                  : effect === 'rain'
                ? 'rgba(160, 200, 255, 0.6)'
                : effect === 'snow' || effect === 'bubbles'
                  ? 'rgba(255,255,255,0.85)'
                  : (color ?? '#ffe08a')),
        textShadow: effect === 'fireflies' ? '0 0 8px #ffe96b' : effect === 'embers' ? '0 0 6px #ff6a00' : effect === 'lightning' ? '0 0 10px #8ecbff' : undefined,
      } as CSSProperties;
      return { glyph: fx.glyphs[i % fx.glyphs.length]!, style };
    });
  }, [effect, color, angle, decorColor, motion]);
  if (parts.length === 0) return null;
  return (
    <div className="ae-fx" aria-hidden="true">
      {parts.map((p, i) => (
        <span key={i} style={p.style}>
          {p.glyph}
        </span>
      ))}
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
  const primary = isHexColor(profile.primary_color) ? profile.primary_color : DEFAULT_PROFILE_PRIMARY;
  const accent = isHexColor(profile.accent_color) ? profile.accent_color : DEFAULT_PROFILE_ACCENT;
  const memberSince = new Date(profile.created_at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <article
      data-ae-profile={scopeId}
      className={`ae-profile-card ae-card relative w-[340px] overflow-hidden rounded-ae border border-ae-border text-ae-text shadow-2xl ${className}`}
      data-card={profile.card_style ?? 'solid'}
      data-ct={themeAttrs(profile.card_style).pattern}
      {...cardFrameAttrs(profile)}
      style={
        {
          '--pf-primary': primary,
          '--pf-accent': accent,
          '--card-a': primary,
          '--card-b': accent,
          ...cardVars(profile),
          background: `linear-gradient(180deg, color-mix(in srgb, ${primary} 35%, var(--ae-bg-solid)) 0%, var(--ae-bg-solid) 55%)`,
          contain: 'layout paint style',
          isolation: 'isolate',
        } as CSSProperties
      }
    >
      <ScopedCss css={profile.custom_css} scopeSelector={`[data-ae-profile="${scopeId}"]`} />
      <ProfileEffectLayer effect={profile.profile_effect} color={isHexColor(profile.accent_color) ? profile.accent_color : undefined} angle={profile.decor?.effectAngle} decorColor={profile.decor?.effect} motion={profile.decor?.effectMotion} />

      <div className="ae-profile-banner h-28 w-full" style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
        {profile.banner_url && <img src={profile.banner_url} alt="" className="h-full w-full object-cover" draggable={false} style={cropStyle(profile.decor?.bannerCrop)} />}
      </div>

      <div className="relative px-4 pb-4">
        <div className="-mt-10 mb-2 flex items-end justify-between">
          <div className={`p-1 ${profile.avatar_shape === 'squircle' ? 'rounded-[30%]' : 'rounded-full'}`} style={{ background: profile.avatar_shape === 'hexagon' ? 'transparent' : 'var(--ae-bg-elevated)' }}>
            <Avatar profile={profile} size={80} />
          </div>
          <BadgeRow badgeIds={profile.badge_ids ?? []} />
        </div>

        <div className="ae-profile-body space-y-3 rounded-ae bg-ae-sunken/60 p-3">
          <header>
            <h2 className="text-lg leading-tight font-bold">
              <StyledName profile={profile} />
            </h2>
            <p className="text-sm text-ae-muted">
              @{profile.username}
              {profile.pronouns && <span> · {profile.pronouns}</span>}
            </p>
            {customStatus && (
              <p className="mt-1 text-sm">
                {profile.status_emoji && <span className="mr-1"><EmojiText text={profile.status_emoji} /></span>}
                {customStatus}
              </p>
            )}
          </header>

          <ActivitySections userId={profile.id} />

          {profile.bio && (
            <section>
              <h3 className="mb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">About me</h3>
              <Markdown source={profile.bio} className="text-sm" />
            </section>
          )}

          {profile.audio_status_url && <AudioStatusClip url={profile.audio_status_url} />}

          {(profile.profile_links ?? []).length > 0 && (
            <section>
              <h3 className="mb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Links</h3>
              <div className="flex flex-wrap gap-1.5">
                {profile.profile_links.map((l) => (
                  <button
                    key={l.url}
                    type="button"
                    title={l.url}
                    onClick={() => void openExternal(l.url)}
                    className="ae-press rounded-full border border-ae-border bg-ae-surface px-2.5 py-1 text-xs hover:border-ae-accent"
                  >
                    <LinkIcon size={12} className="ae-ico" /> {l.label}
                  </button>
                ))}
              </div>
            </section>
          )}

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
  useEscape(() => onClose(), true);

  return (
    <div className="ae-backdrop fixed inset-0 z-40 grid place-items-center bg-black/50" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="ae-dialog ae-scroll max-h-[calc(100vh-32px)] space-y-2 overflow-y-auto p-1">
        <ProfileCard profile={profile} />
        {footer}
      </div>
    </div>
  );
}
