/** Main pane for a server: text channels (with member list) or voice/stream channels. */
import { useMemo, useState } from 'react';
import { useProfile, useServerMembers } from '../hooks/useChatData';
import { activeCustomStatus } from '../hooks/useDesktop';
import { PresenceDot, useActivityOf, usePresenceMap } from '../hooks/usePresence';
import { useMemberStyles, useServerLive } from '../hooks/useServerAdmin';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Server, ServerMember } from '../types/db';
import { useCall } from './CallContext';
import { ChannelGlyph } from './ChannelSidebar';
import { UsersIcon } from './icons';
import { MessagePane } from './MessagePane';
import { Avatar } from './ProfileCard';
import { VoiceRoom } from './VoiceRoom';

function MemberRow({ userId, nickname, owner, offline, color, timedOut }: {
  userId: string;
  nickname: string | null;
  owner: boolean;
  offline: boolean;
  color: string | null | undefined;
  timedOut: boolean;
}) {
  const { data: p } = useProfile(userId);
  const showProfile = useUiStore((s) => s.showProfile);
  const status = usePresenceMap().get(userId) ?? 'offline';
  const playing = useActivityOf(userId);
  const customStatus = activeCustomStatus(p);
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
          <span className="block truncate text-sm" style={{ color: color ?? undefined }}>
            {nickname || p?.display_name || p?.username || '…'}
          </span>
          {!offline && (playing || customStatus) && (
            <span className="block truncate text-xs text-ae-muted">{playing ? <>Playing <b>{playing}</b></> : customStatus}</span>
          )}
        </span>
        {timedOut && <span title="Timed out">⏳</span>}
        {owner && <span title="Server owner">👑</span>}
      </button>
    </li>
  );
}

/** Members grouped like Discord: hoisted roles (highest first), then Online, then Offline. */
function MemberList({ server }: { server: Server }) {
  const { data: members = [] } = useServerMembers(server.id);
  const styles = useMemberStyles(server.id);
  const presence = usePresenceMap();
  const now = Date.now();

  const groups = useMemo(() => {
    const hoisted = new Map<string, { title: string; position: number; list: ServerMember[] }>();
    const online: ServerMember[] = [];
    const offline: ServerMember[] = [];
    for (const m of members) {
      if (!presence.has(m.user_id)) {
        offline.push(m);
        continue;
      }
      const role = styles.get(m.user_id)?.hoist;
      if (role) {
        const g = hoisted.get(role.id) ?? { title: role.name, position: role.position, list: [] };
        g.list.push(m);
        hoisted.set(role.id, g);
      } else online.push(m);
    }
    return [
      ...[...hoisted.values()].sort((a, b) => b.position - a.position),
      { title: 'Online', position: -1, list: online },
      { title: 'Offline', position: -2, list: offline },
    ].filter((g) => g.list.length > 0);
  }, [members, presence, styles]);

  return (
    <aside className="ae-scroll w-60 shrink-0 overflow-y-auto border-l border-ae-border p-3">
      {groups.map((g) => (
        <div key={`${g.title}:${g.position}`} className="mb-4">
          <p className="mb-1 px-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
            {g.title} — {g.list.length}
          </p>
          <ul className="space-y-0.5">
            {g.list.map((m) => (
              <MemberRow
                key={m.user_id}
                userId={m.user_id}
                nickname={m.nickname}
                owner={m.user_id === server.owner_id}
                offline={g.title === 'Offline' && g.position === -2}
                color={styles.get(m.user_id)?.color}
                timedOut={!!m.timed_out_until && new Date(m.timed_out_until).getTime() > now}
              />
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
}

const NSFW_KEY = 'aether.nsfw.ack';

function NsfwGate({ channel, onAccept }: { channel: Channel; onAccept: () => void }) {
  const openHome = useUiStore((s) => s.openHome);
  return (
    <section className="grid flex-1 place-items-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-5xl">🔞</p>
        <h2 className="text-xl font-bold">#{channel.name} is age-restricted</h2>
        <p className="text-sm text-ae-muted">This channel may contain content not suitable for everyone. You must be 18 or older to view it.</p>
        <div className="flex justify-center gap-3">
          <button type="button" className="rounded-ae bg-ae-surface px-4 py-2 text-sm hover:bg-ae-hover" onClick={() => openHome()}>
            Nope
          </button>
          <button
            type="button"
            className="rounded-ae bg-ae-danger px-4 py-2 text-sm font-semibold text-white"
            onClick={() => {
              try {
                const acks = JSON.parse(localStorage.getItem(NSFW_KEY) ?? '[]') as string[];
                localStorage.setItem(NSFW_KEY, JSON.stringify([...new Set([...acks, channel.id])]));
              } catch {
                // storage unavailable: acknowledgement lasts for this session
              }
              onAccept();
            }}
          >
            I&apos;m 18 or older, continue
          </button>
        </div>
      </div>
    </section>
  );
}

function hasNsfwAck(channelId: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(NSFW_KEY) ?? '[]') as string[]).includes(channelId);
  } catch {
    return false;
  }
}

export function ServerView({ server, channel, channels, userId }: { server: Server; channel: Channel | null; channels: Channel[]; userId: string }) {
  const memberListOpen = useUiStore((s) => s.memberListOpen);
  const toggleMemberList = useUiStore((s) => s.toggleMemberList);
  const { voice, room, joinChannel, leave, toggleScreenShare, toggleCamera } = useCall();
  const scope = useMemo(() => (channel ? { kind: 'channel' as const, id: channel.id } : null), [channel]);
  const { data: members = [] } = useServerMembers(server.id);
  useServerLive(server.id);
  const [nsfwAcked, setNsfwAcked] = useState<string[]>([]);
  const memberIds = useMemo(() => members.map((m) => m.user_id).filter((id) => id !== userId), [members, userId]);

  if (!channel || !scope) return <p className="m-auto text-sm text-ae-muted">Pick a channel.</p>;

  if (channel.nsfw && !nsfwAcked.includes(channel.id) && !hasNsfwAck(channel.id)) {
    return <NsfwGate channel={channel} onAccept={() => setNsfwAcked((a) => [...a, channel.id])} />;
  }

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
