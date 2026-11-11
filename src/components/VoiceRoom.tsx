/**
 * A live voice room: participant tiles (camera video when on), per-peer volume and connection
 * stats, screen-share viewer, layouts (grid / focus / speaker), pop-out and fullscreen video,
 * the soundboard, and stage controls. Used full-size for server voice and stage channels and in
 * compact mode at the top of a DM or group DM while a call is active.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useProfile, useServerPermissions } from '../hooks/useChatData';
import { useSoundboard } from '../hooks/useSoundboard';
import type { PeerStats, VoiceEngine, VoiceParticipant } from '../hooks/useVoiceEngine';
import { useVoiceModeration, useVoiceStates } from '../hooks/useVoiceStates';
import { hasPermission, Permission } from '../lib/permissions';
import { BUILTIN_SOUNDS, builtinBuffer, decodeClip } from '../lib/soundboard';
import { useSettingsStore } from '../stores/settingsStore';
import type { Server, VoiceState } from '../types/db';
import { useCall } from './CallContext';
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

export function VideoView({ stream, className, mirror, controls }: { stream: MediaStream; className?: string; mirror?: boolean; controls?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  const video = (
    // Muted on purpose: audio is routed through the voice engine's Web Audio graph.
    <video ref={ref} className={className} style={mirror ? { transform: 'scaleX(-1)' } : undefined} autoPlay playsInline muted />
  );
  if (!controls) return video;
  return (
    <div className="group/vid relative">
      {video}
      <div className="absolute top-2 right-2 hidden gap-1 group-hover/vid:flex">
        {'requestPictureInPicture' in HTMLVideoElement.prototype && (
          <button
            type="button"
            title="Pop out (picture-in-picture)"
            className="rounded bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
            onClick={() => void ref.current?.requestPictureInPicture().catch(() => undefined)}
          >
            ⧉ Pop out
          </button>
        )}
        <button
          type="button"
          title="Fullscreen"
          className="rounded bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
          onClick={() => void ref.current?.requestFullscreen().catch(() => undefined)}
        >
          ⛶
        </button>
      </div>
    </div>
  );
}

function SignalBars({ stats }: { stats: PeerStats | null }) {
  if (!stats || stats.pingMs === null) return null;
  const level = stats.pingMs < 80 && (stats.lossPct ?? 0) < 2 ? 3 : stats.pingMs < 200 && (stats.lossPct ?? 0) < 6 ? 2 : 1;
  const color = level === 3 ? 'var(--ae-success)' : level === 2 ? 'var(--ae-warning)' : 'var(--ae-danger)';
  const title = [
    `Ping ${stats.pingMs} ms`,
    stats.lossPct !== null ? `packet loss ${stats.lossPct}%` : null,
    stats.inKbps !== null ? `receiving ${stats.inKbps} kbps` : null,
    stats.outKbps !== null ? `sending ${stats.outKbps} kbps` : null,
    stats.route === 'relay' ? 'via TURN relay' : 'direct',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span title={title} className="flex items-end gap-px">
      {[1, 2, 3].map((i) => (
        <span key={i} className="w-[3px] rounded-sm" style={{ height: 3 + i * 3, background: i <= level ? color : 'rgba(255,255,255,0.25)' }} />
      ))}
    </span>
  );
}

function usePeerStats(voice: VoiceEngine): Map<string, PeerStats | null> {
  const [stats, setStats] = useState<Map<string, PeerStats | null>>(new Map());
  const { getPeerStats, participants } = voice;
  const ids = participants.map((p) => p.peerId).join(',');
  useEffect(() => {
    if (!ids) return;
    let stopped = false;
    const poll = async () => {
      const entries = await Promise.all(ids.split(',').map(async (id) => [id, await getPeerStats(id).catch(() => null)] as const));
      if (!stopped) setStats(new Map(entries));
    };
    void poll();
    const t = setInterval(() => void poll(), 3_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [getPeerStats, ids]);
  return stats;
}

interface TileProps {
  userId: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  camera: MediaStream | null;
  self?: boolean;
  participant?: VoiceParticipant;
  stats?: PeerStats | null;
  voice: VoiceEngine;
  size: 'compact' | 'grid' | 'focus' | 'strip';
  onFocus?: () => void;
  badge?: ReactNode;
}

function Tile(props: TileProps) {
  const { participant, voice, size } = props;
  const { data: profile } = useProfile(props.userId);
  const name = profile?.display_name || profile?.username || '…';
  const box =
    size === 'compact' ? 'h-36 w-56' : size === 'strip' ? 'h-24 w-40 shrink-0' : size === 'focus' ? 'h-full min-h-[240px] w-full' : 'aspect-video';
  return (
    <div
      onDoubleClick={props.onFocus}
      className={`ae-tile group relative flex items-center justify-center overflow-hidden rounded-ae border bg-ae-surface ${box} ${
        props.speaking ? 'ae-speaking border-ae-success' : 'border-ae-border'
      }`}
    >
      {props.camera ? (
        <VideoView stream={props.camera} mirror={props.self} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Avatar profile={profile} size={size === 'strip' ? 40 : size === 'focus' ? 112 : size === 'compact' ? 56 : 72} speaking={props.speaking} />
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-xs font-semibold text-white">
        {name}
        {props.badge}
        {props.muted && <MicOffIcon size={12} className="text-ae-danger" />}
        {props.deafened && <HeadphonesOffIcon size={12} className="text-ae-danger" />}
        {participant && <SignalBars stats={props.stats ?? null} />}
      </div>
      {props.onFocus && size !== 'focus' && (
        <button
          type="button"
          title="Focus"
          className="absolute right-2 bottom-2 hidden rounded bg-black/55 px-1.5 text-xs text-white group-hover:block"
          onClick={props.onFocus}
        >
          ⤢
        </button>
      )}
      {participant && participant.connection !== 'connected' && (
        <span className={`absolute top-2 left-2 rounded bg-black/55 px-1.5 text-xs ${participant.connection === 'failed' ? 'text-ae-danger' : 'text-ae-warning'}`}>
          {participant.connection === 'failed' ? 'No direct route (try a TURN relay)' : 'Connecting…'}
        </span>
      )}
      {participant && size !== 'strip' && (
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

function RoundButton({ title, active, danger, disabled, onClick, children }: {
  title: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`ae-press grid h-11 w-11 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'bg-ae-danger text-white' : active ? 'bg-ae-accent text-ae-on-accent' : 'bg-ae-surface hover:bg-ae-hover'
      }`}
    >
      {children}
    </button>
  );
}

/** Soundboard popover: built-in sounds plus the server's own. */
function Soundboard({ voice, server, canUse, onClose }: { voice: VoiceEngine; server: Server | null; canUse: boolean; onClose: () => void }) {
  const { data: custom = [] } = useSoundboard(server?.id ?? null);
  const volume = useSettingsStore((s) => s.sounds.volume);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const cooldown = useRef(0);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);

  const play = async (id: string, load: () => Promise<AudioBuffer>, gain: number) => {
    if (Date.now() < cooldown.current) return;
    setBusy(id);
    setError(null);
    try {
      const buf = await load();
      if (!voice.playToRoom(buf, gain * Math.max(0.2, volume))) setError("You can't play sounds while you're muted by a moderator or in the audience.");
      cooldown.current = Date.now() + Math.min(buf.duration * 1000, 2_500); // light spam guard
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const btn = 'ae-press flex items-center gap-2 truncate rounded-ae bg-ae-surface px-2.5 py-2 text-left text-sm hover:bg-ae-hover disabled:opacity-50';
  return (
    <div ref={ref} className="ae-pop absolute bottom-full left-1/2 z-40 mb-3 w-[22rem] -translate-x-1/2 rounded-ae border border-ae-border bg-ae-elevated p-3 shadow-2xl">
      <p className="mb-2 text-xs font-bold tracking-wide text-ae-muted uppercase">Soundboard</p>
      {!canUse ? (
        <p className="text-sm text-ae-muted">You don&apos;t have permission to use the soundboard here.</p>
      ) : (
        <>
          {custom.length > 0 && (
            <>
              <p className="mb-1 text-[11px] text-ae-muted">{server?.name}</p>
              <div className="mb-3 grid grid-cols-3 gap-1.5">
                {custom.map((s) => (
                  <button key={s.id} type="button" disabled={busy === s.id} className={btn} onClick={() => void play(s.id, () => decodeClip(s.url), s.volume)}>
                    <span>{s.emoji || '🔊'}</span>
                    <span className="truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="mb-1 text-[11px] text-ae-muted">Default sounds</p>
          <div className="grid grid-cols-3 gap-1.5">
            {BUILTIN_SOUNDS.map((s) => (
              <button key={s.id} type="button" disabled={busy === s.id} className={btn} onClick={() => void play(s.id, () => builtinBuffer(s), 0.9)}>
                <span>{s.emoji}</span>
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-xs text-ae-danger">{error}</p>}
          <p className="mt-2 text-[11px] text-ae-muted">Everyone in the call hears it. Servers can add their own in Server Settings → Soundboard.</p>
        </>
      )}
    </div>
  );
}

export function CallControls({ voice, onShareScreen, onToggleCamera, onLeave, server, stage }: {
  voice: VoiceEngine;
  onShareScreen: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
  server?: Server | null;
  stage?: { audience: boolean; handRaised: boolean; onHand: () => void; onStepDown: () => void } | null;
}) {
  const [board, setBoard] = useState(false);
  const { data: perms = 0n } = useServerPermissions(server?.id ?? null);
  // DM calls: built-in sounds for everyone. Servers: USE_SOUNDBOARD (the owner has every permission).
  const canBoard = !server || hasPermission(perms, Permission.USE_SOUNDBOARD);
  const audience = !!stage?.audience;
  return (
    <div className="relative flex flex-wrap justify-center gap-3">
      {audience ? (
        <RoundButton title={stage!.handRaised ? 'Lower hand' : 'Request to speak'} active={stage!.handRaised} onClick={stage!.onHand}>
          ✋
        </RoundButton>
      ) : (
        <RoundButton title={voice.isMuted ? 'Unmute' : 'Mute'} danger={voice.isMuted} onClick={voice.toggleMute}>
          {voice.isMuted ? <MicOffIcon /> : <MicIcon />}
        </RoundButton>
      )}
      <RoundButton title={voice.isDeafened ? 'Undeafen' : 'Deafen'} danger={voice.isDeafened} onClick={voice.toggleDeafen}>
        {voice.isDeafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
      </RoundButton>
      {!audience && (
        <>
          <RoundButton title={voice.isCameraOn ? 'Turn camera off' : 'Turn camera on'} active={voice.isCameraOn} onClick={onToggleCamera}>
            {voice.isCameraOn ? <CameraIcon /> : <CameraOffIcon />}
          </RoundButton>
          <RoundButton title={voice.isSharingScreen ? 'Stop streaming' : 'Go Live (share screen)'} active={voice.isSharingScreen} onClick={onShareScreen}>
            <ScreenIcon />
          </RoundButton>
          <RoundButton title="Soundboard" active={board} onClick={() => setBoard((v) => !v)}>
            🎵
          </RoundButton>
        </>
      )}
      {stage && !audience && (
        <RoundButton title="Move to audience" onClick={stage.onStepDown}>
          👥
        </RoundButton>
      )}
      <RoundButton title="Disconnect" danger onClick={onLeave}>
        <PhoneOffIcon />
      </RoundButton>
      {board && <Soundboard voice={voice} server={server ?? null} canUse={canBoard} onClose={() => setBoard(false)} />}
    </div>
  );
}

type Layout = 'grid' | 'focus' | 'speaker';

interface VoiceRoomProps {
  userId: string;
  voice: VoiceEngine;
  compact?: boolean;
  /** The server for server voice/stage channels (enables soundboard sounds, stage roles). */
  server?: Server | null;
  onShareScreen: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
}

interface TileSpec {
  key: string;
  userId: string;
  props: Omit<TileProps, 'size' | 'onFocus'>;
  video: MediaStream | null;
}

/** The in-call view. Render only while `voice` is connected to this room. */
export function VoiceRoom({ userId, voice, compact = false, server = null, onShareScreen, onToggleCamera, onLeave }: VoiceRoomProps) {
  const { room, myVoiceState } = useCall();
  const isStage = !!room?.stage;
  const { byUser } = useVoiceStates(server?.id ?? null);
  const mod = useVoiceModeration(server?.id ?? null);
  const { data: perms = 0n } = useServerPermissions(server?.id ?? null);
  const isStageMod = !!server && (server.owner_id === userId || hasPermission(perms, Permission.MUTE_MEMBERS));
  const stats = usePeerStats(voice);
  const [layout, setLayout] = useState<Layout>('grid');
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const lastSpeaker = useRef<string | null>(null);

  const screens = useMemo(() => {
    const list: { key: string; userId: string; stream: MediaStream }[] = [];
    if (voice.localScreenStream) list.push({ key: 'screen:self', userId, stream: voice.localScreenStream });
    for (const p of voice.participants) if (p.screenStream) list.push({ key: `screen:${p.peerId}`, userId: p.userId, stream: p.screenStream });
    return list;
  }, [voice.localScreenStream, voice.participants, userId]);

  const stateOf = (uid: string): VoiceState | undefined => byUser.get(uid);
  const tiles: TileSpec[] = [
    {
      key: 'self',
      userId,
      video: voice.localCameraStream,
      props: {
        userId,
        self: true,
        speaking: voice.isSpeaking,
        muted: voice.isMuted || !!myVoiceState?.server_mute,
        deafened: voice.isDeafened || !!myVoiceState?.server_deaf,
        camera: voice.localCameraStream,
        voice,
      },
    },
    ...voice.participants.map((p) => ({
      key: p.peerId,
      userId: p.userId,
      video: p.cameraStream,
      props: {
        userId: p.userId,
        speaking: p.speaking,
        muted: p.muted || !!stateOf(p.userId)?.server_mute,
        deafened: p.deafened || !!stateOf(p.userId)?.server_deaf,
        camera: p.cameraStream,
        participant: p,
        stats: stats.get(p.peerId) ?? null,
        voice,
      },
    })),
  ];

  // Stage: speakers get tiles, the audience is a compact avatar row.
  const speakerTiles = isStage ? tiles.filter((t) => !stateOf(t.userId)?.suppressed) : tiles;
  const audience = isStage ? tiles.filter((t) => stateOf(t.userId)?.suppressed) : [];
  const hands = isStage ? [...byUser.values()].filter((v) => v.channel_id === room?.id && v.suppressed && v.request_to_speak_at) : [];

  // Speaker layout follows whoever spoke last.
  const speaking = speakerTiles.find((t) => t.props.speaking && t.key !== 'self');
  if (speaking) lastSpeaker.current = speaking.key;

  const focusTarget: { key: string; stream: MediaStream | null; tile?: TileSpec } | null = (() => {
    if (layout === 'grid') return null;
    const wanted = layout === 'speaker' ? lastSpeaker.current : focusKey;
    const screen = screens.find((s) => s.key === wanted) ?? (layout === 'focus' && !wanted ? screens[0] : undefined);
    if (screen) return { key: screen.key, stream: screen.stream };
    const tile = speakerTiles.find((t) => t.key === wanted) ?? speakerTiles.find((t) => t.key !== 'self') ?? speakerTiles[0];
    return tile ? { key: tile.key, stream: null, tile } : null;
  })();

  const focus = (key: string) => {
    setFocusKey(key);
    setLayout('focus');
  };

  const renderTile = (t: TileSpec, size: TileProps['size']) => <Tile key={t.key} {...t.props} size={size} onFocus={() => focus(t.key)} />;

  const stageCtl =
    isStage && server
      ? {
          audience: !!myVoiceState?.suppressed,
          handRaised: !!myVoiceState?.request_to_speak_at,
          onHand: () => mod.raiseHand.mutate(!myVoiceState?.request_to_speak_at),
          onStepDown: () => mod.setSpeaker.mutate({ userId, speaker: false }),
        }
      : null;

  const controls = (
    <CallControls voice={voice} server={server} stage={stageCtl} onShareScreen={onShareScreen} onToggleCamera={onToggleCamera} onLeave={onLeave} />
  );

  const screenGallery = layout === 'grid' && screens.length > 0 && (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
      {screens.map((s) => (
        <div key={s.key} className="ae-tile relative" onDoubleClick={() => focus(s.key)}>
          <VideoView stream={s.stream} controls className={`w-full rounded-ae bg-black object-contain ${compact ? 'max-h-[40vh]' : 'max-h-[55vh]'}`} />
          <ScreenLabel userId={s.userId} self={s.key === 'screen:self'} />
        </div>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div className="ae-enter space-y-3 border-b border-ae-border bg-ae-sunken p-4">
        {screenGallery}
        <div className="flex flex-wrap justify-center gap-3">{tiles.map((t) => renderTile(t, 'compact'))}</div>
        {controls}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-ae-border px-4 py-1.5 text-xs">
        <span className="mr-2 text-ae-muted">Layout</span>
        {(['grid', 'focus', 'speaker'] as Layout[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLayout(l)}
            className={`rounded px-2 py-1 capitalize ${layout === l ? 'bg-ae-surface font-semibold text-ae-text' : 'text-ae-muted hover:text-ae-text'}`}
          >
            {l}
          </button>
        ))}
        {isStage && <span className="ml-auto text-ae-muted">🎙 Stage · {speakerTiles.length} speaking · {audience.length} listening</span>}
      </div>

      <div className="ae-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {focusTarget ? (
          <>
            <div className="ae-enter flex min-h-0 flex-1 items-center justify-center">
              {focusTarget.stream ? (
                <div className="relative w-full">
                  <VideoView stream={focusTarget.stream} controls className="max-h-[65vh] w-full rounded-ae bg-black object-contain" />
                </div>
              ) : (
                focusTarget.tile && renderTile(focusTarget.tile, 'focus')
              )}
            </div>
            <div className="ae-scroll flex gap-2 overflow-x-auto pb-1">
              {screens
                .filter((s) => s.key !== focusTarget.key)
                .map((s) => (
                  <button key={s.key} type="button" onClick={() => focus(s.key)} className="shrink-0 overflow-hidden rounded-ae border border-ae-border">
                    <VideoView stream={s.stream} className="h-24 w-40 bg-black object-cover" />
                  </button>
                ))}
              {speakerTiles.filter((t) => t.key !== focusTarget.key).map((t) => renderTile(t, 'strip'))}
            </div>
          </>
        ) : (
          <>
            {screenGallery}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">{speakerTiles.map((t) => renderTile(t, 'grid'))}</div>
          </>
        )}

        {isStage && (
          <section className="space-y-2">
            {isStageMod && hands.length > 0 && (
              <div className="ae-enter rounded-ae border border-ae-border bg-ae-surface/50 p-3">
                <p className="mb-2 text-xs font-bold tracking-wide text-ae-muted uppercase">✋ Requests to speak — {hands.length}</p>
                <ul className="space-y-1">
                  {hands.map((h) => (
                    <HandRow key={h.user_id} state={h} onInvite={() => mod.setSpeaker.mutate({ userId: h.user_id, speaker: true })} />
                  ))}
                </ul>
              </div>
            )}
            {audience.length > 0 && (
              <>
                <p className="text-xs font-bold tracking-wide text-ae-muted uppercase">Audience — {audience.length}</p>
                <div className="flex flex-wrap gap-3">
                  {audience.map((t) => (
                    <AudienceMember key={t.key} userId={t.userId} hand={!!stateOf(t.userId)?.request_to_speak_at} />
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
      <div className="border-t border-ae-border p-3">{controls}</div>
    </div>
  );
}

function ScreenLabel({ userId, self }: { userId: string; self: boolean }) {
  const { data: p } = useProfile(userId);
  return (
    <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white">
      <span className="ae-live rounded bg-ae-danger px-1 text-[9px]">LIVE</span>
      {self ? 'Your stream' : `${p?.display_name || p?.username || '…'}'s stream`}
    </span>
  );
}

function AudienceMember({ userId, hand }: { userId: string; hand: boolean }) {
  const { data: p } = useProfile(userId);
  return (
    <div className="ae-enter flex w-16 flex-col items-center gap-1 text-center">
      <span className="relative">
        <Avatar profile={p} size={44} showFrame={false} />
        {hand && <span className="absolute -top-1 -right-1 animate-bounce text-sm">✋</span>}
      </span>
      <span className="w-full truncate text-[11px] text-ae-muted">{p?.display_name || p?.username || '…'}</span>
    </div>
  );
}

function HandRow({ state, onInvite }: { state: VoiceState; onInvite: () => void }) {
  const { data: p } = useProfile(state.user_id);
  return (
    <li className="flex items-center gap-2 text-sm">
      <Avatar profile={p} size={24} showFrame={false} />
      <span className="flex-1 truncate">{p?.display_name || p?.username || '…'}</span>
      <button type="button" className="ae-press rounded-ae bg-ae-success px-3 py-1 text-xs font-semibold text-black" onClick={onInvite}>
        Invite to speak
      </button>
    </li>
  );
}
