/** Server sidebar: channels grouped by category, invites, channel creation, leave/delete server. */
import { useMemo, useState } from 'react';
import { useCreateChannel, useCreateInvite, useDeleteServer, useLeaveServer, useServerPermissions } from '../hooks/useChatData';
import { isRowUnread, useUnreadSummary } from '../hooks/useMessageExtras';
import { useNotifyResolver } from '../hooks/useNotifications';
import { NotificationOptions } from './NotificationMenu';
import { useVoiceStates } from '../hooks/useVoiceStates';
import { VoiceOccupantList } from './VoiceOccupants';
import { EventsBar } from './Events';
import { useChannelActions } from '../hooks/useServerAdmin';
import { hasPermission, Permission } from '../lib/permissions';
import { useUiStore } from '../stores/uiStore';
import type { Channel, ChannelSubtype, ChannelType, Server } from '../types/db';
import { useCall } from './CallContext';
import { Dialog, PromptForm } from './Dialog';
import { ForumIcon, HashIcon, ImageIcon, LinkIcon, LogOutIcon, MegaphoneIcon, PlusIcon, StageIcon, TrashIcon, VolumeIcon } from './icons';
import { UserPanel } from './UserPanel';

type NewChannelKind = 'text' | 'announcement' | 'forum' | 'media' | 'voice' | 'stream' | 'category';
const NEW_CHANNEL_KINDS: { kind: NewChannelKind; label: string; hint: string; type: ChannelType; subtype: ChannelSubtype | null }[] = [
  { kind: 'text', label: 'Text', hint: 'Messages, images, threads', type: 'text', subtype: null },
  { kind: 'announcement', label: 'Announcement', hint: 'Mods post; other servers can follow', type: 'text', subtype: 'announcement' },
  { kind: 'forum', label: 'Forum', hint: 'Posts with tags and replies', type: 'text', subtype: 'forum' },
  { kind: 'media', label: 'Media', hint: 'A gallery of images and videos', type: 'text', subtype: 'media' },
  { kind: 'voice', label: 'Voice', hint: 'Talk, video and screen share', type: 'voice', subtype: null },
  { kind: 'stream', label: 'Stage', hint: 'Speakers and an audience', type: 'stream', subtype: null },
  { kind: 'category', label: 'Category', hint: 'Groups channels', type: 'category', subtype: null },
];

export function ChannelGlyph({ type, size = 16 }: { type: ChannelType; size?: number }) {
  if (type === 'voice') return <VolumeIcon size={size} />;
  if (type === 'stream') return <StageIcon size={size} />;
  return <HashIcon size={size} />;
}

/** Like ChannelGlyph, but also distinguishes announcement, forum and media channels. */
export function ChannelIcon({ channel, size = 16 }: { channel: Pick<Channel, 'type' | 'subtype'>; size?: number }) {
  if (channel.subtype === 'announcement') return <MegaphoneIcon size={size} />;
  if (channel.subtype === 'forum') return <ForumIcon size={size} />;
  if (channel.subtype === 'media') return <ImageIcon size={size} />;
  return <ChannelGlyph type={channel.type} size={size} />;
}

export function ChannelSidebar({ userId, server, channels, activeChannelId }: {
  userId: string;
  server: Server;
  channels: Channel[];
  activeChannelId: string | null;
}) {
  const selectChannel = useUiStore((s) => s.selectChannel);
  const selectServer = useUiStore((s) => s.selectServer);
  const { joinChannel } = useCall();
  const { data: perms = 0n } = useServerPermissions(server.id);
  const { byChannel } = useVoiceStates(server.id);
  const createInvite = useCreateInvite();
  const createChannel = useCreateChannel(server.id);
  const leaveServer = useLeaveServer(userId);
  const deleteServer = useDeleteServer(userId);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [newChannel, setNewChannel] = useState<{ parentId: string | null } | null>(null);
  const [newType, setNewType] = useState<NewChannelKind>('text');
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const { resolve } = useNotifyResolver();
  const { data: unread = [] } = useUnreadSummary();
  const unreadById = useMemo(() => new Map(unread.map((r) => [r.scope_id, r])), [unread]);

  const groups = useMemo(() => {
    const categories = channels.filter((c) => c.type === 'category');
    const loose = channels.filter((c) => c.type !== 'category' && !c.parent_id);
    return [
      { category: null as Channel | null, items: loose },
      ...categories.map((cat) => ({ category: cat, items: channels.filter((c) => c.parent_id === cat.id) })),
    ];
  }, [channels]);

  const isOwner = server.owner_id === userId;
  const canManageChannels = isOwner || hasPermission(perms, Permission.MANAGE_CHANNELS);
  const canManageRoles = isOwner || hasPermission(perms, Permission.MANAGE_ROLES);
  const canInvite = isOwner || hasPermission(perms, Permission.CREATE_INVITE);
  const canOpenChannelSettings = canManageChannels || canManageRoles;
  const openServerSettings = useUiStore((s) => s.openServerSettings);
  const openChannelSettings = useUiStore((s) => s.openChannelSettings);
  const channelActions = useChannelActions(server.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drag, setDrag] = useState<Channel | null>(null);
  const [dropHint, setDropHint] = useState<string | null>(null);

  /** Builds the new ordering after dropping `dragged` on a channel (insert before) or a category (append). */
  const drop = (target: Channel) => {
    const dragged = drag;
    setDrag(null);
    setDropHint(null);
    if (!dragged || dragged.id === target.id) return;
    const cats = channels.filter((c) => c.type === 'category');
    if (dragged.type === 'category') {
      if (target.type !== 'category') return;
      const order = cats.filter((c) => c.id !== dragged.id);
      order.splice(order.findIndex((c) => c.id === target.id), 0, dragged);
      channelActions.reorder.mutate(order.map((c, i) => ({ id: c.id, parent_id: null, position: i })));
      return;
    }
    const parentId = target.type === 'category' ? target.id : target.parent_id;
    const group = channels.filter((c) => c.type !== 'category' && c.parent_id === parentId && c.id !== dragged.id);
    const at = target.type === 'category' ? group.length : group.findIndex((c) => c.id === target.id);
    group.splice(at, 0, dragged);
    channelActions.reorder.mutate(group.map((c, i) => ({ id: c.id, parent_id: parentId, position: i })));
  };

  const dragProps = (ch: Channel) =>
    canManageChannels
      ? {
          draggable: true,
          onDragStart: () => setDrag(ch),
          onDragEnd: () => {
            setDrag(null);
            setDropHint(null);
          },
          onDragOver: (e: React.DragEvent) => {
            if (!drag || drag.id === ch.id) return;
            if (drag.type === 'category' && ch.type !== 'category') return;
            e.preventDefault();
            setDropHint(ch.id);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            drop(ch);
          },
        }
      : {};

  const menuItem = 'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-ae-accent hover:text-ae-on-accent';

  return (
    <aside className="ae-panel flex w-60 shrink-0 flex-col border-r border-ae-border">
      <div className="relative">
        {server.banner_url && <img src={server.banner_url} alt="" className="h-24 w-full object-cover" />}
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className={`flex h-12 w-full items-center justify-between gap-2 border-b border-ae-border px-4 text-left hover:bg-ae-hover/50 ${
            server.banner_url ? 'absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent text-white' : ''
          }`}
        >
          <h2 className="truncate font-semibold">{server.name}</h2>
          <span className={`text-xs transition-transform ${menuOpen ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {menuOpen && (
          <div className="absolute inset-x-2 top-12 z-30 space-y-0.5 rounded-ae border border-ae-border bg-ae-elevated p-1.5 shadow-2xl" onMouseLeave={() => setMenuOpen(false)}>
            {canInvite && (
              <button
                type="button"
                className={`${menuItem} text-ae-accent`}
                onClick={() => {
                  setMenuOpen(false);
                  createInvite.mutate(server.id, { onSuccess: setInviteCode });
                }}
              >
                Invite people <LinkIcon size={14} />
              </button>
            )}
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                setMenuOpen(false);
                openServerSettings({ serverId: server.id, tab: 'overview' });
              }}
            >
              Server settings <span>⚙</span>
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                setMenuOpen(false);
                setNotifyOpen(true);
              }}
            >
              Notification settings <span>🔔</span>
            </button>
            {canManageChannels && (
              <>
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    setNewType('text');
                    setNewChannel({ parentId: null });
                  }}
                >
                  Create channel <PlusIcon size={14} />
                </button>
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    setNewType('category');
                    setNewChannel({ parentId: null });
                  }}
                >
                  Create category <PlusIcon size={14} />
                </button>
              </>
            )}
            <div className="my-1 h-px bg-ae-border" />
            <button
              type="button"
              className={`${menuItem} text-ae-danger hover:bg-ae-danger hover:text-white`}
              onClick={() => {
                setMenuOpen(false);
                setConfirm(isOwner ? 'delete' : 'leave');
              }}
            >
              {isOwner ? 'Delete server' : 'Leave server'} {isOwner ? <TrashIcon size={14} /> : <LogOutIcon size={14} />}
            </button>
          </div>
        )}
      </div>

      <EventsBar server={server} />
      <div className="ae-scroll flex-1 space-y-3 overflow-y-auto px-2 py-3">
        {channelActions.reorder.error && <p className="px-2 text-xs text-ae-danger">{channelActions.reorder.error.message}</p>}
        {groups.map(({ category, items }) =>
          !category && items.length === 0 ? null : (
            <div key={category?.id ?? 'loose'}>
              {category && (
                <div
                  {...dragProps(category)}
                  className={`group flex items-center justify-between rounded px-2 pb-1 ${dropHint === category.id ? 'ring-1 ring-ae-accent' : ''}`}
                >
                  <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">{category.name}</span>
                  <span className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100">
                    {canOpenChannelSettings && (
                      <button type="button" title="Edit category" className="text-ae-muted hover:text-ae-text" onClick={() => openChannelSettings(category.id)}>
                        ⚙
                      </button>
                    )}
                    {canManageChannels && (
                      <button
                        type="button"
                        title="Create channel"
                        className="text-ae-muted hover:text-ae-text"
                        onClick={() => {
                          setNewType('text');
                          setNewChannel({ parentId: category.id });
                        }}
                      >
                        <PlusIcon size={14} />
                      </button>
                    )}
                  </span>
                </div>
              )}
              <ul className="space-y-0.5">
                {items.map((ch) => {
                  const row = unreadById.get(ch.id);
                  const isActive = ch.id === activeChannelId;
                  const muted = resolve({ kind: 'channel', id: ch.id, serverId: server.id }).muted;
                  const hasUnread = !isActive && !muted && isRowUnread(row);
                  const mentions = isActive ? 0 : (row?.mention_count ?? 0);
                  return (
                    <li key={ch.id} className={`group/ch relative ${drag?.id === ch.id ? 'opacity-40' : ''}`} {...dragProps(ch)}>
                      {dropHint === ch.id && <span className="absolute -top-0.5 right-1 left-1 h-0.5 rounded bg-ae-accent" />}
                      {hasUnread && <span className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-ae-text" />}
                      <button
                        type="button"
                        onClick={() => selectChannel(server.id, ch.id)}
                        onDoubleClick={() => (ch.type === 'voice' || ch.type === 'stream') && joinChannel(ch)}
                        className={`flex w-full items-center gap-2 rounded-ae px-2 py-1.5 text-left text-sm ${
                          isActive
                            ? 'bg-ae-surface text-ae-text'
                            : hasUnread
                              ? 'font-semibold text-ae-text hover:bg-ae-hover'
                              : muted
                                ? 'text-ae-muted opacity-50 hover:bg-ae-hover hover:opacity-100'
                                : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'
                        }`}
                      >
                        <ChannelIcon channel={ch} />
                        <span className="truncate">{ch.name}</span>
                        {ch.nsfw && <span className="rounded bg-ae-danger/20 px-1 text-[9px] font-bold text-ae-danger">18+</span>}
                        {(byChannel.get(ch.id) ?? []).some((v) => v.streaming) && (
                          <span className="ae-live rounded bg-ae-danger px-1 text-[9px] font-bold text-white">LIVE</span>
                        )}
                        {ch.user_limit != null && (ch.type === 'voice' || ch.type === 'stream') && (
                          <span className="ml-auto rounded bg-ae-sunken px-1 text-[10px] text-ae-muted">
                            {(byChannel.get(ch.id) ?? []).length}/{ch.user_limit}
                          </span>
                        )}
                        {mentions > 0 && <span className="ml-auto rounded-full bg-ae-danger px-1.5 text-[11px] font-bold text-white">{mentions}</span>}
                      </button>
                      {canOpenChannelSettings && (
                        <button
                          type="button"
                          title="Edit channel"
                          className="absolute top-1/2 right-2 hidden -translate-y-1/2 text-xs text-ae-muted group-hover/ch:block hover:text-ae-text"
                          onClick={() => openChannelSettings(ch.id)}
                        >
                          ⚙
                        </button>
                      )}
                      {(ch.type === 'voice' || ch.type === 'stream') && (
                        <VoiceOccupantList channel={ch} states={byChannel.get(ch.id) ?? []} channels={channels} perms={perms} isOwner={isOwner} me={userId} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
        )}
      </div>

      <UserPanel userId={userId} />

      {notifyOpen && (
        <Dialog title={`Notification settings: ${server.name}`} onClose={() => setNotifyOpen(false)}>
          <NotificationOptions scope={{ kind: 'server', id: server.id }} />
          <p className="px-2 text-xs text-ae-muted">Channels follow these settings unless you change them with the 🔔 in a channel&apos;s header.</p>
        </Dialog>
      )}

      {inviteCode && (
        <Dialog title="Invite people" onClose={() => setInviteCode(null)}>
          <p className="text-sm text-ae-muted">Share this code. It expires in 7 days.</p>
          <div className="flex gap-2">
            <input readOnly value={inviteCode} className="flex-1 rounded-ae border border-ae-border bg-ae-sunken px-3 py-2 font-mono text-sm" />
            <button
              type="button"
              className="rounded-ae bg-ae-accent px-4 text-sm font-semibold text-ae-on-accent"
              onClick={() => void navigator.clipboard.writeText(inviteCode)}
            >
              Copy
            </button>
          </div>
        </Dialog>
      )}

      {newChannel && (
        <Dialog title="Create channel" onClose={() => setNewChannel(null)}>
          <PromptForm
            label="Channel name"
            placeholder="new-channel"
            submitLabel="Create"
            pending={createChannel.isPending}
            error={createChannel.error?.message}
            extra={
              <div className="grid grid-cols-2 gap-2">
                {NEW_CHANNEL_KINDS.filter((k) => k.kind === 'category' ? newType === 'category' : newType !== 'category').map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => setNewType(k.kind)}
                    className={`ae-press flex items-start gap-2 rounded-ae border p-2 text-left ${
                      newType === k.kind ? 'border-ae-accent bg-ae-accent/15' : 'border-ae-border hover:bg-ae-hover'
                    }`}
                  >
                    <span className="mt-0.5 text-ae-muted">{k.kind !== 'category' && <ChannelIcon channel={{ type: k.type, subtype: k.subtype }} size={16} />}</span>
                    <span>
                      <span className="block text-sm font-semibold">{k.label}</span>
                      <span className="block text-[11px] text-ae-muted">{k.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            }
            onSubmit={(name) =>
              createChannel.mutate(
                {
                  name: ['text', 'announcement', 'forum', 'media'].includes(newType) ? name.toLowerCase().replace(/\s+/g, '-') : name,
                  type: NEW_CHANNEL_KINDS.find((k) => k.kind === newType)!.type,
                  subtype: NEW_CHANNEL_KINDS.find((k) => k.kind === newType)!.subtype,
                  parentId: newType === 'category' ? null : newChannel.parentId,
                },
                {
                  onSuccess: (ch) => {
                    if (ch.type !== 'category') selectChannel(server.id, ch.id);
                    setNewChannel(null);
                  },
                },
              )
            }
          />
        </Dialog>
      )}

      {confirm && (
        <Dialog title={confirm === 'delete' ? `Delete ${server.name}?` : `Leave ${server.name}?`} onClose={() => setConfirm(null)}>
          <p className="text-sm text-ae-muted">
            {confirm === 'delete'
              ? 'This permanently deletes the server, all of its channels and every message. It cannot be undone.'
              : "You won't be able to rejoin unless you get a new invite."}
          </p>
          {(leaveServer.error || deleteServer.error) && (
            <p className="text-sm text-ae-danger">{(leaveServer.error ?? deleteServer.error)?.message}</p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-ae bg-ae-danger px-4 py-2 text-sm font-semibold text-white"
              onClick={() => {
                const m = confirm === 'delete' ? deleteServer : leaveServer;
                m.mutate(server.id, {
                  onSuccess: () => {
                    setConfirm(null);
                    selectServer(null);
                  },
                });
              }}
            >
              {confirm === 'delete' ? 'Delete server' : 'Leave server'}
            </button>
          </div>
        </Dialog>
      )}
    </aside>
  );
}
