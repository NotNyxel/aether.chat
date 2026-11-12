/**
 * The popout from the user panel (bottom left): your banner, avatar with a status thought bubble,
 * name, username and pronouns, badges, bio and activity, then Edit Profile, the status picker,
 * Switch Accounts and Copy User ID.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useProfile, useUpdateProfile } from '../hooks/useChatData';
import { activeCustomStatus } from '../hooks/useDesktop';
import { PresenceDot, STATUS_LABELS, type VisibleStatus } from '../hooks/usePresence';
import { addAccount, rememberProfile, savedAccounts, switchAccount, type SavedAccount } from '../lib/accounts';
import { Markdown } from '../lib/markdown';
import { useSupabase } from '../lib/supabase';
import { isHexColor } from '../theme/presets';
import { useUiStore } from '../stores/uiStore';
import type { PresenceStatus } from '../types/db';
import { ActivitySections } from './ActivityCards';
import { CheckIcon, ChevronRightIcon, CopyIcon, EditIcon, IdCardIcon, PlusIcon, SwitchIcon, UserIcon } from './icons';
import { Avatar, BadgeRow, ProfileEffectLayer, StyledName } from './ProfileCard';
import { toast } from './Toaster';

const STATUS_OPTIONS: { id: PresenceStatus; hint?: string }[] = [
  { id: 'online' },
  { id: 'idle' },
  { id: 'dnd', hint: 'You won’t get desktop notifications.' },
  { id: 'invisible', hint: 'You’ll look offline, but can still use everything.' },
];

function Row({ icon, label, right, onClick, onMouseEnter, active }: { icon: ReactNode; label: ReactNode; right?: ReactNode; onClick?: () => void; onMouseEnter?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-ae-hover ${active ? 'bg-ae-hover' : ''}`}
    >
      <span className="grid w-5 place-items-center text-ae-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {right}
    </button>
  );
}

function useSaved(): SavedAccount[] {
  const [list, setList] = useState(savedAccounts);
  useEffect(() => {
    const on = () => setList(savedAccounts());
    window.addEventListener('aether-accounts', on);
    return () => window.removeEventListener('aether-accounts', on);
  }, []);
  return list;
}

export function UserPopout({ userId, shownStatus, onClose, onEditStatus }: { userId: string; shownStatus: VisibleStatus; onClose: () => void; onEditStatus: () => void }) {
  const sb = useSupabase();
  const { data: me } = useProfile(userId);
  const update = useUpdateProfile(userId);
  const openStudio = useUiStore((s) => s.openStudio);
  const showProfile = useUiStore((s) => s.showProfile);
  const [sub, setSub] = useState<'status' | 'accounts' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const accounts = useSaved();

  useEffect(() => {
    if (me) rememberProfile(me);
  }, [me]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('[data-user-panel]')) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  if (!me) return null;
  const status = me.presence_status ?? 'online';
  const custom = activeCustomStatus(me);
  const primary = isHexColor(me.primary_color) ? me.primary_color : 'var(--ae-surface)';
  const accent = isHexColor(me.accent_color) ? me.accent_color : 'var(--ae-accent)';

  return (
    <div
      ref={ref}
      className="ae-pop absolute bottom-full left-2 z-30 mb-2 w-[320px]"
      onMouseLeave={() => setSub(null)}
    >
      <div
        className="ae-card relative overflow-visible rounded-[calc(var(--ae-radius)+4px)] border border-ae-border shadow-2xl"
        data-card={me.card_style ?? 'solid'}
        data-cardframe={me.card_frame || 'none'}
        style={
          {
            '--card-a': primary,
            '--card-b': accent,
            background: `linear-gradient(180deg, color-mix(in srgb, ${primary} 35%, var(--ae-bg-elevated)) 0%, var(--ae-bg-elevated) 50%)`,
          } as CSSProperties
        }
      >
        <div className="relative overflow-hidden rounded-t-[calc(var(--ae-radius)+4px)]">
          <ProfileEffectLayer effect={me.profile_effect} color={isHexColor(me.accent_color) ? me.accent_color : undefined} />
          <div className="h-[104px]" style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
            {me.banner_url && <img src={me.banner_url} alt="" className="h-full w-full object-cover" draggable={false} />}
          </div>
        </div>

        <div className="relative px-4 pb-3">
          <div className="-mt-11 flex items-end gap-2">
            <button type="button" className="relative shrink-0 rounded-full" onClick={() => { showProfile(userId); onClose(); }} aria-label="View profile">
              <span className="block rounded-full p-1.5" style={{ background: 'var(--ae-bg-elevated)' }}>
                <Avatar profile={me} size={80} />
              </span>
              <PresenceDot status={shownStatus} size={20} className="absolute right-1 bottom-1 z-10 ring-[4px] ring-ae-elevated" />
            </button>
            {/* Thought bubble */}
            <button
              type="button"
              onClick={() => {
                onEditStatus();
                onClose();
              }}
              className="ae-lift relative mb-8 max-w-[190px] min-w-0 rounded-2xl border border-ae-border bg-ae-elevated px-3 py-1.5 text-left text-sm shadow-lg"
            >
              <span className="absolute -bottom-2 -left-1 h-3 w-3 rounded-full border border-ae-border bg-ae-elevated" />
              <span className="absolute -bottom-4 -left-3 h-1.5 w-1.5 rounded-full border border-ae-border bg-ae-elevated" />
              {custom || me.status_emoji ? (
                <span className="line-clamp-2">
                  {me.status_emoji && <span className="mr-1">{me.status_emoji}</span>}
                  {custom}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-ae-muted">
                  <PlusIcon size={13} /> Add status
                </span>
              )}
            </button>
          </div>

          <div className="mt-2">
            <p className="text-xl leading-tight font-extrabold">
              <StyledName profile={me} />
            </p>
            <p className="text-sm text-ae-muted">
              {me.username}
              {me.pronouns && <span> • {me.pronouns}</span>}
            </p>
            {(me.badge_ids ?? []).length > 0 && (
              <div className="mt-2">
                <BadgeRow badgeIds={me.badge_ids} size={22} />
              </div>
            )}
          </div>

          {me.bio && (
            <div className="mt-2 line-clamp-3 text-sm">
              <Markdown source={me.bio} />
            </div>
          )}
          <div className="mt-2 space-y-3 empty:hidden">
            <ActivitySections userId={userId} />
          </div>

          <div className="relative mt-3 space-y-0.5 rounded-ae bg-ae-sunken/80 p-1.5">
            <Row
              icon={<EditIcon size={16} />}
              label="Edit Profile"
              onMouseEnter={() => setSub(null)}
              onClick={() => {
                openStudio();
                onClose();
              }}
            />
            <Row
              icon={<PresenceDot status={status === 'invisible' ? 'offline' : status} size={12} />}
              label={STATUS_LABELS[status]}
              right={<ChevronRightIcon size={15} className="text-ae-muted" />}
              active={sub === 'status'}
              onMouseEnter={() => setSub('status')}
              onClick={() => setSub('status')}
            />
            <div className="my-1 h-px bg-ae-border" />
            <Row
              icon={<SwitchIcon size={16} />}
              label="Switch Accounts"
              right={<ChevronRightIcon size={15} className="text-ae-muted" />}
              active={sub === 'accounts'}
              onMouseEnter={() => setSub('accounts')}
              onClick={() => setSub('accounts')}
            />
            <Row
              icon={<IdCardIcon size={16} />}
              label="Copy User ID"
              onMouseEnter={() => setSub(null)}
              onClick={() => {
                void navigator.clipboard.writeText(userId).then(() => toast.success('User ID copied.', <CopyIcon size={14} />));
                onClose();
              }}
            />

            {sub === 'status' && (
              <div className="ae-pop absolute top-0 left-full ml-2 w-[260px] rounded-ae border border-ae-border bg-ae-elevated p-1.5 shadow-2xl">
                {STATUS_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-ae-hover"
                    onClick={() => {
                      update.mutate({ presence_status: o.id });
                      onClose();
                    }}
                  >
                    <PresenceDot status={o.id === 'invisible' ? 'offline' : o.id} size={12} className="mt-1" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{STATUS_LABELS[o.id]}</span>
                      {o.hint && <span className="block text-xs text-ae-muted">{o.hint}</span>}
                    </span>
                    {status === o.id && <CheckIcon size={15} className="mt-0.5 text-ae-accent" />}
                  </button>
                ))}
              </div>
            )}
            {sub === 'accounts' && (
              <div className="ae-pop absolute top-12 left-full ml-2 w-[260px] rounded-ae border border-ae-border bg-ae-elevated p-1.5 shadow-2xl">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    disabled={a.id === userId}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-ae-hover disabled:hover:bg-transparent"
                    onClick={() => void switchAccount(sb, a.id).catch((e: Error) => toast.error(e.message))}
                  >
                    {a.avatar_url ? (
                      <img src={a.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-ae-surface text-ae-muted">
                        <UserIcon size={15} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{a.display_name || a.username || 'Account'}</span>
                      <span className="block truncate text-xs text-ae-muted">{a.id === userId ? 'Active now' : a.username}</span>
                    </span>
                    {a.id === userId && <CheckIcon size={15} className="text-ae-accent" />}
                  </button>
                ))}
                <div className="my-1 h-px bg-ae-border" />
                <button type="button" className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-ae-hover" onClick={addAccount}>
                  <span className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-ae-border text-ae-muted">
                    <PlusIcon size={15} />
                  </span>
                  Add an account
                </button>
                <p className="px-2 pt-1 text-[11px] text-ae-muted">Accounts are remembered on this device only.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
