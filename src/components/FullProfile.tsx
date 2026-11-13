/**
 * The full profile: banner, avatar with status bubble, name block, then tabs (About me, Board,
 * plus any extra tabs such as mutual friends and servers). Actions (Message, Add friend, …) sit on
 * the right of the avatar row. Used for viewing someone's profile and as the live preview in
 * Profile Studio.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { activeCustomStatus } from '../hooks/useDesktop';
import { Markdown } from '../lib/markdown';
import { openExternal } from '../lib/platform';
import { DEFAULT_PROFILE_ACCENT, DEFAULT_PROFILE_PRIMARY, type ProfileWidget } from '../lib/profileDecor';
import { isHexColor } from '../theme/presets';
import type { UserProfile } from '../types/db';
import { ActivitySections, WidgetBoard } from './ActivityCards';
import { CalendarIcon, CloseIcon, LinkIcon } from './icons';
import { Avatar, BadgeRow, ProfileEffectLayer, StyledName } from './ProfileCard';
import { ScopedCss } from './ThemeEngine';
import { useEscape } from '../lib/escape';
import { cardFrameAttrs, cardVars } from '../lib/cardDecor';
import { themeAttrs } from '../lib/cosmetics';
import { cropStyle } from './ProfileCard';
import { EmojiText } from '../lib/twemoji';
import { PresenceDot, usePresenceOf } from '../hooks/usePresence';

export interface ProfileTab {
  id: string;
  label: string;
  content: ReactNode;
}

function Label({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{children}</h3>;
}

export function FullProfile({
  profile,
  actions,
  boardEmpty,
  aboutExtra,
  extraTabs = [],
  initialTab = 'about',
  className = '',
}: {
  profile: UserProfile;
  actions?: ReactNode;
  boardEmpty?: ReactNode;
  /** Shown at the end of the About tab (your note, server tools…). */
  aboutExtra?: ReactNode;
  extraTabs?: ProfileTab[];
  initialTab?: string;
  className?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const presence = usePresenceOf(profile.id);
  const scopeId = `fp-${profile.id.replace(/[^a-z0-9-]/gi, '')}`;
  const primary = isHexColor(profile.primary_color) ? profile.primary_color : DEFAULT_PROFILE_PRIMARY;
  const accent = isHexColor(profile.accent_color) ? profile.accent_color : DEFAULT_PROFILE_ACCENT;
  const status = activeCustomStatus(profile);
  const widgets = (profile.profile_widgets ?? []) as ProfileWidget[];
  const since = new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const tabs: ProfileTab[] = [
    { id: 'about', label: 'About me', content: null },
    { id: 'board', label: widgets.length ? `Board (${widgets.length})` : 'Board', content: null },
    ...extraTabs,
  ];

  return (
    <article
      data-ae-profile={scopeId}
      className={`ae-profile-card ae-card @container relative w-full overflow-hidden rounded-[calc(var(--ae-radius)+6px)] border border-ae-border text-ae-text shadow-2xl ${className}`}
      data-card={profile.card_style ?? 'solid'}
      data-ct={themeAttrs(profile.card_style, profile.decor).pattern}
      {...cardFrameAttrs(profile)}
      style={
        {
          '--pf-primary': primary,
          '--pf-accent': accent,
          '--card-a': primary,
          '--card-b': accent,
          ...cardVars(profile),
          background: `linear-gradient(180deg, color-mix(in srgb, ${primary} 26%, var(--ae-bg-solid)) 0%, var(--ae-bg-solid) 40%)`,
          contain: 'layout paint style',
          isolation: 'isolate',
        } as CSSProperties
      }
    >
      <ScopedCss css={profile.custom_css} scopeSelector={`[data-ae-profile="${scopeId}"]`} />
      <ProfileEffectLayer effect={profile.profile_effect} color={isHexColor(profile.accent_color) ? profile.accent_color : undefined} angle={profile.decor?.effectAngle} decorColor={profile.decor?.effect} motion={profile.decor?.effectMotion} />

      <div className="ae-profile-banner h-[120px] w-full @2xl:h-[140px]" style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
        {profile.banner_url && <img src={profile.banner_url} alt="" className="h-full w-full object-cover" draggable={false} style={cropStyle(profile.decor?.bannerCrop)} />}
      </div>

      <div className="relative px-5 pb-4">
        {/* Avatar row: avatar + status bubble on the left, actions on the right */}
        <div className="-mt-[52px] flex items-end gap-3">
          <div className="relative shrink-0">
            <div className={`p-1.5 ${profile.avatar_shape === 'squircle' ? 'rounded-[30%]' : 'rounded-full'}`} style={{ background: profile.avatar_shape === 'hexagon' ? 'transparent' : 'var(--ae-bg-elevated)' }}>
              <Avatar profile={profile} size={96} />
            </div>
            <PresenceDot status={presence} size={20} className="absolute right-1.5 bottom-1.5 z-10 ring-[4px] ring-ae-elevated" />
          </div>
          {status && (
            <div className="ae-pop relative mb-12 max-w-[260px] min-w-0 rounded-2xl border border-ae-border bg-ae-elevated px-3 py-1.5 text-sm shadow-lg">
              <span className="absolute -bottom-1.5 left-1 h-3 w-3 rounded-full border border-ae-border bg-ae-elevated" />
              <span className="line-clamp-2">
                {profile.status_emoji && (
                  <span className="mr-1">
                    <EmojiText text={profile.status_emoji} />
                  </span>
                )}
                {status}
              </span>
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2 pb-1">{actions}</div>
        </div>

        <header className="mt-2">
          <h2 className="text-[22px] leading-tight font-extrabold">
            <StyledName profile={profile} />
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ae-muted">
            <span>{profile.username}</span>
            {profile.pronouns && <span>• {profile.pronouns}</span>}
            {(profile.badge_ids ?? []).length > 0 && (
              <span className="ml-1 inline-flex">
                <BadgeRow badgeIds={profile.badge_ids ?? []} size={20} />
              </span>
            )}
          </div>
        </header>

        <nav className="mt-3 flex gap-4 overflow-x-auto [scrollbar-width:none] border-b border-ae-border text-sm" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px shrink-0 border-b-2 pb-2 font-semibold transition-colors ${tab === t.id ? 'border-ae-text text-ae-text' : 'border-transparent text-ae-muted hover:text-ae-text'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ae-profile-body mt-3 min-h-[120px]">
          {tab === 'about' && (
            <div className="grid gap-4 @2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-4">
                <ActivitySections userId={profile.id} />
                {profile.bio ? (
                  <section>
                    <Label>About me</Label>
                    <Markdown source={profile.bio} className="text-sm" />
                  </section>
                ) : (
                  <p className="text-sm text-ae-muted">No bio yet.</p>
                )}
                {(profile.profile_links ?? []).length > 0 && (
                  <section>
                    <Label>Links</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.profile_links.map((l) => (
                        <button
                          key={l.url}
                          type="button"
                          data-tip={l.url}
                          onClick={() => void openExternal(l.url)}
                          className="ae-press flex items-center gap-1.5 rounded-full border border-ae-border bg-ae-surface px-3 py-1 text-xs hover:border-ae-accent"
                        >
                          <LinkIcon size={12} /> {l.label}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
              <div className="min-w-0 space-y-4">
                <section>
                  <Label>Member since</Label>
                  <p className="flex items-center gap-1.5 text-sm">
                    <CalendarIcon size={14} className="text-ae-muted" /> {since}
                  </p>
                </section>
                {aboutExtra}
              </div>
            </div>
          )}
          {tab === 'board' && (
            <WidgetBoard
              widgets={widgets}
              empty={boardEmpty ?? <div className="grid h-28 place-items-center rounded-ae border border-dashed border-ae-border text-sm text-ae-muted">Nothing on the board yet.</div>}
            />
          )}
          {extraTabs.find((t) => t.id === tab)?.content}
        </div>
      </div>
    </article>
  );
}

/** Someone's full profile in a modal. Click outside or press Esc to close. */
export function FullProfileModal({
  profile,
  onClose,
  actions,
  aboutExtra,
  extraTabs,
}: {
  profile: UserProfile;
  onClose: () => void;
  actions?: ReactNode;
  aboutExtra?: ReactNode;
  extraTabs?: ProfileTab[];
}) {
  useEscape(() => onClose(), true);
  return (
    <div className="ae-backdrop fixed inset-0 z-40 grid place-items-center bg-black/60 p-3 sm:p-6" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="ae-dialog ae-scroll relative max-h-[calc(100dvh-24px)] w-full max-w-[640px] overflow-y-auto rounded-[calc(var(--ae-radius)+6px)]">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-2.5 right-2.5 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/65"
        >
          <CloseIcon size={16} />
        </button>
        <FullProfile key={profile.id} profile={profile} actions={actions} aboutExtra={aboutExtra} extraTabs={extraTabs} />
      </div>
    </div>
  );
}
