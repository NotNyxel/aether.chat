/**
 * A live voice room: participant tiles (camera video when on), per-peer volume, screen-share
 * viewer and call controls. Used full-size for server voice/stream channels and in compact mode
 * at the top of a DM or group DM while a call is active.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useProfile } from '../hooks/useChatData';
import type { VoiceEngine, VoiceParticipant } from '../hooks/useVoiceEngine';
import {
  CameraIcon,
  CameraOffIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenIcon,
  VolumeIcon,
} from './icons';
import { Avatar } from './ProfileCard';

export function VideoView({ stream, className, mirror }: { stream: MediaStream; className?: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  // Muted on purpose: audio is routed through the voice engine's Web Audio graph.
  return <video ref={ref} className={className} style={mirror ? { transform: 'scaleX(-1)' } : undefined} autoPlay playsInline muted />;
}

function Tile(props: {
  userId: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  camera: MediaStream | null;
  self?: boolean;
  participant?: VoiceParticipant;
  voice: VoiceEngine;
  compact: boolean;
}) {
  const { participant, voice } = props;
  const { data: profile } = useProfile(props.userId);
  const name = profile?.display_name || profile?.username || '…';
  return (
    <div
      className={`group relative flex items-center justify-center overflow-hidden rounded-ae border bg-ae-surface ${
        props.compact ? 'h-36 w-56' : 'aspect-video'
      } ${props.speaking ? 'border-ae-success shadow-[0_0_0_1px_var(--ae-success)]' : 'border-ae-border'}`}
    >
      {props.camera ? (
        <VideoView stream={props.camera} mirror={props.self} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Avatar profile={profile} size={props.compact ? 56 : 72} speaking={props.speaking} />
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-xs font-semibold text-white">
        {name}
        {props.muted && <MicOffIcon size={12} className="text-ae-danger" />}
        {props.deafened && <HeadphonesOffIcon size={12} className="text-ae-danger" />}
      </div>
      {participant && participant.connection !== 'connected' && (
        <span className={`absolute top-2 left-2 rounded bg-black/55 px-1.5 text-xs ${participant.connection === 'failed' ? 'text-ae-danger' : 'text-ae-warning'}`}>
          {participant.connection === 'failed' ? 'No direct route (NAT)' : 'Connecting…'}
        </span>
      )}
      {participant && (
        <div className="absolute inset-x-2 top-2 hidden items-center gap-2 rounded-ae bg-ae-elevated/90 px-2 py-1 group-hover:flex">
          <button
            type="button"
            title={participant.locallyMuted ? 'Unmute for me' : 'Mute for me'}
            onClick={() => voice.setPeerLocallyMuted(participant.peerId, !participant.locallyMuted)}
            className={participant.locallyMuted ? 'text-ae-danger' : 'text-ae-muted hover:text-ae-text'}
          >
            <VolumeIcon size={14} />
          </button>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={participant.volume}
            onChange={(e) => voice.setPeerVolume(participant.peerId, Number(e.target.value))}
            className="flex-1"
            aria-label={`Volume for ${name}`}
          />
          <span className="w-9 text-right text-xs text-ae-muted">{Math.round(participant.volume * 100)}%</span>
        </div>
      )}
    </div>
  );
}

function RoundButton({ title, active, danger, onClick, children }: {
  title: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid h-11 w-11 place-items-center rounded-full ${
        danger ? 'bg-ae-danger text-white' : active ? 'bg-ae-accent text-ae-on-accent' : 'bg-ae-surface hover:bg-ae-hover'
      }`}
    >
      {children}
    </button>
  );
}

export function CallControls({ voice, onShareScreen, onToggleCamera, onLeave }: {
  voice: VoiceEngine;
  onShareScreen: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="flex justify-center gap-3">
      <RoundButton title={voice.isMuted ? 'Unmute' : 'Mute'} danger={voice.isMuted} onClick={voice.toggleMute}>
        {voice.isMuted ? <MicOffIcon /> : <MicIcon />}
      </RoundButton>
      <RoundButton title={voice.isDeafened ? 'Undeafen' : 'Deafen'} danger={voice.isDeafened} onClick={voice.toggleDeafen}>
        {voice.isDeafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
      </RoundButton>
      <RoundButton title={voice.isCameraOn ? 'Turn camera off' : 'Turn camera on'} active={voice.isCameraOn} onClick={onToggleCamera}>
        {voice.isCameraOn ? <CameraIcon /> : <CameraOffIcon />}
      </RoundButton>
      <RoundButton title={voice.isSharingScreen ? 'Stop sharing' : 'Share screen'} active={voice.isSharingScreen} onClick={onShareScreen}>
        <ScreenIcon />
      </RoundButton>
      <RoundButton title="Disconnect" danger onClick={onLeave}>
        <PhoneOffIcon />
      </RoundButton>
    </div>
  );
}

interface VoiceRoomProps {
  userId: string;
  voice: VoiceEngine;
  compact?: boolean;
  onShareScreen: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
}

/** The in-call view. Render only while `voice` is connected to this room. */
export function VoiceRoom({ userId, voice, compact = false, onShareScreen, onToggleCamera, onLeave }: VoiceRoomProps) {
  const streams = useMemo(() => {
    const list: { id: string; stream: MediaStream }[] = [];
    if (voice.localScreenStream) list.push({ id: 'self', stream: voice.localScreenStream });
    for (const p of voice.participants) if (p.screenStream) list.push({ id: p.peerId, stream: p.screenStream });
    return list;
  }, [voice.localScreenStream, voice.participants]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const focused = streams.find((s) => s.id === focusId) ?? streams[0] ?? null;

  const tiles = (
    <>
      <Tile
        userId={userId}
        self
        speaking={voice.isSpeaking}
        muted={voice.isMuted}
        deafened={voice.isDeafened}
        camera={voice.localCameraStream}
        voice={voice}
        compact={compact}
      />
      {voice.participants.map((p) => (
        <Tile
          key={p.peerId}
          userId={p.userId}
          speaking={p.speaking}
          muted={p.muted}
          deafened={p.deafened}
          camera={p.cameraStream}
          participant={p}
          voice={voice}
          compact={compact}
        />
      ))}
    </>
  );

  const screen = focused && (
    <div className="space-y-2">
      <VideoView stream={focused.stream} className={`w-full rounded-ae bg-black object-contain ${compact ? 'max-h-[40vh]' : 'max-h-[60vh]'}`} />
      {streams.length > 1 && (
        <div className="flex gap-2">
          {streams.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setFocusId(s.id)}
              className={`overflow-hidden rounded-ae border ${s.id === focused.id ? 'border-ae-accent' : 'border-ae-border'}`}
            >
              <VideoView stream={s.stream} className="h-20 w-36 bg-black object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className="space-y-3 border-b border-ae-border bg-ae-sunken p-4">
        {screen}
        <div className="flex flex-wrap justify-center gap-3">{tiles}</div>
        <CallControls voice={voice} onShareScreen={onShareScreen} onToggleCamera={onToggleCamera} onLeave={onLeave} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="ae-scroll flex-1 space-y-4 overflow-y-auto p-4">
        {screen}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">{tiles}</div>
      </div>
      <div className="border-t border-ae-border p-3">
        <CallControls voice={voice} onShareScreen={onShareScreen} onToggleCamera={onToggleCamera} onLeave={onLeave} />
      </div>
    </div>
  );
}
