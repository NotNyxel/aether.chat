/** Vertical server list with create-server and join-by-invite actions. */
import { useAddServer } from './Invites';
import { inviteLink } from '../lib/invites';
import { ask } from './ConfirmDialog';
import { toast } from './Toaster';
import { openContextMenu } from './ContextMenu';
import { useMemo } from 'react';
import { useCreateInvite, useLeaveServer } from '../hooks/useChatData';
import { isRowUnread, useMarkRead, useUnreadSummary } from '../hooks/useMessageExtras';
import { muteUntil, resolveNotify, useNotifyResolver, useSetNotificationSetting } from '../hooks/useNotifications';
import { useUiStore } from '../stores/uiStore';
import type { Server } from '../types/db';
import { BellIcon, BellOffIcon, CheckIcon, CompassIcon, LogOutIcon, MailIcon, PlusIcon, SettingsIcon } from './icons';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function ServerRail({ userId, servers, activeId, homeBadge }: {
  userId: string;
  servers: Server[];
  /** Active server id, or null when Home is open. */
  activeId: string | null;
  /** Unread DMs + pending friend requests. */
  homeBadge: number;
}) {
  const selectServer = useUiStore((s) => s.selectServer);
  const openHome = useUiStore((s) => s.openHome);
  const addServer = useAddServer((s) => s.set);
  const leave = useLeaveServer(userId);
  const invite = useCreateInvite();
  const markRead = useMarkRead();
  const setNotify = useSetNotificationSetting();
  const openServerSettings = useUiStore((s) => s.openServerSettings);
  const serverMenu = (e: React.MouseEvent, s: Server) => {
    const muted = resolveNotify(notifyMap, { kind: 'server', id: s.id }).muted;
    const unreadRows = unread.filter((r) => r.server_id === s.id && isRowUnread(r));
    openContextMenu(e, [
      {
        label: 'Mark as read',
        icon: <CheckIcon size={15} />,
        disabled: unreadRows.length === 0,
        onClick: () => unreadRows.forEach((r) => markRead({ kind: 'channel', id: r.scope_id })),
      },
      'divider',
      {
        label: 'Invite people',
        icon: <MailIcon size={15} />,
        onClick: () =>
          invite.mutate(s.id, {
            onSuccess: (code) => void navigator.clipboard.writeText(inviteLink(code)).then(() => toast.success(`Copied ${inviteLink(code)} (valid 7 days).`, <MailIcon size={14} />)),
            onError: (err) => toast.error(err.message),
          }),
      },
      muted
        ? { label: 'Unmute server', icon: <BellIcon size={15} />, onClick: () => setNotify.mutate({ scopeId: s.id, kind: 'server', patch: { muted_until: null } }) }
        : { label: 'Mute server for 1 hour', icon: <BellOffIcon size={15} />, onClick: () => setNotify.mutate({ scopeId: s.id, kind: 'server', patch: { muted_until: muteUntil(60) } }) },
      !muted && { label: 'Mute until I turn it back on', icon: <BellOffIcon size={15} />, onClick: () => setNotify.mutate({ scopeId: s.id, kind: 'server', patch: { muted_until: muteUntil(null) } }) },
      { label: 'Server settings', icon: <SettingsIcon size={15} />, onClick: () => openServerSettings({ serverId: s.id, tab: 'overview' }) },
      'divider',
      { label: 'Copy server ID', icon: '#', onClick: () => void navigator.clipboard.writeText(s.id).then(() => toast('ID copied', '#')) },
      s.owner_id !== userId && {
        label: 'Leave server',
        icon: <LogOutIcon size={15} />,
        danger: true,
        onClick: async () => (await ask(`Leave ${s.name}?`)) && leave.mutate(s.id, { onSuccess: () => openHome(), onError: (err) => toast.error(err.message) }),
      },
    ]);
  };
  const { data: unread = [] } = useUnreadSummary();
  const { map: notifyMap } = useNotifyResolver();
  const perServer = useMemo(() => {
    const map = new Map<string, { unread: boolean; mentions: number }>();
    for (const r of unread) {
      if (!r.server_id) continue;
      const cur = map.get(r.server_id) ?? { unread: false, mentions: 0 };
      const muted = resolveNotify(notifyMap, { kind: 'channel', id: r.scope_id, serverId: r.server_id }).muted;
      map.set(r.server_id, { unread: cur.unread || (!muted && isRowUnread(r)), mentions: cur.mentions + r.mention_count });
    }
    return map;
  }, [unread, notifyMap]);

  return (
    <nav className="ae-scroll flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-ae-sunken py-3" aria-label="Servers">
      <button
        type="button"
        data-tip="Direct messages"
        data-tip-side="right"
        aria-label="Home"
        onClick={() => openHome()}
        className={`relative grid h-12 w-12 place-items-center transition-all ${
          activeId === null ? 'rounded-[16px] bg-ae-accent ae-glow' : 'rounded-[24px] bg-ae-surface hover:rounded-[16px] hover:bg-ae-hover'
        }`}
      >
        <img src="/icon.svg" alt="" className="h-8 w-8" draggable={false} />
        {homeBadge > 0 && (
          <span className="absolute -right-1 -bottom-1 min-w-5 rounded-full border-2 border-ae-sunken bg-ae-danger px-1 text-center text-[11px] font-bold text-white">
            {homeBadge > 99 ? '99+' : homeBadge}
          </span>
        )}
      </button>
      <div className="my-1 h-px w-8 bg-ae-border" />
      {servers.map((s) => {
        const active = s.id === activeId;
        const state = perServer.get(s.id);
        const serverMuted = resolveNotify(notifyMap, { kind: 'server', id: s.id }).muted;
        return (
          <div key={s.id} className="relative">
            {/* Discord-style pill: tall for the active server, a dot for unread ones */}
            <span
              className={`absolute top-1/2 -left-3 w-1 -translate-y-1/2 rounded-r-full bg-ae-text transition-all ${
                active ? 'h-9' : state?.unread ? 'h-2' : 'h-0'
              }`}
            />
            <button
              type="button"
              data-tip={serverMuted ? `${s.name} (muted)` : s.name}
              data-tip-side="right"
              aria-label={s.name}
              onClick={() => selectServer(s.id)}
              onContextMenu={(e) => serverMenu(e, s)}
              className={`relative grid h-12 w-12 place-items-center overflow-hidden text-sm font-semibold transition-all ${serverMuted && !active ? 'opacity-50 ' : ''}${
                active ? 'rounded-[16px] bg-ae-accent text-ae-on-accent ae-glow' : 'rounded-[24px] bg-ae-surface hover:rounded-[16px] hover:bg-ae-hover'
              }`}
            >
              {s.icon_url ? <img src={s.icon_url} alt="" className="h-full w-full object-cover" /> : initials(s.name)}
            </button>
            {!!state?.mentions && (
              <span className="absolute -right-1 -bottom-1 min-w-5 rounded-full border-2 border-ae-sunken bg-ae-danger px-1 text-center text-[11px] font-bold text-white">
                {state.mentions > 99 ? '99+' : state.mentions}
              </span>
            )}
          </div>
        );
      })}

      <div className="my-1 h-px w-8 bg-ae-border" />
      <button
        type="button"
        data-tip="Add a server"
        data-tip-side="right"
        aria-label="Add a server"
        onClick={() => addServer('menu')}
        className="grid h-12 w-12 place-items-center rounded-[24px] bg-ae-surface text-ae-success transition-all hover:rounded-[16px] hover:bg-ae-success hover:text-black"
      >
        <PlusIcon size={22} />
      </button>
      <button
        type="button"
        data-tip="Join a server"
        data-tip-side="right"
        aria-label="Join a server"
        onClick={() => addServer('join')}
        className="grid h-12 w-12 place-items-center rounded-[24px] bg-ae-surface text-ae-success transition-all hover:rounded-[16px] hover:bg-ae-success hover:text-black"
      >
        <CompassIcon size={22} />
      </button>
    </nav>
  );
}
