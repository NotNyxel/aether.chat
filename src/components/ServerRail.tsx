/** Vertical server list with create-server and join-by-invite actions. */
import { useMemo, useState } from 'react';
import { useCreateServer, useJoinServer } from '../hooks/useChatData';
import { isRowUnread, useUnreadSummary } from '../hooks/useMessageExtras';
import { resolveNotify, useNotifyResolver } from '../hooks/useNotifications';
import { useUiStore } from '../stores/uiStore';
import type { Server } from '../types/db';
import { Dialog, PromptForm } from './Dialog';
import { PlusIcon } from './icons';
import { InboxButton } from './Inbox';

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
  const [dialog, setDialog] = useState<null | 'create' | 'join'>(null);
  const create = useCreateServer(userId);
  const join = useJoinServer(userId);
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
        title="Home: friends and direct messages"
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
      <InboxButton userId={userId} servers={servers} />
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
              title={serverMuted ? `${s.name} (muted)` : s.name}
              onClick={() => selectServer(s.id)}
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
        title="Create a server"
        onClick={() => setDialog('create')}
        className="grid h-12 w-12 place-items-center rounded-[24px] bg-ae-surface text-ae-success hover:rounded-[16px] hover:bg-ae-success hover:text-black"
      >
        <PlusIcon />
      </button>
      <button
        type="button"
        title="Join with an invite code"
        onClick={() => setDialog('join')}
        className="grid h-12 w-12 place-items-center rounded-[24px] bg-ae-surface text-xs font-semibold text-ae-muted hover:rounded-[16px] hover:bg-ae-hover hover:text-ae-text"
      >
        Join
      </button>

      {dialog === 'create' && (
        <Dialog title="Create a server" onClose={() => setDialog(null)}>
          <PromptForm
            label="Server name"
            placeholder="My awesome server"
            submitLabel="Create"
            pending={create.isPending}
            error={create.error?.message}
            onSubmit={(name) =>
              create.mutate(name, {
                onSuccess: (server) => {
                  selectServer(server.id);
                  setDialog(null);
                },
              })
            }
          />
        </Dialog>
      )}
      {dialog === 'join' && (
        <Dialog title="Join a server" onClose={() => setDialog(null)}>
          <PromptForm
            label="Invite code"
            placeholder="a1b2c3d4e5"
            submitLabel="Join"
            pending={join.isPending}
            error={join.error?.message}
            onSubmit={(code) =>
              join.mutate(code, {
                onSuccess: (serverId) => {
                  selectServer(serverId);
                  setDialog(null);
                },
              })
            }
          />
        </Dialog>
      )}
    </nav>
  );
}
