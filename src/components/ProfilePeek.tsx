/**
 * The small profile card that opens next to a name or avatar you click (and the same card, taller,
 * as the profile panel on the right of a DM). It has a "view full profile" button for the big one.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useProfile, useServerMembers } from '../hooks/useChatData';
import { activeCustomStatus } from '../hooks/useDesktop';
import { PresenceDot, usePresenceOf } from '../hooks/usePresence';
import { useConversationActions } from '../hooks/useSocialData';
import { useUserMenu } from '../hooks/useUserMenu';
import { cardFrameAttrs, cardVars } from '../lib/cardDecor';
import { themeAttrs } from '../lib/cosmetics';
import { useEscape } from '../lib/escape';
import { Markdown } from '../lib/markdown';
import { DEFAULT_PROFILE_ACCENT, DEFAULT_PROFILE_PRIMARY } from '../lib/profileDecor';
import { useSupabase } from '../lib/supabase';
import { EmojiText } from '../lib/twemoji';
import { isHexColor } from '../theme/presets';
import { useUiStore } from '../stores/uiStore';
import type { Server, UserProfile } from '../types/db';
import { ActivitySections } from './ActivityCards';
import { CalendarIcon, EditIcon, MoreIcon, OpenFullIcon, SendIcon } from './icons';
import { Avatar, BadgeRow, cropStyle, ProfileEffectLayer, StyledName } from './ProfileCard';
import { MutualSummary, NoteFields, ProfileActionButtons, useRelationship } from './ProfileParts';
import { toast } from './Toaster';

const CARD_W = 300;

/** Their profile, with their server profile (nickname, avatar, banner, bio) on top inside a server. */
export function useServerProfile(userId: string, serverId: string | null): UserProfile | null | undefined {
  const { data } = useProfile(userId);
  const { data: members = [] } = useServerMembers(serverId);
  const member = serverId ? members.find((m) => m.user_id === userId) : undefined;
  if (!data || !member) return data;
  return {
    ...data,
    display_name: member.nickname || data.display_name,
    avatar_url: member.avatar_url ?? data.avatar_url,
    banner_url: member.banner_url ?? data.banner_url,
    bio: member.bio ?? data.bio,
  };
}

function QuickMessage({ userId, name }: { userId: string; name: string }) {
  const sb = useSupabase();
  const convo = useConversationActions();
  const openHome = useUiStore((s) => s.openHome);
  const peekProfile = useUiStore((s) => s.peekProfile);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = () => {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    convo.openDm.mutate(userId, {
      onSuccess: async (id) => {
        const { error } = await sb.from('messages').insert({ conversation_id: id, content });
        setBusy(false);
        if (error) return toast.error(error.message);
        setText('');
        peekProfile(null);
        openHome(id);
      },
      onError: (e) => {
        setBusy(false);
        toast.error(e.message);
      },
    });
  };
  return (
    <div className="flex items-center gap-2 rounded-ae border border-ae-border bg-ae-sunken/80 px-3 focus-within:border-ae-accent">
      <input
        className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ae-muted"
        placeholder={`Message @${name}`}
        value={text}
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
      />
      {text.trim() && (
        <button type="button" aria-label="Send" className="text-ae-accent" disabled={busy} onClick={send}>
          <SendIcon size={16} />
        </button>
      )}
    </div>
  );
}

export function MiniProfile({
  userId,
  me,
  serverId = null,
  variant = 'card',
  onClose,
}: {
  userId: string;
  me: string;
  serverId?: string | null;
  variant?: 'card' | 'panel';
  onClose?: () => void;
}) {
  const profile = useServerProfile(userId, serverId);
  const presence = usePresenceOf(userId);
  const showProfile = useUiStore((s) => s.showProfile);
  const openStudio = useUiStore((s) => s.openStudio);
  const userMenu = useUserMenu(me);
  const r = useRelationship(me, userId);
  if (!profile) return <div className={variant === 'card' ? 'h-[320px] w-[300px] rounded-[14px] bg-ae-elevated' : 'h-full w-full'} />;

  const self = userId === me;
  const panel = variant === 'panel';
  const primary = isHexColor(profile.primary_color) ? profile.primary_color : DEFAULT_PROFILE_PRIMARY;
  const accent = isHexColor(profile.accent_color) ? profile.accent_color : DEFAULT_PROFILE_ACCENT;
  const status = activeCustomStatus(profile);
  const full = () => {
    onClose?.();
    showProfile(userId);
  };
  const since = new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <article
      className={`ae-card relative flex flex-col text-ae-text ${panel ? 'ae-scroll h-full min-h-0 w-full overflow-x-hidden overflow-y-auto' : 'overflow-visible rounded-[14px] border border-ae-border shadow-2xl'}`}
      style={
        {
          width: panel ? undefined : CARD_W,
          '--card-a': primary,
          '--card-b': accent,
          ...cardVars(profile),
          background: `linear-gradient(180deg, color-mix(in srgb, ${primary} 30%, var(--ae-bg-elevated)) 0%, color-mix(in srgb, ${accent} 12%, var(--ae-bg-elevated)) 100%)`,
        } as CSSProperties
      }
      data-card={profile.card_style ?? 'solid'}
      data-ct={themeAttrs(profile.card_style, profile.decor).pattern}
      {...(panel ? {} : cardFrameAttrs(profile))}
    >
      <div className={`relative shrink-0 overflow-hidden ${panel ? '' : 'rounded-t-[14px]'}`}>
        <ProfileEffectLayer effect={profile.profile_effect} color={isHexColor(profile.accent_color) ? profile.accent_color : undefined} angle={profile.decor?.effectAngle} decorColor={profile.decor?.effect} motion={profile.decor?.effectMotion} />
        <div className={panel ? 'h-[120px]' : 'h-[105px]'} style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
          {profile.banner_url && <img src={profile.banner_url} alt="" className="h-full w-full object-cover" draggable={false} style={cropStyle(profile.decor?.bannerCrop)} />}
        </div>
        <div className="absolute top-2 right-2 flex gap-1.5">
          <button type="button" aria-label="View full profile" data-tip="View full profile" onClick={full} className="grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/65">
            <OpenFullIcon size={15} />
          </button>
          {!self && (
            <button type="button" aria-label="More" data-tip="More" onClick={(e) => userMenu(e, userId, [], serverId)} className="grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/65">
              <MoreIcon size={16} />
            </button>
          )}
        </div>
      </div>

      <div className={`relative flex flex-1 flex-col px-4 ${panel ? 'pb-4' : 'pb-3'}`}>
        <div className="-mt-11 flex items-end gap-2">
          <button type="button" onClick={full} aria-label="View full profile" className="relative shrink-0 rounded-full">
            <span className="block rounded-full p-1.5" style={{ background: 'var(--ae-bg-elevated)' }}>
              <Avatar profile={profile} size={80} />
            </span>
            <PresenceDot status={presence} size={18} className="absolute right-1.5 bottom-1.5 z-10 ring-[4px] ring-ae-elevated" />
          </button>
          {(status || profile.status_emoji) && (
            <div className="ae-pop relative mb-9 max-w-[170px] min-w-0 rounded-2xl border border-ae-border bg-ae-elevated px-2.5 py-1.5 text-xs shadow-lg">
              <span className="absolute -bottom-1.5 left-0.5 h-2.5 w-2.5 rounded-full border border-ae-border bg-ae-elevated" />
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
        </div>

        <div className="mt-1.5">
          <h2 className="text-lg leading-tight font-extrabold">
            <StyledName profile={profile} />
          </h2>
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-ae-muted">
            <span>{profile.username}</span>
            {profile.pronouns && <span>• {profile.pronouns}</span>}
            {(profile.badge_ids ?? []).length > 0 && (
              <span className="ml-0.5 inline-flex rounded-md bg-ae-sunken/70 px-1 py-0.5">
                <BadgeRow badgeIds={profile.badge_ids ?? []} size={16} />
              </span>
            )}
          </div>
        </div>

        <div className="mt-2.5">
          <MutualSummary me={me} userId={userId} onOpen={full} />
        </div>

        {profile.bio && (
          <div className="mt-2.5 text-sm">
            <div className={panel ? '' : 'line-clamp-4'}>
              <Markdown source={profile.bio} className="text-[13px]" />
            </div>
            {!panel && profile.bio.length > 140 && (
              <button type="button" className="mt-1 text-xs font-semibold hover:underline" onClick={full}>
                View Full Bio
              </button>
            )}
          </div>
        )}

        <div className="mt-2.5 space-y-2 empty:hidden">
          <ActivitySections userId={userId} />
        </div>

        {panel && (
          <>
            <section className="mt-4 rounded-ae bg-ae-sunken/60 p-3">
              <h3 className="mb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Member since</h3>
              <p className="flex items-center gap-1.5 text-sm">
                <CalendarIcon size={14} className="text-ae-muted" /> {since}
              </p>
            </section>
            {!self && (
              <section className="mt-3 rounded-ae bg-ae-sunken/60 p-3">
                <NoteFields me={me} userId={userId} />
              </section>
            )}
            <div className="mt-auto pt-4">
              <button type="button" onClick={full} className="ae-press w-full rounded-ae bg-ae-surface py-2 text-sm font-semibold hover:bg-ae-hover">
                View Full Profile
              </button>
            </div>
          </>
        )}

        {!panel && (
          <div className="mt-3">
            {self ? (
              <button
                type="button"
                className="ae-press flex w-full items-center justify-center gap-2 rounded-ae bg-ae-surface py-2 text-sm font-semibold hover:bg-ae-hover"
                onClick={() => {
                  onClose?.();
                  openStudio();
                }}
              >
                <EditIcon size={15} /> Edit Profile
              </button>
            ) : r.blocked ? (
              <div className="flex gap-2">
                <ProfileActionButtons me={me} userId={userId} onDone={onClose} />
              </div>
            ) : (
              <QuickMessage userId={userId} name={profile.username} />
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** Renders the open small profile card next to whatever was clicked. */
export function ProfilePeekLayer({ me, server }: { me: string; server: Server | null }) {
  const peek = useUiStore((s) => s.peek);
  const peekProfile = useUiStore((s) => s.peekProfile);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = () => peekProfile(null);
  useEscape(close, !!peek);

  useLayoutEffect(() => {
    if (!peek || !ref.current) return setPos(null);
    const el = ref.current;
    const place = () => {
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { rect } = peek;
    let left = rect.right + 10;
    if (left + CARD_W > vw - 8) left = rect.left - 10 - CARD_W;
    if (left < 8) left = Math.min(Math.max(8, rect.left), vw - CARD_W - 8);
    const top = Math.max(8, Math.min(rect.top, vh - h - 8));
    setPos({ left, top });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [peek]);

  useLayoutEffect(() => {
    if (!peek) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest('[role="menu"], .ae-backdrop, [role="dialog"]')) return;
      close();
    };
    const onResize = () => close();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('resize', onResize);
    };
  });

  if (!peek) return null;
  const phone = window.matchMedia('(max-width: 767px)').matches;
  if (phone)
    return (
      <div className="ae-backdrop fixed inset-0 z-[60] bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <div ref={ref} className="ae-sheet absolute inset-x-0 bottom-0 flex justify-center px-2 pb-[max(8px,env(safe-area-inset-bottom))]">
          <div className="w-full max-w-[420px] [&>article]:!w-full">
            <MiniProfile key={peek.userId} userId={peek.userId} me={me} serverId={server?.id ?? null} onClose={close} />
          </div>
        </div>
      </div>
    );
  return (
    <div
      ref={ref}
      className="ae-pop fixed z-[60]"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      <MiniProfile key={peek.userId} userId={peek.userId} me={me} serverId={server?.id ?? null} onClose={close} />
    </div>
  );
}
