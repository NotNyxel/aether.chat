/**
 * useVoiceEngine — aether.chat's peer-to-peer mesh voice, camera and screen-share engine.
 *
 * Works for any room id: a server voice/stream channel, a 1:1 DM call or a group DM call.
 * Every room is the Realtime topic `voice:<roomId>`, and RLS decides who may join it.
 *
 * Topology
 *   - Every participant opens one PeerJS `Peer` with id `ae-<userId>-<nonce>`.
 *   - Room membership is published through Supabase Realtime **presence** on the private
 *     topic `voice:<roomId>`. Only authorized users can subscribe, so the presence list is the
 *     authorized roster.
 *   - For each pair of peers, only the one with the lexicographically smaller peer id dials, so the
 *     mesh is glare-free. Incoming calls from peer ids outside the presence roster are never answered.
 *   - Audio uses one long-lived MediaConnection per peer pair. Camera and screen share each use a
 *     separate one-way MediaConnection per viewer, so turning video on or off never renegotiates
 *     or interrupts the audio mesh.
 *
 * Audio graph (local / outgoing)
 *   mic → high-pass → compressor → input gain ─┬→ analyser (VAD / gate detector)
 *                                              └→ gate gain → MediaStreamDestination → peers
 *   The track sent to peers is the destination node's track. Swapping microphones only rewires
 *   the graph source, so no WebRTC renegotiation is needed.
 *
 * Audio graph (remote / incoming, per peer)
 *   remote stream → high-pass → compressor (normalization) ─┬→ analyser (speaking indicator)
 *                                                           └→ per-peer gain → master gain → speakers
 *   master gain = 0 when deafened. Per-peer gain = local volume (0–200%) or 0 when locally muted.
 *
 * Usage
 *   Render remote video in a `<video muted autoPlay playsInline>`. Screen-share audio is already
 *   routed through the Web Audio graph, so deafen and volume apply to it too.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Peer, type MediaConnection, type PeerOptions } from 'peerjs';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { createDenoiser, type Denoiser } from '../lib/denoise';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Public types and constants
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Free public STUN servers. No TURN relay is used, so the operating cost stays at zero. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

export type ScreenResolution = '720p' | '1080p';
export type ScreenFrameRate = 15 | 30 | 60;
export type BandwidthProfile = 'low' | 'balanced' | 'high';
export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'error';
export type PeerConnectionState = 'connecting' | 'connected' | 'failed';
export type VideoKind = 'screen' | 'camera';

export interface AudioProcessingSettings {
  /** `null` = system default device. */
  inputDeviceId: string | null;
  /** `null` = system default device. Requires `AudioContext.setSinkId` support (Chromium 110+). */
  outputDeviceId: string | null;
  /** Camera used for video calls. `null` = system default. */
  videoDeviceId: string | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /** High-pass cutoff in Hz, removes rumble and desk thumps. Range 20–300. */
  highPassHz: number;
  /** Noise-gate open threshold in dBFS. `-100` disables the gate. Range -100 to 0. */
  noiseGateDb: number;
  /** Linear input gain applied after compression. Range 0–2. */
  inputGain: number;
  /** Caps outgoing audio and video bitrates. */
  bandwidthProfile: BandwidthProfile;
  /** RNNoise machine-learning noise suppression (replaces the browser's when on). */
  rnnoise: boolean;
  /** Optional TURN relay for networks that block peer-to-peer. Empty = off. */
  turnUrl: string;
  turnUsername: string;
  turnCredential: string;
}

export const DEFAULT_AUDIO_SETTINGS: AudioProcessingSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  videoDeviceId: null,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false, // our own compressor handles leveling; browser AGC fights it
  highPassHz: 90,
  noiseGateDb: -55,
  inputGain: 1,
  bandwidthProfile: 'balanced',
  rnnoise: false,
  turnUrl: '',
  turnUsername: '',
  turnCredential: '',
};

/** STUN plus the user's own TURN relay, if configured. */
export function iceServersFor(s: Pick<AudioProcessingSettings, 'turnUrl' | 'turnUsername' | 'turnCredential'>): RTCIceServer[] {
  const urls = s.turnUrl
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^turns?:/i.test(u));
  if (urls.length === 0) return ICE_SERVERS;
  return [...ICE_SERVERS, { urls, username: s.turnUsername || undefined, credential: s.turnCredential || undefined }];
}

export interface PeerStats {
  /** Round-trip time in ms, from the active ICE candidate pair. */
  pingMs: number | null;
  /** Percentage of incoming audio packets lost since the call started. */
  lossPct: number | null;
  /** Incoming audio bitrate in kbps over the last sample. */
  inKbps: number | null;
  /** Outgoing audio bitrate in kbps over the last sample. */
  outKbps: number | null;
  /** 'relay' when traffic goes through a TURN server. */
  route: 'direct' | 'relay' | null;
}

export interface ScreenShareOptions {
  resolution: ScreenResolution;
  frameRate: ScreenFrameRate;
  /** Capture tab or system audio when the browser offers it. */
  includeAudio: boolean;
}

export const DEFAULT_SCREEN_SHARE: ScreenShareOptions = {
  resolution: '720p',
  frameRate: 30,
  includeAudio: true,
};

export interface VoiceParticipant {
  peerId: string;
  userId: string;
  /** Self-reported by the remote peer through presence. */
  muted: boolean;
  deafened: boolean;
  sharingScreen: boolean;
  cameraOn: boolean;
  /** Locally measured from the incoming audio. */
  speaking: boolean;
  connection: PeerConnectionState;
  /** Local playback volume for this peer, 0–2. */
  volume: number;
  /** Locally silenced by us. Does not affect anyone else. */
  locallyMuted: boolean;
  /** Incoming screen share, if the peer is streaming. Render it muted. */
  screenStream: MediaStream | null;
  /** Incoming camera video, if the peer has their camera on. */
  cameraStream: MediaStream | null;
}

export interface UseVoiceEngineOptions {
  supabase: SupabaseClient;
  /** Authenticated user id (`auth.uid()`). The engine stays idle while this is null. */
  userId: string | null;
  initialSettings?: Partial<AudioProcessingSettings>;
  /** Self-hosted PeerServer settings. Defaults to the free PeerJS cloud broker. */
  peerServer?: Pick<PeerOptions, 'host' | 'port' | 'path' | 'secure' | 'key'>;
}

export interface VoiceEngine {
  status: VoiceStatus;
  error: string | null;
  /** Room id: a voice channel id or a conversation id. */
  channelId: string | null;
  selfPeerId: string | null;
  participants: VoiceParticipant[];
  isSpeaking: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isSharingScreen: boolean;
  isCameraOn: boolean;
  localScreenStream: MediaStream | null;
  localCameraStream: MediaStream | null;
  settings: AudioProcessingSettings;
  join: (roomId: string) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  /** Sets mute explicitly (used by push-to-talk). */
  setMuted: (muted: boolean) => void;
  toggleDeafen: () => void;
  setPeerVolume: (peerId: string, volume: number) => void;
  setPeerLocallyMuted: (peerId: string, muted: boolean) => void;
  startScreenShare: (options?: Partial<ScreenShareOptions>) => Promise<void>;
  stopScreenShare: () => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  updateSettings: (patch: Partial<AudioProcessingSettings>) => Promise<void>;
  /** Users whose audio we refuse to play (server-muted, stage audience, disconnected by a moderator). */
  setRemoteBlocked: (userIds: string[]) => void;
  /** Forces our outgoing audio off (server mute or stage audience) regardless of our own mute. */
  setForcedMute: (forced: boolean) => void;
  /** Forces incoming audio off (server deafen). */
  setForcedDeafen: (forced: boolean) => void;
  /** Plays a clip to everyone in the room (mixed into our outgoing audio) and to ourselves. */
  playToRoom: (buffer: AudioBuffer, volume?: number) => boolean;
  /** Connection quality to one peer. */
  getPeerStats: (peerId: string) => Promise<PeerStats | null>;
}

/** Lists available audio and video devices. Labels are empty until permission is granted. */
export async function listAudioDevices(): Promise<{
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
}> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: devices.filter((d) => d.kind === 'audioinput'),
    outputs: devices.filter((d) => d.kind === 'audiooutput'),
    cameras: devices.filter((d) => d.kind === 'videoinput'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Internal types and tuning constants
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface PresencePayload {
  userId: string;
  peerId: string;
  muted: boolean;
  deafened: boolean;
  sharingScreen: boolean;
  cameraOn: boolean;
  joinedAt: number;
}

interface CallMetadata {
  kind: 'audio' | VideoKind;
  userId: string;
}

interface LocalAudioGraph {
  ctx: AudioContext;
  master: GainNode;
  mic: MediaStream;
  source: MediaStreamAudioSourceNode;
  denoiser: Denoiser | null;
  highPass: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  inputGain: GainNode;
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
  gate: GainNode;
  /** Silences only the microphone path (soundboard clips bypass it). */
  micMute: GainNode;
  destination: MediaStreamAudioDestinationNode;
  gateOpen: boolean;
  gateLastAboveAt: number;
}

interface RemoteAudioGraph {
  /** Chromium only plays remote WebRTC audio in Web Audio while the stream is attached to a media element. */
  sink: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  highPass: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
  gain: GainNode;
}

interface ScreenAudioGraph {
  sink: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
}

type PerKind<T> = Record<VideoKind, T>;

interface PeerRecord {
  peerId: string;
  userId: string;
  connection: PeerConnectionState;
  audioCall: MediaConnection | null;
  audioGraph: RemoteAudioGraph | null;
  dialAttempts: number;
  nextDialAt: number;
  /** Our video (screen or camera) sent to this peer. */
  videoOut: PerKind<MediaConnection | null>;
  /** This peer's video received by us. */
  videoIn: PerKind<MediaConnection | null>;
  videoStreams: PerKind<MediaStream | null>;
  screenAudio: ScreenAudioGraph | null;
  volume: number;
  locallyMuted: boolean;
}

interface PendingCall {
  call: MediaConnection;
  timer: ReturnType<typeof setTimeout>;
}

const VIDEO_KINDS: VideoKind[] = ['screen', 'camera'];
const SELF_KEY = '__self__';
const METER_INTERVAL_MS = 50;
const GATE_HOLD_MS = 250;
const REMOTE_SPEAKING_DB = -50;
const PENDING_CALL_TTL_MS = 5_000;
const MAX_DIAL_ATTEMPTS = 5;
const RETRY_INTERVAL_MS = 3_000;

const AUDIO_BITRATE: Record<BandwidthProfile, number> = { low: 24_000, balanced: 64_000, high: 128_000 };
const SCREEN_AUDIO_BITRATE: Record<BandwidthProfile, number> = { low: 48_000, balanced: 96_000, high: 160_000 };
const CAMERA_BITRATE: Record<BandwidthProfile, number> = { low: 350_000, balanced: 900_000, high: 1_800_000 };
const CAMERA_SIZE: Record<BandwidthProfile, { width: number; height: number }> = {
  low: { width: 640, height: 360 },
  balanced: { width: 960, height: 540 },
  high: { width: 1280, height: 720 },
};
const RESOLUTIONS: Record<ScreenResolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};
/** Base video bitrate (bps) per resolution at 30 FPS on the "balanced" profile. */
const SCREEN_BASE_BITRATE: Record<ScreenResolution, number> = { '720p': 2_500_000, '1080p': 4_500_000 };
const PROFILE_FACTOR: Record<BandwidthProfile, number> = { low: 0.5, balanced: 1, high: 1.6 };

function screenVideoBitrate(opts: ScreenShareOptions, profile: BandwidthProfile): number {
  // Frame rate scales sub-linearly because inter-frame deltas shrink at higher FPS.
  const fpsFactor = Math.sqrt(opts.frameRate / 30);
  return Math.round(SCREEN_BASE_BITRATE[opts.resolution] * fpsFactor * PROFILE_FACTOR[profile]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rmsDb(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = Math.sqrt(sum / buffer.length);
  return 20 * Math.log10(Math.max(rms, 1e-8));
}

/** Enables Opus in-band FEC (loss resilience) and DTX (no packets during silence) to save bandwidth. */
function tuneOpusSdp(sdp: string): string {
  const match = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp);
  if (!match) return sdp;
  const fmtp = new RegExp(`a=fmtp:${match[1]} ([^\\r\\n]*)`);
  return sdp.replace(fmtp, (line, params: string) => {
    const additions = ['useinbandfec=1', 'usedtx=1'].filter((p) => !params.includes(p.split('=')[0]));
    return additions.length ? `${line};${additions.join(';')}` : line;
  });
}

function isPresencePayload(value: unknown): value is PresencePayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === 'string' &&
    typeof v.peerId === 'string' &&
    v.peerId.startsWith(`ae-${v.userId}-`) &&
    typeof v.muted === 'boolean' &&
    typeof v.deafened === 'boolean' &&
    typeof v.sharingScreen === 'boolean' &&
    typeof v.joinedAt === 'number'
  );
}

function micConstraints(s: AudioProcessingSettings): MediaStreamConstraints {
  return {
    video: false,
    audio: {
      deviceId: s.inputDeviceId ? { exact: s.inputDeviceId } : undefined,
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression && !s.rnnoise,
      autoGainControl: s.autoGainControl,
      channelCount: 1,
      sampleRate: 48_000,
    },
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Microphone or camera permission was denied.';
  if (err instanceof DOMException && err.name === 'NotFoundError') return 'No microphone or camera was found.';
  if (err instanceof DOMException && err.name === 'NotReadableError') return 'The device is in use by another app.';
  if (err instanceof Error) return err.message;
  return String(err);
}

function emptyKinds<T>(value: T): PerKind<T> {
  return { screen: value, camera: value };
}

// Per-user volume preferences survive sessions. They are keyed by user id because peer ids change on every join.
type VolumePrefs = Record<string, { volume: number; muted: boolean }>;

function loadVolumePrefs(ownerId: string): VolumePrefs {
  try {
    const raw = localStorage.getItem(`aether.voice.volumes.${ownerId}`);
    return raw ? (JSON.parse(raw) as VolumePrefs) : {};
  } catch {
    return {};
  }
}

function saveVolumePrefs(ownerId: string, prefs: VolumePrefs): void {
  try {
    localStorage.setItem(`aether.voice.volumes.${ownerId}`, JSON.stringify(prefs));
  } catch {
    // Storage may be unavailable (private mode, quota). Preferences then last for this session only.
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function useVoiceEngine({ supabase, userId, initialSettings, peerServer }: UseVoiceEngineOptions): VoiceEngine {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [selfPeerId, setSelfPeerId] = useState<string | null>(null);
  const [baseParticipants, setBaseParticipants] = useState<Omit<VoiceParticipant, 'speaking'>[]>([]);
  const [speakingSet, setSpeakingSet] = useState<ReadonlySet<string>>(() => new Set());
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null);
  const [settings, setSettings] = useState<AudioProcessingSettings>(() => ({
    ...DEFAULT_AUDIO_SETTINGS,
    ...initialSettings,
  }));

  // Mutable engine state lives in refs so PeerJS and Realtime callbacks always see current values.
  const userIdRef = useRef(userId);
  const settingsRef = useRef(settings);
  const peerServerRef = useRef(peerServer);
  const sessionRef = useRef(0);
  const peerRef = useRef<Peer | null>(null);
  const selfPeerIdRef = useRef<string | null>(null);
  const realtimeRef = useRef<RealtimeChannel | null>(null);
  const localRef = useRef<LocalAudioGraph | null>(null);
  const recordsRef = useRef(new Map<string, PeerRecord>());
  const presenceRef = useRef(new Map<string, PresencePayload>());
  const pendingCallsRef = useRef(new Map<string, PendingCall>());
  const videoRef = useRef<PerKind<MediaStream | null>>(emptyKinds(null));
  const screenOptionsRef = useRef<ScreenShareOptions>(DEFAULT_SCREEN_SHARE);
  const flagsRef = useRef({ muted: false, deafened: false, mutedBeforeDeafen: false, joinedAt: 0 });
  const timersRef = useRef<{ meter: ReturnType<typeof setInterval> | null; retry: ReturnType<typeof setInterval> | null }>({
    meter: null,
    retry: null,
  });
  const speakingRef = useRef<ReadonlySet<string>>(new Set());
  const volumePrefsRef = useRef<VolumePrefs>({});
  const blockedRef = useRef<ReadonlySet<string>>(new Set());
  const forcedRef = useRef({ mute: false, deafen: false });
  const statsPrevRef = useRef(new Map<string, { at: number; inBytes: number; outBytes: number }>());

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);
  useEffect(() => {
    peerServerRef.current = peerServer;
  }, [peerServer]);

  // ── Snapshot helpers ──────────────────────────────────────────────────────────────────────

  /** Publishes a React-state snapshot of the presence roster merged with connection records. */
  const syncParticipants = useCallback(() => {
    const self = selfPeerIdRef.current;
    const list: Array<Omit<VoiceParticipant, 'speaking'> & { joinedAt: number }> = [];
    for (const [peerId, p] of presenceRef.current) {
      if (peerId === self) continue;
      const rec = recordsRef.current.get(peerId);
      list.push({
        peerId,
        userId: p.userId,
        muted: p.muted,
        deafened: p.deafened,
        sharingScreen: p.sharingScreen,
        cameraOn: p.cameraOn === true,
        connection: rec?.connection ?? 'connecting',
        volume: rec?.volume ?? 1,
        locallyMuted: rec?.locallyMuted ?? false,
        screenStream: rec?.videoStreams.screen ?? null,
        cameraStream: rec?.videoStreams.camera ?? null,
        joinedAt: p.joinedAt,
      });
    }
    list.sort((a, b) => a.joinedAt - b.joinedAt || a.peerId.localeCompare(b.peerId));
    setBaseParticipants(list.map(({ joinedAt: _joinedAt, ...rest }) => rest));
  }, []);

  /** Pushes our own state (mute, deafen, video) to everyone in the room. */
  const publishPresence = useCallback(async () => {
    const ch = realtimeRef.current;
    const uid = userIdRef.current;
    const peerId = selfPeerIdRef.current;
    if (!ch || !uid || !peerId) return;
    const payload: PresencePayload = {
      userId: uid,
      peerId,
      muted: flagsRef.current.muted,
      deafened: flagsRef.current.deafened,
      sharingScreen: videoRef.current.screen !== null,
      cameraOn: videoRef.current.camera !== null,
      joinedAt: flagsRef.current.joinedAt,
    };
    await ch.track(payload);
  }, []);

  // ── Remote audio graph ────────────────────────────────────────────────────────────────────

  const applyPeerGain = useCallback((rec: PeerRecord) => {
    const local = localRef.current;
    if (!local) return;
    const target = rec.locallyMuted || blockedRef.current.has(rec.userId) ? 0 : rec.volume;
    const t = local.ctx.currentTime;
    rec.audioGraph?.gain.gain.setTargetAtTime(target, t, 0.02);
    rec.screenAudio?.gain.gain.setTargetAtTime(target, t, 0.02);
  }, []);

  const detachRemoteAudio = useCallback((rec: PeerRecord) => {
    const g = rec.audioGraph;
    if (!g) return;
    rec.audioGraph = null;
    g.source.disconnect();
    g.highPass.disconnect();
    g.compressor.disconnect();
    g.analyser.disconnect();
    g.gain.disconnect();
    g.sink.pause();
    g.sink.srcObject = null;
  }, []);

  const attachRemoteAudio = useCallback(
    (rec: PeerRecord, stream: MediaStream) => {
      const local = localRef.current;
      if (!local || stream.getAudioTracks().length === 0) return;
      detachRemoteAudio(rec);
      const { ctx } = local;

      const sink = new Audio();
      sink.muted = true;
      sink.srcObject = stream;
      void sink.play().catch(() => undefined);

      const source = ctx.createMediaStreamSource(stream);
      const highPass = ctx.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 70;
      highPass.Q.value = 0.707;

      // Gentle compression evens out loud and quiet speakers (loudness normalization).
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 24;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const gain = ctx.createGain();
      gain.gain.value = rec.locallyMuted ? 0 : rec.volume;

      source.connect(highPass);
      highPass.connect(compressor);
      compressor.connect(analyser); // measured before local volume, so speaking rings still show when locally muted
      compressor.connect(gain);
      gain.connect(local.master);

      rec.audioGraph = {
        sink,
        source,
        highPass,
        compressor,
        analyser,
        buffer: new Float32Array(analyser.fftSize),
        gain,
      };
    },
    [detachRemoteAudio],
  );

  const detachScreenAudio = useCallback((rec: PeerRecord) => {
    const g = rec.screenAudio;
    if (!g) return;
    rec.screenAudio = null;
    g.source.disconnect();
    g.gain.disconnect();
    g.sink.pause();
    g.sink.srcObject = null;
  }, []);

  const attachScreenAudio = useCallback(
    (rec: PeerRecord, stream: MediaStream) => {
      const local = localRef.current;
      detachScreenAudio(rec);
      if (!local || stream.getAudioTracks().length === 0) return;
      const sink = new Audio();
      sink.muted = true;
      sink.srcObject = stream;
      void sink.play().catch(() => undefined);
      const source = local.ctx.createMediaStreamSource(stream);
      const gain = local.ctx.createGain();
      gain.gain.value = rec.locallyMuted ? 0 : rec.volume;
      source.connect(gain);
      gain.connect(local.master);
      rec.screenAudio = { sink, source, gain };
    },
    [detachScreenAudio],
  );

  // ── Bitrate control ───────────────────────────────────────────────────────────────────────

  /** Caps sender bitrates and frame rate. Runs only after negotiation, when encodings exist. */
  const applySenderLimits = useCallback(async (call: MediaConnection, kind: CallMetadata['kind']) => {
    const pc = call.peerConnection as RTCPeerConnection | undefined;
    if (!pc) return;
    const profile = settingsRef.current.bandwidthProfile;
    const screenOpts = screenOptionsRef.current;
    await Promise.all(
      pc.getSenders().map(async (sender) => {
        const track = sender.track;
        if (!track) return;
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) return;
        for (const enc of params.encodings) {
          if (track.kind === 'audio') {
            enc.maxBitrate = kind === 'screen' ? SCREEN_AUDIO_BITRATE[profile] : AUDIO_BITRATE[profile];
            enc.priority = kind === 'audio' ? 'high' : 'medium';
            enc.networkPriority = kind === 'audio' ? 'high' : 'medium';
          } else if (kind === 'camera') {
            enc.maxBitrate = CAMERA_BITRATE[profile];
            enc.maxFramerate = 30;
            enc.priority = 'medium';
            enc.networkPriority = 'medium';
          } else {
            enc.maxBitrate = screenVideoBitrate(screenOpts, profile);
            enc.maxFramerate = screenOpts.frameRate;
            enc.priority = 'low';
            enc.networkPriority = 'low';
          }
        }
        try {
          await sender.setParameters(params);
        } catch {
          // Some browsers reject parts of the parameters (e.g. priority). The call still works with defaults.
        }
      }),
    );
  }, []);

  // ── Peer records ──────────────────────────────────────────────────────────────────────────

  const ensureRecord = useCallback((peerId: string): PeerRecord => {
    const existing = recordsRef.current.get(peerId);
    if (existing) return existing;
    const presence = presenceRef.current.get(peerId);
    const remoteUserId = presence?.userId ?? '';
    const pref = volumePrefsRef.current[remoteUserId];
    const rec: PeerRecord = {
      peerId,
      userId: remoteUserId,
      connection: 'connecting',
      audioCall: null,
      audioGraph: null,
      dialAttempts: 0,
      nextDialAt: 0,
      videoOut: emptyKinds(null),
      videoIn: emptyKinds(null),
      videoStreams: emptyKinds(null),
      screenAudio: null,
      volume: pref?.volume ?? 1,
      locallyMuted: pref?.muted ?? false,
    };
    recordsRef.current.set(peerId, rec);
    return rec;
  }, []);

  const clearIncomingVideo = useCallback(
    (rec: PeerRecord, kind: VideoKind) => {
      const call = rec.videoIn[kind];
      rec.videoIn[kind] = null;
      rec.videoStreams[kind] = null;
      if (kind === 'screen') detachScreenAudio(rec);
      call?.close();
    },
    [detachScreenAudio],
  );

  const teardownRecord = useCallback(
    (rec: PeerRecord) => {
      const audio = rec.audioCall;
      rec.audioCall = null;
      audio?.close();
      detachRemoteAudio(rec);
      for (const kind of VIDEO_KINDS) {
        const out = rec.videoOut[kind];
        rec.videoOut[kind] = null;
        out?.close();
        clearIncomingVideo(rec, kind);
      }
    },
    [clearIncomingVideo, detachRemoteAudio],
  );

  // ── Call wiring ───────────────────────────────────────────────────────────────────────────

  const wireAudioCall = useCallback(
    (rec: PeerRecord, call: MediaConnection) => {
      const session = sessionRef.current;
      rec.audioCall = call;
      rec.connection = 'connecting';

      call.on('stream', (remote) => {
        if (session !== sessionRef.current || rec.audioCall !== call) return;
        attachRemoteAudio(rec, remote);
        rec.connection = 'connected';
        rec.dialAttempts = 0;
        void applySenderLimits(call, 'audio');
        syncParticipants();
      });

      call.on('iceStateChanged', (state) => {
        if (session !== sessionRef.current || rec.audioCall !== call) return;
        if (state === 'connected' || state === 'completed') {
          void applySenderLimits(call, 'audio');
        } else if (state === 'failed' || state === 'closed') {
          // Drop the call. The retry loop redials if we are the designated caller.
          rec.audioCall = null;
          rec.connection = 'failed';
          detachRemoteAudio(rec);
          call.close();
          syncParticipants();
        }
      });

      const onEnd = () => {
        if (session !== sessionRef.current || rec.audioCall !== call) return;
        rec.audioCall = null;
        rec.connection = presenceRef.current.has(rec.peerId) ? 'failed' : 'connecting';
        detachRemoteAudio(rec);
        syncParticipants();
      };
      call.on('close', onEnd);
      call.on('error', onEnd);
    },
    [applySenderLimits, attachRemoteAudio, detachRemoteAudio, syncParticipants],
  );

  /** Sends one of our video streams to one viewer through a dedicated one-way call. */
  const startVideoCall = useCallback(
    (rec: PeerRecord, kind: VideoKind) => {
      const peer = peerRef.current;
      const stream = videoRef.current[kind];
      const uid = userIdRef.current;
      if (!peer || !stream || !uid || rec.videoOut[kind]) return;
      const metadata: CallMetadata = { kind, userId: uid };
      const call = peer.call(rec.peerId, stream, { metadata });
      rec.videoOut[kind] = call;
      const session = sessionRef.current;
      call.on('iceStateChanged', (state) => {
        if (session !== sessionRef.current || rec.videoOut[kind] !== call) return;
        if (state === 'connected' || state === 'completed') void applySenderLimits(call, kind);
        if (state === 'failed') {
          rec.videoOut[kind] = null;
          call.close();
        }
      });
      const onEnd = () => {
        if (rec.videoOut[kind] === call) rec.videoOut[kind] = null;
      };
      call.on('close', onEnd);
      call.on('error', onEnd);
    },
    [applySenderLimits],
  );

  /** Accepts a verified incoming call (audio mesh link, screen share or camera). */
  const acceptCall = useCallback(
    (call: MediaConnection) => {
      const meta = call.metadata as Partial<CallMetadata> | undefined;
      const presence = presenceRef.current.get(call.peer);
      if (!presence || (meta?.userId && meta.userId !== presence.userId)) {
        call.close();
        return;
      }
      const rec = ensureRecord(call.peer);

      if (meta?.kind === 'screen' || meta?.kind === 'camera') {
        const kind = meta.kind;
        if (rec.videoIn[kind] && rec.videoIn[kind] !== call) clearIncomingVideo(rec, kind);
        rec.videoIn[kind] = call;
        const session = sessionRef.current;
        call.answer(); // receive-only
        call.on('stream', (stream) => {
          if (session !== sessionRef.current || rec.videoIn[kind] !== call) return;
          rec.videoStreams[kind] = stream;
          if (kind === 'screen') attachScreenAudio(rec, stream);
          syncParticipants();
        });
        const onEnd = () => {
          if (rec.videoIn[kind] !== call) return;
          rec.videoIn[kind] = null;
          rec.videoStreams[kind] = null;
          if (kind === 'screen') detachScreenAudio(rec);
          syncParticipants();
        };
        call.on('close', onEnd);
        call.on('error', onEnd);
        return;
      }

      const local = localRef.current;
      if (!local) {
        call.close();
        return;
      }
      // The remote side redialed, for example after an ICE failure. Replace the stale link.
      if (rec.audioCall && rec.audioCall !== call) {
        const stale = rec.audioCall;
        rec.audioCall = null;
        stale.close();
      }
      call.answer(local.destination.stream, { sdpTransform: tuneOpusSdp });
      wireAudioCall(rec, call);
    },
    [attachScreenAudio, clearIncomingVideo, detachScreenAudio, ensureRecord, syncParticipants, wireAudioCall],
  );

  /** PeerJS `call` handler. Calls from peers not yet in our presence roster wait briefly, then are dropped. */
  const handleIncomingCall = useCallback(
    (call: MediaConnection) => {
      if (presenceRef.current.has(call.peer)) {
        acceptCall(call);
        return;
      }
      const key = call.connectionId;
      const timer = setTimeout(() => {
        pendingCallsRef.current.delete(key);
        call.close();
      }, PENDING_CALL_TTL_MS);
      pendingCallsRef.current.set(key, { call, timer });
    },
    [acceptCall],
  );

  // ── Mesh reconciliation ───────────────────────────────────────────────────────────────────

  /** Brings live connections in line with the presence roster. Idempotent; runs on every sync and retry tick. */
  const reconcileMesh = useCallback(() => {
    const self = selfPeerIdRef.current;
    const peer = peerRef.current;
    const local = localRef.current;
    const uid = userIdRef.current;
    if (!self || !peer || !local || !uid || peer.destroyed) return;

    // 1. Answer calls that arrived before their caller showed up in presence.
    for (const [key, pending] of pendingCallsRef.current) {
      if (presenceRef.current.has(pending.call.peer)) {
        clearTimeout(pending.timer);
        pendingCallsRef.current.delete(key);
        acceptCall(pending.call);
      }
    }

    // 2. Tear down peers that left the room.
    for (const [peerId, rec] of recordsRef.current) {
      if (!presenceRef.current.has(peerId)) {
        teardownRecord(rec);
        recordsRef.current.delete(peerId);
      }
    }

    // 3. Dial or refresh everyone still present.
    const now = Date.now();
    for (const [peerId, presence] of presenceRef.current) {
      if (peerId === self) continue;
      const rec = ensureRecord(peerId);
      rec.userId = presence.userId;

      if (!presence.sharingScreen && rec.videoIn.screen) clearIncomingVideo(rec, 'screen');
      if (!presence.cameraOn && rec.videoIn.camera) clearIncomingVideo(rec, 'camera');

      if (!rec.audioCall && self < peerId && !peer.disconnected) {
        if (rec.dialAttempts < MAX_DIAL_ATTEMPTS && now >= rec.nextDialAt) {
          rec.dialAttempts += 1;
          rec.nextDialAt = now + RETRY_INTERVAL_MS * rec.dialAttempts; // linear backoff
          const metadata: CallMetadata = { kind: 'audio', userId: uid };
          const call = peer.call(peerId, local.destination.stream, { metadata, sdpTransform: tuneOpusSdp });
          wireAudioCall(rec, call);
        } else if (rec.dialAttempts >= MAX_DIAL_ATTEMPTS) {
          rec.connection = 'failed';
        }
      }

      if (!peer.disconnected) {
        for (const kind of VIDEO_KINDS) if (videoRef.current[kind] && !rec.videoOut[kind]) startVideoCall(rec, kind);
      }
    }
    syncParticipants();
  }, [acceptCall, clearIncomingVideo, ensureRecord, startVideoCall, syncParticipants, teardownRecord, wireAudioCall]);

  // ── Metering: noise gate and speaking detection (one timer for the whole room) ───────────────

  const meterTick = useCallback(() => {
    const local = localRef.current;
    if (!local) return;
    const s = settingsRef.current;
    const now = performance.now();
    const db = rmsDb(local.analyser, local.buffer);

    const gateDisabled = s.noiseGateDb <= -100;
    if (gateDisabled || db >= s.noiseGateDb) {
      local.gateLastAboveAt = now;
      if (!local.gateOpen) {
        local.gateOpen = true;
        local.gate.gain.setTargetAtTime(1, local.ctx.currentTime, 0.005); // fast attack
      }
    } else if (local.gateOpen && now - local.gateLastAboveAt > GATE_HOLD_MS) {
      local.gateOpen = false;
      local.gate.gain.setTargetAtTime(0, local.ctx.currentTime, 0.05); // soft release
    }

    const next = new Set<string>();
    const selfThreshold = gateDisabled ? REMOTE_SPEAKING_DB : s.noiseGateDb;
    if (!flagsRef.current.muted && !forcedRef.current.mute && local.gateOpen && db >= selfThreshold) next.add(SELF_KEY);
    for (const [peerId, rec] of recordsRef.current) {
      const g = rec.audioGraph;
      if (g && rmsDb(g.analyser, g.buffer) >= REMOTE_SPEAKING_DB) next.add(peerId);
    }

    const prev = speakingRef.current;
    let changed = prev.size !== next.size;
    if (!changed) for (const id of next) if (!prev.has(id)) { changed = true; break; }
    if (changed) {
      speakingRef.current = next;
      setSpeakingSet(next);
    }
  }, []);

  // ── Local audio graph ─────────────────────────────────────────────────────────────────────

  const buildLocalGraph = useCallback((ctx: AudioContext, mic: MediaStream, s: AudioProcessingSettings, denoiser: Denoiser | null): LocalAudioGraph => {
    const source = ctx.createMediaStreamSource(mic);

    const highPass = ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = clamp(s.highPassHz, 20, 300);
    highPass.Q.value = 0.707;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -28;
    compressor.knee.value = 20;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;

    const inputGain = ctx.createGain();
    inputGain.gain.value = clamp(s.inputGain, 0, 2);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;

    const gate = ctx.createGain();
    gate.gain.value = s.noiseGateDb <= -100 ? 1 : 0;

    const destination = ctx.createMediaStreamDestination();
    destination.channelCount = 1;

    const master = ctx.createGain();
    master.connect(ctx.destination);

    if (denoiser) {
      source.connect(denoiser.node);
      denoiser.node.connect(highPass);
    } else source.connect(highPass);
    highPass.connect(compressor);
    compressor.connect(inputGain);
    inputGain.connect(analyser);
    inputGain.connect(gate);
    const micMute = ctx.createGain();
    gate.connect(micMute);
    micMute.connect(destination);

    return {
      ctx,
      master,
      mic,
      source,
      denoiser,
      highPass,
      compressor,
      inputGain,
      analyser,
      buffer: new Float32Array(analyser.fftSize),
      gate,
      micMute,
      destination,
      gateOpen: s.noiseGateDb <= -100,
      gateLastAboveAt: 0,
    };
  }, []);

  const applyOutputDevice = useCallback(async (ctx: AudioContext, deviceId: string | null) => {
    const sinkCtx = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof sinkCtx.setSinkId !== 'function') return;
    try {
      await sinkCtx.setSinkId(deviceId ?? '');
    } catch {
      // The device may have been unplugged. Playback stays on the current sink.
    }
  }, []);

  const applyOutgoingEnabled = useCallback(() => {
    const local = localRef.current;
    if (!local) return;
    const enabled = !flagsRef.current.muted && !forcedRef.current.mute;
    for (const track of local.destination.stream.getAudioTracks()) track.enabled = enabled;
  }, []);

  // ── Leave / teardown ──────────────────────────────────────────────────────────────────────

  const leave = useCallback(() => {
    sessionRef.current += 1; // invalidates every in-flight async continuation and event handler

    if (timersRef.current.meter) clearInterval(timersRef.current.meter);
    if (timersRef.current.retry) clearInterval(timersRef.current.retry);
    timersRef.current = { meter: null, retry: null };

    for (const pending of pendingCallsRef.current.values()) {
      clearTimeout(pending.timer);
      pending.call.close();
    }
    pendingCallsRef.current.clear();

    for (const rec of recordsRef.current.values()) teardownRecord(rec);
    recordsRef.current.clear();
    presenceRef.current.clear();

    for (const kind of VIDEO_KINDS) {
      videoRef.current[kind]?.getTracks().forEach((t) => t.stop());
      videoRef.current[kind] = null;
    }

    const ch = realtimeRef.current;
    realtimeRef.current = null;
    if (ch) {
      void ch.untrack().catch(() => undefined);
      void supabase.removeChannel(ch);
    }

    const peer = peerRef.current;
    peerRef.current = null;
    selfPeerIdRef.current = null;
    if (peer && !peer.destroyed) peer.destroy();

    const local = localRef.current;
    localRef.current = null;
    if (local) {
      for (const t of local.mic.getTracks()) t.stop();
      for (const t of local.destination.stream.getTracks()) t.stop();
      local.denoiser?.destroy();
      void local.ctx.close().catch(() => undefined);
    }

    flagsRef.current = { muted: false, deafened: false, mutedBeforeDeafen: false, joinedAt: 0 };
    forcedRef.current = { mute: false, deafen: false };
    statsPrevRef.current.clear();
    speakingRef.current = new Set();
    setSpeakingSet(new Set());
    setBaseParticipants([]);
    setIsMuted(false);
    setIsDeafened(false);
    setLocalScreenStream(null);
    setLocalCameraStream(null);
    setSelfPeerId(null);
    setChannelId(null);
    setStatus('idle');
  }, [supabase, teardownRecord]);

  // ── Join ──────────────────────────────────────────────────────────────────────────────────

  const join = useCallback(
    async (roomId: string) => {
      const uid = userIdRef.current;
      if (!uid) {
        setError('You must be signed in to join voice.');
        setStatus('error');
        return;
      }
      leave();
      const session = sessionRef.current;
      const stale = () => session !== sessionRef.current;

      setStatus('connecting');
      setError(null);
      setChannelId(roomId);
      volumePrefsRef.current = loadVolumePrefs(uid);

      try {
        // 1. Audio: context first, while we are still inside the user gesture, so autoplay is allowed.
        const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48_000 });
        void ctx.resume();
        let mic: MediaStream;
        try {
          mic = await navigator.mediaDevices.getUserMedia(micConstraints(settingsRef.current));
        } catch (err) {
          void ctx.close();
          throw err;
        }
        if (stale()) {
          for (const t of mic.getTracks()) t.stop();
          void ctx.close();
          return;
        }
        // RNNoise is optional: if the model fails to load we fall back to the plain graph.
        const denoiser = settingsRef.current.rnnoise ? await createDenoiser(ctx).catch(() => null) : null;
        if (stale()) {
          denoiser?.destroy();
          for (const t of mic.getTracks()) t.stop();
          void ctx.close();
          return;
        }
        localRef.current = buildLocalGraph(ctx, mic, settingsRef.current, denoiser);
        await applyOutputDevice(ctx, settingsRef.current.outputDeviceId);

        // 2. PeerJS identity. A per-join nonce lets one user be in voice from several tabs or devices.
        const peerId = `ae-${uid}-${crypto.randomUUID().slice(0, 8)}`;
        const peer = new Peer(peerId, {
          ...peerServerRef.current,
          debug: 0,
          config: { iceServers: iceServersFor(settingsRef.current), bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' },
        });
        peerRef.current = peer;
        await new Promise<void>((resolve, reject) => {
          const onOpen = () => {
            peer.off('error', onError);
            resolve();
          };
          const onError = (err: Error) => {
            peer.off('open', onOpen);
            reject(err);
          };
          peer.once('open', onOpen);
          peer.once('error', onError);
        });
        if (stale()) return;
        selfPeerIdRef.current = peerId;
        setSelfPeerId(peerId);

        peer.on('call', (call) => {
          if (!stale()) handleIncomingCall(call);
          else call.close();
        });
        peer.on('disconnected', () => {
          // Lost the signaling broker. Established media keeps flowing; reconnect for new handshakes.
          if (!stale() && !peer.destroyed) peer.reconnect();
        });
        peer.on('error', (err) => {
          if (stale()) return;
          // 'peer-unavailable' only means a dial target vanished. Presence cleanup handles that.
          if ((err as { type?: string }).type === 'peer-unavailable') return;
          setError(err.message);
        });

        // 3. Presence roster on the RLS-guarded private Realtime topic.
        await supabase.realtime.setAuth();
        if (stale()) return;
        const ch = supabase.channel(`voice:${roomId}`, {
          config: { private: true, presence: { key: peerId } },
        });
        realtimeRef.current = ch;

        ch.on('presence', { event: 'sync' }, () => {
          if (stale()) return;
          const next = new Map<string, PresencePayload>();
          const state = ch.presenceState();
          for (const key of Object.keys(state)) {
            const metas = state[key];
            const latest = metas[metas.length - 1] as unknown;
            if (isPresencePayload(latest) && latest.peerId === key) next.set(key, latest);
          }
          presenceRef.current = next;
          reconcileMesh();
        });

        flagsRef.current.joinedAt = Date.now();
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          ch.subscribe((state, err) => {
            if (state === 'SUBSCRIBED') {
              if (!settled) {
                settled = true;
                resolve();
              } else if (!stale()) {
                void publishPresence(); // re-announce after a socket reconnect
              }
            } else if ((state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') && !settled) {
              settled = true;
              reject(err ?? new Error(`Could not join the voice room (${state}). Do you have permission to connect?`));
            }
          });
        });
        if (stale()) return;
        await publishPresence();
        if (stale()) return;

        // 4. Background loops: metering every 50 ms, mesh repair every 3 s.
        timersRef.current.meter = setInterval(meterTick, METER_INTERVAL_MS);
        timersRef.current.retry = setInterval(reconcileMesh, RETRY_INTERVAL_MS);
        setStatus('connected');
      } catch (err) {
        if (stale()) return;
        const message = errorMessage(err);
        leave();
        setError(message);
        setStatus('error');
      }
    },
    [applyOutputDevice, buildLocalGraph, handleIncomingCall, leave, meterTick, publishPresence, reconcileMesh, supabase],
  );

  // ── Controls ──────────────────────────────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    const flags = flagsRef.current;
    const nextMuted = !flags.muted;
    flags.muted = nextMuted;
    // Unmuting while deafened also undeafens, matching common voice-chat UX.
    if (!nextMuted && flags.deafened) {
      flags.deafened = false;
      const local = localRef.current;
      local?.master.gain.setTargetAtTime(forcedRef.current.deafen ? 0 : 1, local.ctx.currentTime, 0.02);
      setIsDeafened(false);
    }
    applyOutgoingEnabled();
    setIsMuted(nextMuted);
    void publishPresence();
  }, [applyOutgoingEnabled, publishPresence]);

  const setMuted = useCallback(
    (muted: boolean) => {
      if (flagsRef.current.muted !== muted) toggleMute();
    },
    [toggleMute],
  );

  const toggleDeafen = useCallback(() => {
    const flags = flagsRef.current;
    const local = localRef.current;
    const nextDeafened = !flags.deafened;
    flags.deafened = nextDeafened;
    if (nextDeafened) {
      flags.mutedBeforeDeafen = flags.muted;
      flags.muted = true;
    } else {
      flags.muted = flags.mutedBeforeDeafen;
    }
    local?.master.gain.setTargetAtTime(nextDeafened || forcedRef.current.deafen ? 0 : 1, local.ctx.currentTime, 0.02);
    applyOutgoingEnabled();
    setIsDeafened(nextDeafened);
    setIsMuted(flags.muted);
    void publishPresence();
  }, [applyOutgoingEnabled, publishPresence]);

  const persistPeerPref = useCallback((rec: PeerRecord) => {
    const owner = userIdRef.current;
    if (!owner || !rec.userId) return;
    volumePrefsRef.current = {
      ...volumePrefsRef.current,
      [rec.userId]: { volume: rec.volume, muted: rec.locallyMuted },
    };
    saveVolumePrefs(owner, volumePrefsRef.current);
  }, []);

  const setPeerVolume = useCallback(
    (peerId: string, volume: number) => {
      const rec = recordsRef.current.get(peerId);
      if (!rec) return;
      rec.volume = clamp(volume, 0, 2);
      applyPeerGain(rec);
      persistPeerPref(rec);
      syncParticipants();
    },
    [applyPeerGain, persistPeerPref, syncParticipants],
  );

  const setPeerLocallyMuted = useCallback(
    (peerId: string, muted: boolean) => {
      const rec = recordsRef.current.get(peerId);
      if (!rec) return;
      rec.locallyMuted = muted;
      applyPeerGain(rec);
      persistPeerPref(rec);
      syncParticipants();
    },
    [applyPeerGain, persistPeerPref, syncParticipants],
  );

  /** Stops one of our outgoing video streams and closes its side-calls. */
  const stopVideo = useCallback(
    (kind: VideoKind) => {
      const stream = videoRef.current[kind];
      if (!stream) return;
      videoRef.current[kind] = null;
      for (const t of stream.getTracks()) t.stop();
      for (const rec of recordsRef.current.values()) {
        const call = rec.videoOut[kind];
        rec.videoOut[kind] = null;
        call?.close();
      }
      if (kind === 'screen') setLocalScreenStream(null);
      else setLocalCameraStream(null);
      void publishPresence(); // viewers drop their incoming stream when presence says we stopped
    },
    [publishPresence],
  );

  /** Publishes a freshly captured video stream to every peer. */
  const publishVideo = useCallback(
    async (kind: VideoKind, stream: MediaStream) => {
      if (videoRef.current[kind]) stopVideo(kind);
      const [video] = stream.getVideoTracks();
      video?.addEventListener('ended', () => stopVideo(kind), { once: true }); // e.g. the browser's "Stop sharing" button
      videoRef.current[kind] = stream;
      if (kind === 'screen') setLocalScreenStream(stream);
      else setLocalCameraStream(stream);
      for (const rec of recordsRef.current.values()) startVideoCall(rec, kind);
      await publishPresence();
    },
    [publishPresence, startVideoCall, stopVideo],
  );

  const stopScreenShare = useCallback(() => stopVideo('screen'), [stopVideo]);
  const stopCamera = useCallback(() => stopVideo('camera'), [stopVideo]);

  const startScreenShare = useCallback(
    async (partial?: Partial<ScreenShareOptions>) => {
      if (!peerRef.current || !localRef.current) throw new Error('Join a call before sharing your screen.');
      const options: ScreenShareOptions = { ...DEFAULT_SCREEN_SHARE, ...partial };
      const { width, height } = RESOLUTIONS[options.resolution];
      const session = sessionRef.current;

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: width, max: width },
          height: { ideal: height, max: height },
          frameRate: { ideal: options.frameRate, max: options.frameRate },
        },
        audio: options.includeAudio,
      });
      if (session !== sessionRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }

      const [video] = stream.getVideoTracks();
      if (video) {
        // Some capture sources ignore getDisplayMedia limits, so enforce the cap again on the live track.
        try {
          await video.applyConstraints({ width: { max: width }, height: { max: height }, frameRate: { max: options.frameRate } });
        } catch {
          // Not every source supports applyConstraints. The sender maxFramerate and maxBitrate caps still apply.
        }
        // 'detail' keeps text sharp at low FPS. 'motion' keeps high-FPS content fluid.
        video.contentHint = options.frameRate >= 60 ? 'motion' : 'detail';
      }
      screenOptionsRef.current = options;
      await publishVideo('screen', stream);
    },
    [publishVideo],
  );

  const startCamera = useCallback(async () => {
    if (!peerRef.current || !localRef.current) throw new Error('Join a call before turning on your camera.');
    const s = settingsRef.current;
    const size = CAMERA_SIZE[s.bandwidthProfile];
    const session = sessionRef.current;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: s.videoDeviceId ? { exact: s.videoDeviceId } : undefined,
          width: { ideal: size.width, max: size.width },
          height: { ideal: size.height, max: size.height },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
    if (session !== sessionRef.current) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    const [video] = stream.getVideoTracks();
    if (video) video.contentHint = 'motion';
    await publishVideo('camera', stream);
  }, [publishVideo]);

  const updateSettings = useCallback(
    async (patch: Partial<AudioProcessingSettings>) => {
      const prev = settingsRef.current;
      const next: AudioProcessingSettings = {
        ...prev,
        ...patch,
        highPassHz: clamp(patch.highPassHz ?? prev.highPassHz, 20, 300),
        noiseGateDb: clamp(patch.noiseGateDb ?? prev.noiseGateDb, -100, 0),
        inputGain: clamp(patch.inputGain ?? prev.inputGain, 0, 2),
      };
      settingsRef.current = next;
      setSettings(next);

      const local = localRef.current;
      if (!local) return;
      const t = local.ctx.currentTime;
      local.highPass.frequency.setTargetAtTime(next.highPassHz, t, 0.02);
      local.inputGain.gain.setTargetAtTime(next.inputGain, t, 0.02);

      if (next.outputDeviceId !== prev.outputDeviceId) await applyOutputDevice(local.ctx, next.outputDeviceId);

      const micChanged =
        next.inputDeviceId !== prev.inputDeviceId ||
        next.echoCancellation !== prev.echoCancellation ||
        next.noiseSuppression !== prev.noiseSuppression ||
        next.rnnoise !== prev.rnnoise ||
        next.autoGainControl !== prev.autoGainControl;
      if (micChanged) {
        const session = sessionRef.current;
        const mic = await navigator.mediaDevices.getUserMedia(micConstraints(next));
        const current = localRef.current;
        if (session !== sessionRef.current || !current) {
          for (const tr of mic.getTracks()) tr.stop();
          return;
        }
        // Turning RNNoise on or off swaps the denoiser in front of the high-pass filter.
        if (next.rnnoise !== prev.rnnoise) {
          current.denoiser?.destroy();
          current.denoiser = next.rnnoise ? await createDenoiser(current.ctx).catch(() => null) : null;
          current.denoiser?.node.connect(current.highPass);
        }
        // Hot-swap the graph source. The outgoing destination track, and so every peer link, is untouched.
        const source = current.ctx.createMediaStreamSource(mic);
        source.connect(current.denoiser?.node ?? current.highPass);
        current.source.disconnect();
        for (const tr of current.mic.getTracks()) tr.stop();
        current.source = source;
        current.mic = mic;
      }

      if (next.bandwidthProfile !== prev.bandwidthProfile) {
        for (const rec of recordsRef.current.values()) {
          if (rec.audioCall) void applySenderLimits(rec.audioCall, 'audio');
          for (const kind of VIDEO_KINDS) {
            const call = rec.videoOut[kind];
            if (call) void applySenderLimits(call, kind);
          }
        }
      }
    },
    [applyOutputDevice, applySenderLimits],
  );

  // ── Moderation, soundboard, stats ─────────────────────────────────────────────────────────

  const setRemoteBlocked = useCallback(
    (userIds: string[]) => {
      const next = new Set(userIds);
      const prev = blockedRef.current;
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return;
      blockedRef.current = next;
      for (const rec of recordsRef.current.values()) applyPeerGain(rec);
    },
    [applyPeerGain],
  );

  const setForcedMute = useCallback(
    (forced: boolean) => {
      if (forcedRef.current.mute === forced) return;
      forcedRef.current.mute = forced;
      applyOutgoingEnabled();
    },
    [applyOutgoingEnabled],
  );

  const setForcedDeafen = useCallback((forced: boolean) => {
    if (forcedRef.current.deafen === forced) return;
    forcedRef.current.deafen = forced;
    const local = localRef.current;
    local?.master.gain.setTargetAtTime(forced || flagsRef.current.deafened ? 0 : 1, local.ctx.currentTime, 0.02);
  }, []);

  const playToRoom = useCallback(
    (buffer: AudioBuffer, volume = 1) => {
      const local = localRef.current;
      if (!local || forcedRef.current.mute) return false;
      const src = local.ctx.createBufferSource();
      src.buffer = buffer;
      const gain = local.ctx.createGain();
      gain.gain.value = clamp(volume, 0, 1.5);
      src.connect(gain);
      gain.connect(local.destination); // to every peer (bypasses the noise gate)
      gain.connect(local.master); // and to us
      // Our own mute disables the outgoing track; let the clip (and only the clip) through while it plays.
      if (flagsRef.current.muted) {
        local.micMute.gain.value = 0;
        for (const t of local.destination.stream.getAudioTracks()) t.enabled = true;
      }
      src.onended = () => {
        gain.disconnect();
        local.micMute.gain.value = 1;
        applyOutgoingEnabled();
      };
      src.start();
      return true;
    },
    [applyOutgoingEnabled],
  );

  const getPeerStats = useCallback(async (peerId: string): Promise<PeerStats | null> => {
    const pc = recordsRef.current.get(peerId)?.audioCall?.peerConnection;
    if (!pc) return null;
    const report = await pc.getStats();
    let pingMs: number | null = null;
    let route: PeerStats['route'] = null;
    let inBytes = 0;
    let outBytes = 0;
    let lost = 0;
    let received = 0;
    const byId = new Map<string, Record<string, unknown>>();
    report.forEach((r: Record<string, unknown>) => byId.set(r.id as string, r));
    report.forEach((r: Record<string, unknown>) => {
      if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') {
        if (typeof r.currentRoundTripTime === 'number') pingMs = Math.round(r.currentRoundTripTime * 1000);
        const local = byId.get(r.localCandidateId as string);
        route = local?.candidateType === 'relay' ? 'relay' : 'direct';
      }
      if (r.type === 'inbound-rtp' && r.kind === 'audio') {
        inBytes += (r.bytesReceived as number) ?? 0;
        lost += (r.packetsLost as number) ?? 0;
        received += (r.packetsReceived as number) ?? 0;
      }
      if (r.type === 'outbound-rtp' && r.kind === 'audio') outBytes += (r.bytesSent as number) ?? 0;
    });
    const now = performance.now();
    const prev = statsPrevRef.current.get(peerId);
    statsPrevRef.current.set(peerId, { at: now, inBytes, outBytes });
    const secs = prev ? (now - prev.at) / 1000 : 0;
    return {
      pingMs,
      route,
      lossPct: received + lost > 0 ? Math.round((lost / (received + lost)) * 1000) / 10 : null,
      inKbps: prev && secs > 0 ? Math.round(((inBytes - prev.inBytes) * 8) / secs / 1000) : null,
      outKbps: prev && secs > 0 ? Math.round(((outBytes - prev.outBytes) * 8) / secs / 1000) : null,
    };
  }, []);

  // ── Lifecycle ─────────────────────────────────────────────────────────────────────────────

  // Leave on unmount, and on page hide so peers drop us at once instead of waiting for ICE timeouts.
  useEffect(() => {
    const onPageHide = () => leave();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      leave();
    };
  }, [leave]);

  // Signing out (userId → null) ends the voice session.
  useEffect(() => {
    if (!userId && peerRef.current) leave();
  }, [userId, leave]);

  const participants = useMemo<VoiceParticipant[]>(
    () => baseParticipants.map((p) => ({ ...p, speaking: speakingSet.has(p.peerId) })),
    [baseParticipants, speakingSet],
  );

  return {
    status,
    error,
    channelId,
    selfPeerId,
    participants,
    isSpeaking: speakingSet.has(SELF_KEY),
    isMuted,
    isDeafened,
    isSharingScreen: localScreenStream !== null,
    isCameraOn: localCameraStream !== null,
    localScreenStream,
    localCameraStream,
    settings,
    join,
    leave,
    toggleMute,
    setMuted,
    toggleDeafen,
    setPeerVolume,
    setPeerLocallyMuted,
    startScreenShare,
    stopScreenShare,
    startCamera,
    stopCamera,
    updateSettings,
    setRemoteBlocked,
    setForcedMute,
    setForcedDeafen,
    playToRoom,
    getPeerStats,
  };
}
