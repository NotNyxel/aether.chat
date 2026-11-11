/**
 * aether.chat sound effects, synthesized with the Web Audio API (no audio assets shipped).
 * Each sound is a short list of notes with a soft attack/release envelope. Volume, the master
 * switch and per-sound toggles come from the settings store; the selected output device is honored.
 */
import { useSettingsStore } from '../stores/settingsStore';

export type SoundId =
  | 'message'
  | 'mention'
  | 'messageSent'
  | 'voiceJoin'
  | 'voiceLeave'
  | 'userJoin'
  | 'userLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'streamStart'
  | 'streamStop'
  | 'callIncoming'
  | 'callOutgoing'
  | 'callEnd';

interface Note {
  /** Frequency in Hz. */
  f: number;
  /** Start offset in seconds. */
  t: number;
  /** Duration in seconds. */
  d: number;
  type?: OscillatorType;
  /** Relative loudness 0–1. */
  g?: number;
  /** Optional pitch glide target. */
  to?: number;
}

const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, B5 = 987.77, C6 = 1046.5, E6 = 1318.5, G6 = 1568;

const SOUNDS: Record<SoundId, Note[]> = {
  message: [
    { f: A5, t: 0, d: 0.09, g: 0.7 },
    { f: E6, t: 0.07, d: 0.16, g: 0.55 },
  ],
  mention: [
    { f: B5, t: 0, d: 0.08, type: 'triangle' },
    { f: E6, t: 0.08, d: 0.08, type: 'triangle' },
    { f: G6, t: 0.16, d: 0.2, type: 'triangle', g: 0.8 },
  ],
  messageSent: [{ f: 1400, t: 0, d: 0.05, g: 0.25, to: 1800 }],
  voiceJoin: [
    { f: C5, t: 0, d: 0.09 },
    { f: E5, t: 0.08, d: 0.09 },
    { f: G5, t: 0.16, d: 0.18 },
  ],
  voiceLeave: [
    { f: G5, t: 0, d: 0.09 },
    { f: E5, t: 0.08, d: 0.09 },
    { f: C5, t: 0.16, d: 0.2 },
  ],
  userJoin: [
    { f: E5, t: 0, d: 0.08, g: 0.6 },
    { f: A5, t: 0.08, d: 0.14, g: 0.6 },
  ],
  userLeave: [
    { f: A5, t: 0, d: 0.08, g: 0.6 },
    { f: E5, t: 0.08, d: 0.14, g: 0.6 },
  ],
  mute: [{ f: 620, t: 0, d: 0.1, type: 'triangle', g: 0.55, to: 420 }],
  unmute: [{ f: 420, t: 0, d: 0.1, type: 'triangle', g: 0.55, to: 620 }],
  deafen: [
    { f: 520, t: 0, d: 0.08, type: 'triangle', g: 0.55 },
    { f: 360, t: 0.08, d: 0.14, type: 'triangle', g: 0.55 },
  ],
  undeafen: [
    { f: 360, t: 0, d: 0.08, type: 'triangle', g: 0.55 },
    { f: 520, t: 0.08, d: 0.14, type: 'triangle', g: 0.55 },
  ],
  streamStart: [
    { f: G5, t: 0, d: 0.08 },
    { f: C6, t: 0.08, d: 0.16 },
  ],
  streamStop: [
    { f: C6, t: 0, d: 0.08 },
    { f: G5, t: 0.08, d: 0.16 },
  ],
  callIncoming: [
    { f: A5, t: 0, d: 0.16, g: 0.8 },
    { f: E5, t: 0.18, d: 0.16, g: 0.8 },
    { f: A5, t: 0.6, d: 0.16, g: 0.8 },
    { f: E5, t: 0.78, d: 0.16, g: 0.8 },
  ],
  callOutgoing: [
    { f: 440, t: 0, d: 0.45, g: 0.35 },
    { f: 480, t: 0, d: 0.45, g: 0.35 },
  ],
  callEnd: [
    { f: E5, t: 0, d: 0.1 },
    { f: D5, t: 0.1, d: 0.1 },
    { f: C5, t: 0.2, d: 0.22 },
  ],
};

export const SOUND_INFO: Record<SoundId, { label: string; hint: string }> = {
  message: { label: 'Direct message', hint: 'A DM or group DM arrives while you are elsewhere' },
  mention: { label: 'Mention', hint: 'Someone @mentions you, or @everyone' },
  messageSent: { label: 'Message sent', hint: 'A subtle tick when you send' },
  voiceJoin: { label: 'You join voice', hint: 'You connect to a voice channel or call' },
  voiceLeave: { label: 'You leave voice', hint: 'You disconnect' },
  userJoin: { label: 'Someone joins', hint: 'Another person joins your voice room' },
  userLeave: { label: 'Someone leaves', hint: 'Another person leaves your voice room' },
  mute: { label: 'Mute', hint: 'You mute your microphone' },
  unmute: { label: 'Unmute', hint: 'You unmute' },
  deafen: { label: 'Deafen', hint: 'You deafen' },
  undeafen: { label: 'Undeafen', hint: 'You undeafen' },
  streamStart: { label: 'Stream starts', hint: 'Someone in your room starts sharing their screen' },
  streamStop: { label: 'Stream ends', hint: 'A screen share stops' },
  callIncoming: { label: 'Incoming call', hint: 'Ringtone for DM and group calls' },
  callOutgoing: { label: 'Outgoing call', hint: 'Ringback while you wait for someone to answer' },
  callEnd: { label: 'Call ended', hint: 'A DM call ends' },
};

export const ALL_SOUNDS = Object.keys(SOUNDS) as SoundId[];

let ctx: AudioContext | null = null;
let sinkApplied: string | null | undefined;

function getContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  const sink = useSettingsStore.getState().audio.outputDeviceId;
  const withSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (sink !== sinkApplied && typeof withSink.setSinkId === 'function') {
    sinkApplied = sink;
    void withSink.setSinkId(sink ?? '').catch(() => undefined);
  }
  return ctx;
}

/** Plays a sound now, honoring the user's sound settings. `force` ignores per-sound toggles (used by previews). */
export function playSound(id: SoundId, force = false): void {
  const { sounds } = useSettingsStore.getState();
  if (!force && (!sounds.enabled || sounds.disabled.includes(id))) return;
  const ac = getContext();
  if (!ac) return;
  const master = ac.createGain();
  master.gain.value = Math.max(0, Math.min(1, sounds.volume)) * 0.22;
  master.connect(ac.destination);
  const now = ac.currentTime + 0.01;
  let end = now;
  for (const n of SOUNDS[id]) {
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = n.type ?? 'sine';
    osc.frequency.setValueAtTime(n.f, now + n.t);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, now + n.t + n.d);
    const peak = n.g ?? 1;
    env.gain.setValueAtTime(0, now + n.t);
    env.gain.linearRampToValueAtTime(peak, now + n.t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
    osc.connect(env).connect(master);
    osc.start(now + n.t);
    osc.stop(now + n.t + n.d + 0.02);
    end = Math.max(end, now + n.t + n.d + 0.05);
  }
  setTimeout(() => master.disconnect(), (end - ac.currentTime) * 1000 + 50);
}

/** Repeats a sound every `everyMs` until the returned stop function is called (or `maxMs` passes). */
export function loopSound(id: SoundId, everyMs: number, maxMs = 30_000): () => void {
  playSound(id);
  const timer = setInterval(() => playSound(id), everyMs);
  const cap = setTimeout(() => clearInterval(timer), maxMs);
  return () => {
    clearInterval(timer);
    clearTimeout(cap);
  };
}
