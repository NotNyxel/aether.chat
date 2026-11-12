/**
 * Who is in a voice or stage channel, shown under the channel in the sidebar whether or not you
 * have joined. Moderators get a menu per member: server mute / deafen, move, disconnect, and for
 * stages invite to speak / move to audience.
 */
import { useUserMenu } from '../hooks/useUserMenu';
import { useEffect, useRef, useState } from 'react';
import { useProfile } from '../hooks/useChatData';
import { useVoiceModeration } from '../hooks/useVoiceStates';
import { hasPermission, Permission } from '../lib/permissions';
import { useUiStore } from '../stores/uiStore';
import type { Channel, VoiceState } from '../types/db';
import { useCall } from './CallContext';
import { CameraIcon, HandIcon, HeadphonesOffIcon, MicIcon, MicOffIcon, SlidersIcon, StageIcon, UsersIcon, VolumeIcon } from './icons';
import { Avatar } from './ProfileCard';

function MemberMenu({ state, channels, perms, isOwner, onClose }: {
  state: VoiceState;
  channels: Channel[];
  perms: bigint;
  isOwner: boolean;
  onClose: () => void;
}) {
  const mod = useVoiceModeration(state.server_id);
  const ref = useRef<HTMLDivElement>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);
  const can = (p: bigint) => isOwner || hasPermission(perms, p);
  const item = 'block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-ae-hover';
  const run = (fn: () => void) => {
    fn();
    onClose();
  };
  const err = mod.moderate.error ?? mod.move.error ?? mod.disconnect.error ?? mod.setSpeaker.error;
  const channel = channels.find((c) => c.id === state.channel_id);
  return (
    <div ref={ref} className="ae-pop absolute top-full left-6 z-40 mt-1 w-52 rounded-ae border border-ae-border bg-ae-elevated p-1.5 shadow-2xl">
      {channel?.type === 'stream' && can(Permission.MUTE_MEMBERS) && (
        <button type="button" className={item} onClick={() => run(() => mod.setSpeaker.mutate({ userId: state.user_id, speaker: state.suppressed }))}>
          {state.suppressed ? <><MicIcon size={14} className="ae-ico" /> Invite to speak</> : <><UsersIcon size={14} className="ae-ico" /> Move to audience</>}
        </button>
      )}
      {can(Permission.MUTE_MEMBERS) && (
        <button type="button" className={item} onClick={() => run(() => mod.moderate.mutate({ userId: state.user_id, mute: !state.server_mute }))}>
          {state.server_mute ? 'Remove server mute' : 'Server mute'}
        </button>
      )}
      {can(Permission.DEAFEN_MEMBERS) && (
        <button type="button" className={item} onClick={() => run(() => mod.moderate.mutate({ userId: state.user_id, deaf: !state.server_deaf }))}>
          {state.server_deaf ? 'Remove server deafen' : 'Server deafen'}
        </button>
      )}
      {can(Permission.MOVE_MEMBERS) && (
        <>
          <button type="button" className={item} onClick={() => setMoveOpen((v) => !v)}>
            Move to… <span className="float-right text-ae-muted">{moveOpen ? '▾' : '▸'}</span>
          </button>
          {moveOpen &&
            channels
              .filter((c) => (c.type === 'voice' || c.type === 'stream') && c.id !== state.channel_id)
              .map((c) => (
                <button key={c.id} type="button" className={`${item} pl-5 text-ae-muted`} onClick={() => run(() => mod.move.mutate({ userId: state.user_id, channelId: c.id }))}>
                  {c.type === 'stream' ? <StageIcon size={14} className="ae-ico" /> : <VolumeIcon size={14} className="ae-ico" />} {c.name}
                </button>
              ))}
          <button type="button" className={`${item} text-ae-danger`} onClick={() => run(() => mod.disconnect.mutate(state.user_id))}>
            Disconnect
          </button>
        </>
      )}
      {err && <p className="px-2 text-xs text-ae-danger">{err.message}</p>}
    </div>
  );
}

function Occupant({ state, speaking, canModerate, channels, perms, isOwner, me }: {
  state: VoiceState;
  speaking: boolean;
  canModerate: boolean;
  channels: Channel[];
  perms: bigint;
  isOwner: boolean;
  me: string;
}) {
  const { data: profile } = useProfile(state.user_id);
  const peekProfile = useUiStore((s) => s.peekProfile);
  const [menu, setMenu] = useState(false);
  const userMenu = useUserMenu(me);
  const muted = state.self_mute || state.server_mute;
  const deaf = state.self_deaf || state.server_deaf;
  return (
    <li className="ae-enter relative">
      <button
        type="button"
        onClick={(e) => peekProfile(state.user_id, e.currentTarget)}
        onContextMenu={(e) =>
          userMenu(e, state.user_id, canModerate && state.user_id !== me ? [{ label: 'Voice moderation…', icon: <SlidersIcon size={15} />, onClick: () => setMenu(true) }] : [], state.server_id)
        }
        className={`group flex w-full items-center gap-2 rounded py-0.5 pr-1 pl-8 text-left text-sm hover:bg-ae-hover ${state.suppressed ? 'text-ae-muted/70' : 'text-ae-muted'}`}
      >
        <Avatar profile={profile} size={20} speaking={speaking} showFrame={false} />
        <span className="truncate">{profile?.display_name || profile?.username || '…'}</span>
        {state.request_to_speak_at && <span title="Wants to speak"><HandIcon size={15} className="ae-ico" /></span>}
        <span className="ml-auto flex items-center gap-1">
          {state.streaming && <span className="ae-live rounded bg-ae-danger px-1 text-[9px] font-bold text-white">LIVE</span>}
          {state.camera && <CameraIcon size={12} />}
          {muted && <MicOffIcon size={12} className={state.server_mute ? 'text-ae-danger' : 'text-ae-muted'} />}
          {deaf && <HeadphonesOffIcon size={12} className={state.server_deaf ? 'text-ae-danger' : 'text-ae-muted'} />}
          {canModerate && state.user_id !== me && (
            <span
              role="button"
              tabIndex={0}
              title="Voice moderation"
              className="hidden px-1 text-ae-muted group-hover:inline hover:text-ae-text"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(true);
              }}
            >
              ⋯
            </span>
          )}
        </span>
      </button>
      {menu && <MemberMenu state={state} channels={channels} perms={perms} isOwner={isOwner} onClose={() => setMenu(false)} />}
    </li>
  );
}

export function VoiceOccupantList({ channel, states, channels, perms, isOwner, me }: {
  channel: Channel;
  states: VoiceState[];
  channels: Channel[];
  perms: bigint;
  isOwner: boolean;
  me: string;
}) {
  const { voice, room } = useCall();
  if (states.length === 0) return null;
  const here = room?.kind === 'channel' && room.id === channel.id && voice.status === 'connected';
  const speakingUsers = new Set(here ? voice.participants.filter((p) => p.speaking).map((p) => p.userId) : []);
  if (here && voice.isSpeaking) speakingUsers.add(me);
  const canModerate =
    isOwner || [Permission.MUTE_MEMBERS, Permission.DEAFEN_MEMBERS, Permission.MOVE_MEMBERS].some((p) => hasPermission(perms, p));
  const isStage = channel.type === 'stream';
  const speakers = isStage ? states.filter((s) => !s.suppressed) : states;
  const audience = isStage ? states.filter((s) => s.suppressed) : [];
  const row = (s: VoiceState) => (
    <Occupant key={s.user_id} state={s} speaking={speakingUsers.has(s.user_id)} canModerate={canModerate} channels={channels} perms={perms} isOwner={isOwner} me={me} />
  );
  return (
    <ul className="pb-1">
      {isStage && speakers.length > 0 && <li className="pl-8 text-[10px] font-bold tracking-wide text-ae-muted uppercase">Speakers</li>}
      {speakers.map(row)}
      {audience.length > 0 && (
        <li className="pl-8 text-[10px] font-bold tracking-wide text-ae-muted uppercase">
          Audience — {audience.length}
        </li>
      )}
      {audience.slice(0, 12).map(row)}
      {audience.length > 12 && <li className="pl-8 text-xs text-ae-muted">and {audience.length - 12} more</li>}
    </ul>
  );
}
