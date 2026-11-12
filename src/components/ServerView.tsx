/** Main pane for a server: text channels (with member list) or voice/stream channels. */
import { useUserMenu } from '../hooks/useUserMenu';
import { useMemo, useState } from 'react';
import { useProfile, useServerMembers } from '../hooks/useChatData';
import { activeCustomStatus } from '../hooks/useDesktop';
import { PresenceDot, usePresenceMap } from '../hooks/usePresence';
import { ActivityLine } from './ActivityCards';
import { useMemberStyles, useServerLive } from '../hooks/useServerAdmin';
import { useVoiceStates } from '../hooks/useVoiceStates';
import { useUiStore } from '../stores/uiStore';
import type { Channel, Server, ServerMember, VoiceState } from '../types/db';
import { useCall } from './CallContext';
import { ChannelGlyph, ChannelIcon } from './ChannelSidebar';
import { FollowButton } from './Announcements';
import { ForumView } from './Forum';
import { ThreadPanel, ThreadsButton } from './Threads';
import { CrownIcon, NsfwIcon, StageIcon, TimeoutIcon, UsersIcon, VolumeIcon } from './icons';
import { MessagePane } from './MessagePane';
import { Avatar, StyledName } from './ProfileCard';
import { VoiceRoom } from './VoiceRoom';

function MemberRow({ userId, nickname, owner, offline, color, timedOut, me, serverId, avatarOverride }: {
  me: string;
  serverId: string;
  avatarOverride: string | null;
  userId: string;
  nickname: string | null;
  owner: boolean;
  offline: boolean;
  color: string | null | undefined;
  timedOut: boolean;
}) {
  const { data: p } = useProfile(userId);
  const showProfile = useUiStore((s) => s.showProfile);
  const userMenu = useUserMenu(me);
  const status = usePresenceMap().get(userId) ?? 'offline';
  const customStatus = activeCustomStatus(p);
  return (
    <li>
      <button
        type="button"
        onClick={() => showProfile(userId)}
        onContextMenu={(e) => userMenu(e, userId, [], serverId)}
        data-plate={(!offline && p?.nameplate) || 'none'}
        className={`ae-plate flex w-full items-center gap-2 rounded-ae px-2 py-1.5 text-left hover:bg-ae-hover ${offline ? 'opacity-45' : ''}`}
      >
        <span className="relative">
          <Avatar profile={p && avatarOverride ? { ...p, avatar_url: avatarOverride } : p} size={32} showFrame={!offline} />
          <PresenceDot status={status} size={11} className="absolute -right-0.5 -bottom-0.5 z-10" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            <StyledName profile={p} text={nickname || p?.display_name || p?.username || '…'} color={color} />
          </span>
          {!offline && (
            <span className="block truncate text-xs text-ae-muted empty:hidden">
              <ActivityLine userId={userId} fallback={customStatus || undefined} />
            </span>
          )}
        </span>
        {timedOut && <span title="Timed out"><TimeoutIcon size={15} className="ae-ico" /></span>}
        {owner && <span title="Server owner"><CrownIcon size={15} className="ae-ico" /></span>}
      </button>
    </li>
  );
}

/** Members grouped like Discord: hoisted roles (highest first), then Online, then Offline. */
function MemberList({ server, me }: { server: Server; me: string }) {
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
                me={me}
                serverId={server.id}
                avatarOverride={m.avatar_url}
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

/** "LIVE: Alex is streaming in Gaming. Watch stream" banner above text channels (Discord's Go Live). */
function LiveBanner({ streams, channels, userId }: { streams: VoiceState[]; channels: Channel[]; userId: string }) {
  const { joinChannel, room } = useCall();
  const first = streams[0];
  const { data: p } = useProfile(first?.user_id);
  if (!first) return null;
  const ch = channels.find((c) => c.id === first.channel_id);
  if (!ch) return null;
  const inThere = room?.kind === 'channel' && room.id === ch.id;
  return (
    <div className="ae-enter flex items-center gap-3 border-b border-ae-border bg-gradient-to-r from-ae-danger/15 to-transparent px-4 py-2 text-sm">
      <span className="ae-live rounded bg-ae-danger px-1.5 text-[10px] font-bold text-white">LIVE</span>
      <Avatar profile={p} size={22} showFrame={false} />
      <span className="min-w-0 flex-1 truncate">
        <b>{first.user_id === userId ? 'You are' : `${p?.display_name || p?.username || 'Someone'} is`}</b> streaming in{' '}
        <b>
          {ch.type === 'stream' ? <StageIcon size={14} className="ae-ico" /> : <VolumeIcon size={14} className="ae-ico" />} {ch.name}
        </b>
        {streams.length > 1 && <span className="text-ae-muted"> and {streams.length - 1} other stream{streams.length > 2 ? 's' : ''}</span>}
      </span>
      {!inThere && (
        <button type="button" className="ae-press rounded-ae bg-ae-accent px-3 py-1 text-xs font-semibold text-ae-on-accent" onClick={() => joinChannel(ch)}>
          Watch stream
        </button>
      )}
    </div>
  );
}

function Occupancy({ states }: { states: VoiceState[] }) {
  return (
    <div className="flex justify-center -space-x-2">
      {states.slice(0, 8).map((s) => (
        <OccupantFace key={s.user_id} userId={s.user_id} />
      ))}
      {states.length > 8 && <span className="grid h-10 w-10 place-items-center rounded-full bg-ae-surface text-xs">+{states.length - 8}</span>}
    </div>
  );
}

function OccupantFace({ userId }: { userId: string }) {
  const { data: p } = useProfile(userId);
  return (
    <span className="rounded-full ring-2 ring-ae-bg" title={p?.display_name || p?.username}>
      <Avatar profile={p} size={40} showFrame={false} />
    </span>
  );
}

const NSFW_KEY = 'aether.nsfw.ack';

function NsfwGate({ channel, onAccept }: { channel: Channel; onAccept: () => void }) {
  const openHome = useUiStore((s) => s.openHome);
  return (
    <section className="grid flex-1 place-items-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-5xl"><NsfwIcon size={15} className="ae-ico" /></p>
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
  const threadId = useUiStore((s) => s.threadId);
  const toggleMemberList = useUiStore((s) => s.toggleMemberList);
  const { voice, room, joinChannel, leave, toggleScreenShare, toggleCamera } = useCall();
  const scope = useMemo(() => (channel ? { kind: 'channel' as const, id: channel.id } : null), [channel]);
  const { data: members = [] } = useServerMembers(server.id);
  useServerLive(server.id);
  const [nsfwAcked, setNsfwAcked] = useState<string[]>([]);
  const { states: voiceStates, byChannel } = useVoiceStates(server.id);
  const streams = useMemo(() => voiceStates.filter((v) => v.streaming), [voiceStates]);
  const memberIds = useMemo(() => members.map((m) => m.user_id).filter((id) => id !== userId), [members, userId]);

  if (!channel || !scope) return <p className="m-auto text-sm text-ae-muted">Pick a channel.</p>;

  if (channel.nsfw && !nsfwAcked.includes(channel.id) && !hasNsfwAck(channel.id)) {
    return <NsfwGate channel={channel} onAccept={() => setNsfwAcked((a) => [...a, channel.id])} />;
  }

  if (channel.subtype === 'forum' || channel.subtype === 'media') {
    return <ForumView key={channel.id} forum={channel} server={server} userId={userId} channels={channels} />;
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
        top={streams.length > 0 ? <LiveBanner streams={streams} channels={channels} userId={userId} /> : undefined}
        header={
          <>
            <ChannelIcon channel={channel} size={18} />
            <h1 className="font-semibold">{channel.name}</h1>
            {channel.topic && <p className="truncate border-l border-ae-border pl-3 text-sm text-ae-muted">{channel.topic}</p>}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {channel.subtype === 'announcement' && <FollowButton channel={channel} server={server} userId={userId} />}
              <ThreadsButton channel={channel} userId={userId} />
            </span>
            <button
              type="button"
              title={memberListOpen ? 'Hide member list' : 'Show member list'}
              className={`shrink-0 ${memberListOpen ? 'text-ae-text' : 'text-ae-muted hover:text-ae-text'}`}
              onClick={toggleMemberList}
            >
              <UsersIcon size={18} />
            </button>
          </>
        }
        aside={
          threadId ? (
            <ThreadPanel threadId={threadId} server={server} userId={userId} channels={channels} />
          ) : memberListOpen ? (
            <MemberList server={server} me={userId} />
          ) : undefined
        }
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
        <VoiceRoom userId={userId} voice={voice} server={server} onShareScreen={toggleScreenShare} onToggleCamera={toggleCamera} onLeave={leave} />
      ) : (
        <div className="grid flex-1 place-items-center">
          <div className="space-y-4 text-center">
            <div className="mx-auto w-fit text-ae-muted">
              <ChannelGlyph type={channel.type} size={48} />
            </div>
            <h2 className="text-xl font-bold">{channel.name}</h2>
            {(byChannel.get(channel.id) ?? []).length > 0 ? (
              <>
                <Occupancy states={byChannel.get(channel.id) ?? []} />
                <p className="text-sm text-ae-muted">
                  {(byChannel.get(channel.id) ?? []).length} {channel.type === 'stream' ? 'in the stage' : 'in voice'}
                  {(byChannel.get(channel.id) ?? []).some((v) => v.streaming) && ' · someone is live'}
                </p>
              </>
            ) : (
              <p className="max-w-sm text-sm text-ae-muted">
                {channel.type === 'stream'
                  ? 'A stage: speakers talk, everyone else listens and can raise a hand to speak.'
                  : 'Audio and video travel directly between participants (peer-to-peer). Nothing is relayed through a server.'}
              </p>
            )}
            <button
              type="button"
              onClick={() => joinChannel(channel)}
              className="rounded-ae bg-ae-success px-6 py-2.5 text-sm font-semibold text-black"
            >
              {channel.type === 'stream' ? 'Join stage' : 'Join voice'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
