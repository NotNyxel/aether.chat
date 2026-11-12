/**
 * The large profile: banner, big avatar, styled name, badges, activity, bio, links and the widget
 * board. Used for viewing someone's profile and as the live preview in Profile Studio. It lays
 * itself out as one column when narrow and two columns when there's room (container query).
 */
import { type CSSProperties, type ReactNode } from 'react';
import { activeCustomStatus } from '../hooks/useDesktop';
import { Markdown } from '../lib/markdown';
import { openExternal } from '../lib/platform';
import { DEFAULT_PROFILE_ACCENT, DEFAULT_PROFILE_PRIMARY, type ProfileWidget } from '../lib/profileDecor';
import { isHexColor } from '../theme/presets';
import type { UserProfile } from '../types/db';
import { ActivitySections, WidgetBoard } from './ActivityCards';
import { CalendarIcon, LinkIcon, WidgetIcon } from './icons';
import { Avatar, BadgeRow, ProfileEffectLayer, StyledName } from './ProfileCard';
import { ScopedCss } from './ThemeEngine';
import { useEscape } from '../lib/escape';
import { cardFrameAttrs, cardVars } from '../lib/cardDecor';
import { themeAttrs } from '../lib/cosmetics';
import { cropStyle } from './ProfileCard';

function Label({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{children}</h3>;
}

export function FullProfile({ profile, actions, boardEmpty, className = '' }: { profile: UserProfile; actions?: ReactNode; boardEmpty?: ReactNode; className?: string }) {
  const scopeId = `fp-${profile.id.replace(/[^a-z0-9-]/gi, '')}`;
  const primary = isHexColor(profile.primary_color) ? profile.primary_color : DEFAULT_PROFILE_PRIMARY;
  const accent = isHexColor(profile.accent_color) ? profile.accent_color : DEFAULT_PROFILE_ACCENT;
  const status = activeCustomStatus(profile);
  const widgets = (profile.profile_widgets ?? []) as ProfileWidget[];
  const since = new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <article
      data-ae-profile={scopeId}
      className={`ae-profile-card ae-card @container relative w-full overflow-hidden rounded-[calc(var(--ae-radius)+6px)] border border-ae-border text-ae-text shadow-2xl ${className}`}
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
          background: `linear-gradient(180deg, color-mix(in srgb, ${primary} 30%, var(--ae-bg-elevated)) 0%, var(--ae-bg-elevated) 45%)`,
          contain: 'layout paint style',
          isolation: 'isolate',
        } as CSSProperties
      }
    >
      <ScopedCss css={profile.custom_css} scopeSelector={`[data-ae-profile="${scopeId}"]`} />
      <ProfileEffectLayer effect={profile.profile_effect} color={isHexColor(profile.accent_color) ? profile.accent_color : undefined} angle={profile.decor?.effectAngle} decorColor={profile.decor?.effect} />

      <div className="ae-profile-banner h-40 w-full @2xl:h-48" style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
        {profile.banner_url && <img src={profile.banner_url} alt="" className="h-full w-full object-cover" draggable={false} style={cropStyle(profile.decor?.bannerCrop)} />}
      </div>

      <div className="relative px-5 pb-5">
        <div className="-mt-16 mb-3 flex items-end gap-3">
          <div className="relative">
            <div className={`p-1.5 ${profile.avatar_shape === 'squircle' ? 'rounded-[30%]' : 'rounded-full'}`} style={{ background: profile.avatar_shape === 'hexagon' ? 'transparent' : 'var(--ae-bg-elevated)' }}>
              <Avatar profile={profile} size={120} />
            </div>
            {status && (
              <div className="ae-pop absolute top-1 left-[122px] w-max max-w-[240px] rounded-2xl border border-ae-border bg-ae-elevated px-3 py-1.5 text-sm shadow-lg">
                {profile.status_emoji && <span className="mr-1">{profile.status_emoji}</span>}
                {status}
                <span className="absolute -bottom-1.5 left-3 h-3 w-3 rounded-full border border-ae-border bg-ae-elevated" />
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2 pb-1">{actions}</div>
        </div>

        <div className="grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="ae-profile-body min-w-0 space-y-4 rounded-ae bg-ae-sunken/60 p-4">
            <header>
              <h2 className="text-2xl leading-tight font-extrabold">
                <StyledName profile={profile} />
              </h2>
              <p className="text-sm text-ae-muted">
                {profile.username}
                {profile.pronouns && <span> • {profile.pronouns}</span>}
              </p>
              <div className="mt-2">
                <BadgeRow badgeIds={profile.badge_ids ?? []} size={26} />
              </div>
            </header>

            <ActivitySections userId={profile.id} />

            {profile.bio && (
              <section>
                <Label>About me</Label>
                <Markdown source={profile.bio} className="text-sm" />
              </section>
            )}

            <section>
              <Label>Member since</Label>
              <p className="flex items-center gap-1.5 text-sm">
                <CalendarIcon size={14} className="text-ae-muted" /> {since}
              </p>
            </section>

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

          <div className="min-w-0">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
              <WidgetIcon size={12} /> Board
            </p>
            <WidgetBoard
              widgets={widgets}
              empty={
                boardEmpty ?? (
                  <div className="grid h-32 place-items-center rounded-ae border border-dashed border-ae-border text-sm text-ae-muted">Nothing on the board yet.</div>
                )
              }
            />
          </div>
        </div>
      </div>
    </article>
  );
}

/** Someone's full profile in a modal. Click outside or press Esc to close. */
export function FullProfileModal({ profile, onClose, footer }: { profile: UserProfile; onClose: () => void; footer?: ReactNode }) {
  useEscape(() => onClose(), true);
  return (
    <div className="ae-backdrop fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="ae-dialog ae-scroll max-h-[calc(100vh-32px)] w-full max-w-[880px] space-y-3 overflow-y-auto">
        <FullProfile profile={profile} />
        {footer && <div className="flex flex-wrap items-start gap-3 [&>*]:min-w-[300px] [&>*]:flex-1">{footer}</div>}
      </div>
    </div>
  );
}
