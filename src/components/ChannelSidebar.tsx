/** Server sidebar: channels grouped by category, invites, channel creation, leave/delete server. */
import { useMemo, useState } from 'react';
import { useCreateChannel, useCreateInvite, useDeleteServer, useLeaveServer, useProfile, useServerPermissions } from '../hooks/useChatData';
import { hasPermission, Permission } from '../lib/permissions';
import { useUiStore } from '../stores/uiStore';
import type { Channel, ChannelType, Server } from '../types/db';
import { useCall } from './CallContext';
import { Dialog, PromptForm } from './Dialog';
import { CameraIcon, HashIcon, LinkIcon, LogOutIcon, MicOffIcon, PlusIcon, ScreenIcon, StageIcon, TrashIcon, VolumeIcon } from './icons';
import { Avatar } from './ProfileCard';
import { UserPanel } from './UserPanel';

export function ChannelGlyph({ type, size = 16 }: { type: ChannelType; size?: number }) {
  if (type === 'voice') return <VolumeIcon size={size} />;
  if (type === 'stream') return <StageIcon size={size} />;
  return <HashIcon size={size} />;
}

function VoiceMember({ userId, speaking, muted, camera, screen }: { userId: string; speaking: boolean; muted: boolean; camera: boolean; screen: boolean }) {
  const { data: profile } = useProfile(userId);
  return (
    <li className="flex items-center gap-2 py-0.5 pl-8 text-sm text-ae-muted">
      <Avatar profile={profile} size={20} speaking={speaking} showFrame={false} />
      <span className="truncate">{profile?.display_name || profile?.username || '…'}</span>
      <span className="ml-auto flex items-center gap-1">
        {screen && <ScreenIcon size={12} className="text-ae-accent" />}
        {camera && <CameraIcon size={12} />}
        {muted && <MicOffIcon size={12} className="text-ae-danger" />}
      </span>
    </li>
  );
}

export function ChannelSidebar({ userId, server, channels, activeChannelId }: {
  userId: string;
  server: Server;
  channels: Channel[];
  activeChannelId: string | null;
}) {
  const selectChannel = useUiStore((s) => s.selectChannel);
  const selectServer = useUiStore((s) => s.selectServer);
  const { voice, room } = useCall();
  const { data: perms = 0n } = useServerPermissions(server.id);
  const createInvite = useCreateInvite();
  const createChannel = useCreateChannel(server.id);
  const leaveServer = useLeaveServer(userId);
  const deleteServer = useDeleteServer(userId);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [newChannel, setNewChannel] = useState<{ parentId: string | null } | null>(null);
  const [newType, setNewType] = useState<ChannelType>('text');
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);

  const groups = useMemo(() => {
    const categories = channels.filter((c) => c.type === 'category');
    const loose = channels.filter((c) => c.type !== 'category' && !c.parent_id);
    return [
      { category: null as Channel | null, items: loose },
      ...categories.map((cat) => ({ category: cat, items: channels.filter((c) => c.parent_id === cat.id) })),
    ];
  }, [channels]);

  const isOwner = server.owner_id === userId;
  const canManageChannels = hasPermission(perms, Permission.MANAGE_CHANNELS);
  const canInvite = hasPermission(perms, Permission.CREATE_INVITE);

  return (
    <aside className="ae-panel flex w-60 shrink-0 flex-col border-r border-ae-border">
      <header className="flex h-12 items-center justify-between gap-2 border-b border-ae-border px-4">
        <h2 className="truncate font-semibold">{server.name}</h2>
        <div className="flex shrink-0 items-center gap-2 text-ae-muted">
          {canInvite && (
            <button type="button" title="Create invite" className="hover:text-ae-text" onClick={() => createInvite.mutate(server.id, { onSuccess: setInviteCode })}>
              <LinkIcon size={16} />
            </button>
          )}
          {canManageChannels && (
            <button type="button" title="Create channel" className="hover:text-ae-text" onClick={() => setNewChannel({ parentId: null })}>
              <PlusIcon size={16} />
            </button>
          )}
          <button
            type="button"
            title={isOwner ? 'Delete server' : 'Leave server'}
            className="hover:text-ae-danger"
            onClick={() => setConfirm(isOwner ? 'delete' : 'leave')}
          >
            {isOwner ? <TrashIcon size={16} /> : <LogOutIcon size={16} />}
          </button>
        </div>
      </header>

      <div className="ae-scroll flex-1 space-y-3 overflow-y-auto px-2 py-3">
        {groups.map(({ category, items }) =>
          !category && items.length === 0 ? null : (
            <div key={category?.id ?? 'loose'}>
              {category && (
                <div className="group flex items-center justify-between px-2 pb-1">
                  <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">{category.name}</span>
                  {canManageChannels && (
                    <button
                      type="button"
                      title="Create channel"
                      className="text-ae-muted opacity-0 group-hover:opacity-100 hover:text-ae-text"
                      onClick={() => setNewChannel({ parentId: category.id })}
                    >
                      <PlusIcon size={14} />
                    </button>
                  )}
                </div>
              )}
              <ul className="space-y-0.5">
                {items.map((ch) => (
                  <li key={ch.id}>
                    <button
                      type="button"
                      onClick={() => selectChannel(server.id, ch.id)}
                      className={`flex w-full items-center gap-2 rounded-ae px-2 py-1.5 text-left text-sm ${
                        ch.id === activeChannelId ? 'bg-ae-surface text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'
                      }`}
                    >
                      <ChannelGlyph type={ch.type} />
                      <span className="truncate">{ch.name}</span>
                    </button>
                    {room?.kind === 'channel' && room.id === ch.id && voice.status !== 'idle' && (
                      <ul>
                        <VoiceMember
                          userId={userId}
                          speaking={voice.isSpeaking}
                          muted={voice.isMuted}
                          camera={voice.isCameraOn}
                          screen={voice.isSharingScreen}
                        />
                        {voice.participants.map((p) => (
                          <VoiceMember key={p.peerId} userId={p.userId} speaking={p.speaking} muted={p.muted} camera={p.cameraOn} screen={p.sharingScreen} />
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
      </div>

      <UserPanel userId={userId} />

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
              <div className="flex gap-2">
                {(['text', 'voice', 'stream', 'category'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewType(t)}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-ae border py-2 text-xs capitalize ${
                      newType === t ? 'border-ae-accent bg-ae-accent/15' : 'border-ae-border'
                    }`}
                  >
                    {t !== 'category' && <ChannelGlyph type={t} size={14} />} {t}
                  </button>
                ))}
              </div>
            }
            onSubmit={(name) =>
              createChannel.mutate(
                {
                  name: newType === 'text' ? name.toLowerCase().replace(/\s+/g, '-') : name,
                  type: newType,
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
