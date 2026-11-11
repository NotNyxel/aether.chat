/** Main pane for a server: text channels (with member list) or voice/stream channels. */
import { useMemo } from 'react';
import { useProfile, useServerMembers } from '../hooks/useChatData';
import { PresenceDot, usePresenceMap } from '../hooks/usePresence';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Server } from '../types/db';
import { useCall } from './CallContext';
import { ChannelGlyph } from './ChannelSidebar';
import { UsersIcon } from './icons';
import { MessagePane } from './MessagePane';
import { Avatar } from './ProfileCard';
import { VoiceRoom } from './VoiceRoom';

function MemberRow({ userId, nickname, owner, offline }: { userId: string; nickname: string | null; owner: boolean; offline: boolean }) {
  const { data: p } = useProfile(userId);
  const showProfile = useUiStore((s) => s.showProfile);
  const status = usePresenceMap().get(userId) ?? 'offline';
  return (
    <li>
      <button
        type="button"
        onClick={() => showProfile(userId)}
        className={`flex w-full items-center gap-2 rounded-ae px-2 py-1.5 text-left hover:bg-ae-hover ${offline ? 'opacity-45' : ''}`}
      >
        <span className="relative">
          <Avatar profile={p} size={32} showFrame={!offline} />
          <PresenceDot status={status} size={11} className="absolute -right-0.5 -bottom-0.5 z-10" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm" style={{ color: p?.accent_color ?? undefined }}>
            {nickname || p?.display_name || p?.username || '…'}
          </span>
          {p?.custom_status && !offline && <span className="block truncate text-xs text-ae-muted">{p.custom_status}</span>}
        </span>
        {owner && <span title="Server owner">👑</span>}
      </button>
    </li>
  );
}

function MemberList({ server }: { server: Server }) {
  const { data: members = [] } = useServerMembers(server.id);
  const presence = usePresenceMap();
  const online = members.filter((m) => presence.has(m.user_id));
  const offline = members.filter((m) => !presence.has(m.user_id));

  return (
    <aside className="ae-scroll w-60 shrink-0 overflow-y-auto border-l border-ae-border p-3">
      {[
        ['Online', online],
        ['Offline', offline],
      ].map(([label, list]) =>
        (list as typeof members).length ? (
          <div key={label as string} className="mb-4">
            <p className="mb-1 px-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
              {label as string} — {(list as typeof members).length}
            </p>
            <ul className="space-y-0.5">
              {(list as typeof members).map((m) => (
                <MemberRow key={m.user_id} userId={m.user_id} nickname={m.nickname} owner={m.user_id === server.owner_id} offline={label === 'Offline'} />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </aside>
  );
}

export function ServerView({ server, channel, channels, userId }: { server: Server; channel: Channel | null; channels: Channel[]; userId: string }) {
  const memberListOpen = useUiStore((s) => s.memberListOpen);
  const toggleMemberList = useUiStore((s) => s.toggleMemberList);
  const { voice, room, joinChannel, leave, toggleScreenShare, toggleCamera } = useCall();
  const scope = useMemo(() => (channel ? { kind: 'channel' as const, id: channel.id } : null), [channel]);
  const { data: members = [] } = useServerMembers(server.id);
  const memberIds = useMemo(() => members.map((m) => m.user_id).filter((id) => id !== userId), [members, userId]);

  if (!channel || !scope) return <p className="m-auto text-sm text-ae-muted">Pick a channel.</p>;

  if (channel.type === 'text') {
    return (
      <MessagePane
        key={channel.id}
        scope={scope}
        userId={userId}
        serverId={server.id}
        memberIds={memberIds}
        channels={channels}
        placeholder={`Message #${channel.name}`}
        header={
          <>
            <ChannelGlyph type="text" size={18} />
            <h1 className="font-semibold">{channel.name}</h1>
            {channel.topic && <p className="truncate border-l border-ae-border pl-3 text-sm text-ae-muted">{channel.topic}</p>}
            <button
              type="button"
              title={memberListOpen ? 'Hide member list' : 'Show member list'}
              className={`ml-auto shrink-0 ${memberListOpen ? 'text-ae-text' : 'text-ae-muted hover:text-ae-text'}`}
              onClick={toggleMemberList}
            >
              <UsersIcon size={18} />
            </button>
          </>
        }
        aside={memberListOpen ? <MemberList server={server} /> : undefined}
        emptyState={
          <div>
            <h2 className="text-2xl font-bold">Welcome to #{channel.name}!</h2>
            <p className="text-sm text-ae-muted">This is the start of the channel.</p>
          </div>
        }
      />
    );
  }

  const here = room?.kind === 'channel' && room.id === channel.id && voice.status !== 'idle';
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ae-border px-4">
        <ChannelGlyph type={channel.type} size={18} />
        <h1 className="font-semibold">{channel.name}</h1>
      </header>
      {here ? (
        <VoiceRoom userId={userId} voice={voice} onShareScreen={toggleScreenShare} onToggleCamera={toggleCamera} onLeave={leave} />
      ) : (
        <div className="grid flex-1 place-items-center">
          <div className="space-y-4 text-center">
            <div className="mx-auto w-fit text-ae-muted">
              <ChannelGlyph type={channel.type} size={48} />
            </div>
            <h2 className="text-xl font-bold">{channel.name}</h2>
            <p className="max-w-sm text-sm text-ae-muted">
              Audio and video travel directly between participants (peer-to-peer). Nothing is relayed through a server.
            </p>
            <button
              type="button"
              onClick={() => joinChannel(channel.id, channel.name)}
              className="rounded-ae bg-ae-success px-6 py-2.5 text-sm font-semibold text-black"
            >
              Join voice
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
