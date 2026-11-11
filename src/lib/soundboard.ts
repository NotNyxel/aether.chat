/**
 * Soundboard audio: built-in sounds synthesized on the fly (no files to ship or license) and
 * decoding of server-uploaded clips. Buffers are cached per sound.
 */
const RATE = 48_000;

type Synth = (ctx: OfflineAudioContext) => void;

function env(ctx: OfflineAudioContext, node: AudioNode, at: number, attack: number, hold: number, release: number, peak = 0.8) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, at + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  node.connect(g);
  g.connect(ctx.destination);
  return g;
}

function tone(ctx: OfflineAudioContext, type: OscillatorType, freq: number, at: number, dur: number, peak = 0.5, glideTo?: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  env(ctx, o, at, 0.01, dur * 0.6, dur * 0.4, peak);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function noise(ctx: OfflineAudioContext, at: number, dur: number, peak: number, filterHz: number, type: BiquadFilterType = 'lowpass') {
  const buf = ctx.createBuffer(1, Math.ceil(RATE * dur), RATE);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = filterHz;
  src.connect(f);
  env(ctx, f, at, 0.002, 0.01, dur, peak);
  src.start(at);
}

export interface BuiltinSound {
  id: string;
  name: string;
  emoji: string;
  seconds: number;
  synth: Synth;
}

export const BUILTIN_SOUNDS: BuiltinSound[] = [
  {
    id: 'builtin:airhorn',
    name: 'Air horn',
    emoji: '📯',
    seconds: 1.6,
    synth: (ctx) => {
      for (const [at, dur] of [[0, 0.22], [0.28, 0.22], [0.56, 0.9]] as const) {
        for (const f of [440, 554, 659]) tone(ctx, 'sawtooth', f, at, dur, 0.18);
      }
    },
  },
  {
    id: 'builtin:rimshot',
    name: 'Ba dum tss',
    emoji: '🥁',
    seconds: 1.4,
    synth: (ctx) => {
      tone(ctx, 'sine', 180, 0, 0.18, 0.7, 60);
      tone(ctx, 'sine', 180, 0.22, 0.18, 0.7, 60);
      noise(ctx, 0.45, 0.8, 0.5, 6000, 'highpass');
    },
  },
  {
    id: 'builtin:sad',
    name: 'Sad trombone',
    emoji: '🎺',
    seconds: 2.4,
    synth: (ctx) => {
      tone(ctx, 'sawtooth', 294, 0, 0.45, 0.25);
      tone(ctx, 'sawtooth', 277, 0.5, 0.45, 0.25);
      tone(ctx, 'sawtooth', 262, 1.0, 0.45, 0.25);
      tone(ctx, 'sawtooth', 247, 1.5, 0.85, 0.25, 230);
    },
  },
  {
    id: 'builtin:tada',
    name: 'Ta-da',
    emoji: '🎉',
    seconds: 1.6,
    synth: (ctx) => {
      tone(ctx, 'triangle', 523, 0, 0.15, 0.4);
      for (const f of [523, 659, 784, 1047]) tone(ctx, 'triangle', f, 0.18, 1.2, 0.18);
    },
  },
  {
    id: 'builtin:quack',
    name: 'Quack',
    emoji: '🦆',
    seconds: 0.6,
    synth: (ctx) => {
      tone(ctx, 'square', 520, 0, 0.18, 0.3, 300);
      tone(ctx, 'square', 480, 0.22, 0.25, 0.3, 260);
    },
  },
  {
    id: 'builtin:boing',
    name: 'Boing',
    emoji: '🪀',
    seconds: 0.9,
    synth: (ctx) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(120, 0);
      o.frequency.exponentialRampToValueAtTime(600, 0.15);
      o.frequency.exponentialRampToValueAtTime(200, 0.8);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 18;
      const depth = ctx.createGain();
      depth.gain.value = 40;
      lfo.connect(depth);
      depth.connect(o.frequency);
      env(ctx, o, 0, 0.01, 0.3, 0.5, 0.6);
      o.start(0);
      lfo.start(0);
      o.stop(0.9);
      lfo.stop(0.9);
    },
  },
  {
    id: 'builtin:crickets',
    name: 'Crickets',
    emoji: '🦗',
    seconds: 2.2,
    synth: (ctx) => {
      for (let i = 0; i < 6; i++) {
        const at = i * 0.35;
        for (let j = 0; j < 3; j++) tone(ctx, 'sine', 4200, at + j * 0.045, 0.03, 0.15);
      }
    },
  },
  {
    id: 'builtin:drumroll',
    name: 'Drum roll',
    emoji: '🪘',
    seconds: 2.4,
    synth: (ctx) => {
      for (let t = 0; t < 1.7; t += 0.045) noise(ctx, t, 0.06, 0.15 + t * 0.15, 1800);
      tone(ctx, 'sine', 110, 1.75, 0.5, 0.8, 50);
      noise(ctx, 1.75, 0.6, 0.5, 7000, 'highpass');
    },
  },
];

const cache = new Map<string, Promise<AudioBuffer>>();

export function builtinBuffer(sound: BuiltinSound): Promise<AudioBuffer> {
  let p = cache.get(sound.id);
  if (!p) {
    const ctx = new OfflineAudioContext(1, Math.ceil(RATE * sound.seconds), RATE);
    sound.synth(ctx);
    // Normalize to a consistent peak so no sound clips or is much quieter than the rest.
    p = ctx.startRendering().then((buf) => {
      const d = buf.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
      const gain = peak > 0 ? 0.8 / peak : 1;
      for (let i = 0; i < d.length; i++) d[i] = d[i]! * gain;
      return buf;
    });
    cache.set(sound.id, p);
  }
  return p;
}

export function decodeClip(url: string): Promise<AudioBuffer> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Couldn't load the sound (${r.status}).`);
        return r.arrayBuffer();
      })
      .then((data) => new OfflineAudioContext(1, 1, RATE).decodeAudioData(data));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

export const MAX_SOUND_BYTES = 1_048_576;
export const MAX_SOUND_SECONDS = 5.2;

/** Validates an upload before it goes to storage. Returns its duration in seconds. */
export async function checkSoundFile(file: File): Promise<number> {
  if (file.size > MAX_SOUND_BYTES) throw new Error('Sounds can be at most 1 MB.');
  if (!/^audio\//.test(file.type)) throw new Error('Pick an audio file (MP3, OGG, WAV).');
  const buf = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await file.arrayBuffer()).catch(() => {
    throw new Error("That file couldn't be decoded as audio.");
  });
  if (buf.duration > MAX_SOUND_SECONDS) throw new Error('Sounds can be at most 5 seconds long.');
  return buf.duration;
}

/** Plays a buffer locally only (preview). */
export function previewBuffer(buffer: AudioBuffer, volume = 1): void {
  const ctx = new AudioContext();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.value = volume;
  src.connect(g);
  g.connect(ctx.destination);
  src.onended = () => void ctx.close();
  src.start();
}
