/**
 * Voice messages: record from the message box, send as an audio attachment with its length and a
 * small waveform, and play back in chat with a scrubbable waveform.
 *   - Phones: press and hold the mic, let go to send; slide left to cancel.
 *   - Computers: click the mic to start, then Send or the bin to discard.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Attachment } from '../types/db';
import { LockIcon, MicIcon, PauseIcon, PlayIcon, SendIcon, TrashIcon } from './icons';
import { toast } from './Toaster';
import { currentLanguage, t } from '../lib/i18n';
import { transcribe } from '../lib/ondevice';

const MAX_SECONDS = 300;
/** How far left to slide (px) to lock a recording. */
const LOCK_DISTANCE = 80;
const BARS = 48;

export interface VoiceAttachment extends Attachment {
  voice?: boolean;
  duration?: number;
  waveform?: number[];
}

function pickMime(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return '';
}

function fmt(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

interface Recording {
  stop: () => Promise<{ file: File; duration: number; waveform: number[] } | null>;
  cancel: () => void;
  level: () => number;
}

async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  const levels: number[] = [];
  const level = () => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    return Math.min(1, peak / 90);
  };
  const sampler = setInterval(() => levels.push(level()), 100);
  const started = performance.now();
  rec.start(250);
  let cleaned = false;
  // Always release the microphone, exactly once, whatever happens.
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(sampler);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };
  return {
    level,
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      cleanup();
    },
    stop: () =>
      new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          cleanup();
          const duration = (performance.now() - started) / 1000;
          if (duration < 0.7) return resolve(null);
          const type = (rec.mimeType || mime || 'audio/webm').split(';')[0]!;
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          // Squash the level history into a fixed number of bars (0–100).
          const waveform = Array.from({ length: BARS }, (_, i) => {
            const from = Math.floor((i * levels.length) / BARS);
            const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / BARS));
            const slice = levels.slice(from, to);
            return Math.round(Math.min(1, Math.max(0.06, slice.reduce((a, b) => Math.max(a, b), 0))) * 100);
          });
          resolve({ file: new File(chunks, `voice-message.${ext}`, { type }), duration, waveform });
        };
        rec.onstop = finish;
        // Some browsers (iPad Safari) don't always report the stop: don't wait forever, and never
        // leave the microphone on.
        setTimeout(finish, 1500);
        if (rec.state !== 'inactive') rec.stop();
        else finish();
      }),
  };
}

/**
 * The mic button and, while recording, the recording bar (WhatsApp style).
 *   Touch: hold to record, release to send. Slide left while holding to lock: it keeps recording
 *   hands-free, with Delete and Send buttons.
 *   Mouse: a click starts a locked recording straight away.
 * The microphone is always released: when you stop, cancel, leave the chat, or let go before the
 * mic was ready. `onSend` gets the file and its details; the caller uploads and sends it.
 */
export function VoiceRecorder({
  disabled,
  onRecordingChange,
  onSend,
}: {
  disabled?: boolean;
  onRecordingChange: (recording: boolean) => void;
  onSend: (rec: { file: File; duration: number; waveform: number[] }) => void;
}) {
  const [rec, setRec] = useState<Recording | null>(null);
  const [mode, setModeState] = useState<'hold' | 'locked'>('hold');
  // Also kept in a ref: a release can arrive before React re-renders after a lock.
  const modeRef = useRef<'hold' | 'locked'>('hold');
  const setMode = (m: 'hold' | 'locked') => {
    modeRef.current = m;
    setModeState(m);
  };
  const [seconds, setSeconds] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const [slide, setSlide] = useState(0);
  const startX = useRef(0);
  const recRef = useRef<Recording | null>(null);
  /** What the finger did while the mic was still opening. */
  const intent = useRef<'hold' | 'lock' | 'released' | 'cancelled' | null>(null);

  useEffect(() => onRecordingChange(!!rec), [rec, onRecordingChange]);
  // Leaving the chat or closing the app while recording: release the mic.
  useEffect(() => () => recRef.current?.cancel(), []);
  useEffect(() => {
    if (!rec) return;
    const t0 = Date.now();
    const t = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      setSeconds(s);
      setBars((b) => [...b.slice(-39), rec.level()]);
      if (s >= MAX_SECONDS) void finish(rec);
    }, 100);
    return () => clearInterval(t);
  }, [rec]);

  const begin = async (how: 'hold' | 'lock') => {
    if (rec || disabled || intent.current) return;
    intent.current = how;
    let r: Recording;
    try {
      r = await startRecording();
    } catch (e) {
      intent.current = null;
      toast.error(e instanceof Error && e.name === 'NotAllowedError' ? 'Aether needs microphone access to record voice messages.' : 'Could not start recording.');
      return;
    }
    const now = intent.current as 'hold' | 'lock' | 'released' | 'cancelled' | null;
    intent.current = null;
    if (now === 'cancelled' || now === 'released') {
      // Let go before the mic was ready (often during the permission prompt): nothing to send.
      r.cancel();
      if (now === 'released') toast('Hold the mic button to record, or slide left to lock.');
      return;
    }
    recRef.current = r;
    setMode(now === 'lock' ? 'locked' : 'hold');
    setSeconds(0);
    setBars([]);
    setSlide(0);
    setRec(r);
    navigator.vibrate?.(15);
  };
  const finish = async (r: Recording | null = rec) => {
    if (!r) return;
    recRef.current = null;
    setRec(null);
    const out = await r.stop();
    if (out) onSend(out);
    else toast('Hold a little longer to record a voice message.');
  };
  const cancel = () => {
    if (intent.current) intent.current = 'cancelled';
    recRef.current?.cancel();
    recRef.current = null;
    setRec(null);
  };
  const lock = () => {
    if (modeRef.current === 'locked') return;
    if (intent.current === 'hold') intent.current = 'lock';
    setMode('locked');
    setSlide(0);
    navigator.vibrate?.(10);
  };

  // Touch: hold to record, release to send, slide left to lock.
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    startX.current = e.clientX;
    setSlide(0);
    void begin('hold');
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch' || modeRef.current === 'locked' || !(recRef.current || intent.current === 'hold')) return;
    const dx = Math.min(0, e.clientX - startX.current);
    if (dx < -LOCK_DISTANCE) lock();
    else setSlide(dx);
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (intent.current === 'hold') intent.current = 'released';
    else if (recRef.current && modeRef.current === 'hold') void finish(recRef.current);
  };
  const onPointerCancel = () => {
    if (modeRef.current !== 'locked') cancel();
  };

  if (!rec)
    return (
      <button
        type="button"
        data-tip="Record a voice message"
        aria-label="Record a voice message"
        disabled={disabled}
        className="ae-press grid h-8 w-8 touch-none place-items-center rounded-full text-ae-muted select-none hover:bg-ae-hover hover:text-ae-text disabled:opacity-40"
        onClick={(e) => (e.nativeEvent as PointerEvent).pointerType !== 'touch' && void begin('lock')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <MicIcon size={18} />
      </button>
    );

  const locked = mode === 'locked';
  return (
    <div
      className="ae-enter absolute inset-0 z-20 flex touch-none items-center gap-3 rounded-[inherit] bg-ae-elevated px-3"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {locked && (
        <button type="button" aria-label="Delete recording" className="grid h-9 w-9 place-items-center rounded-full text-ae-muted hover:bg-ae-hover hover:text-ae-danger" onClick={cancel}>
          <TrashIcon size={18} />
        </button>
      )}
      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-ae-danger" />
      <span className="w-10 shrink-0 text-sm font-semibold tabular-nums">{fmt(seconds)}</span>
      <div className="flex h-7 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
        {bars.map((b, i) => (
          <span key={i} className="w-[3px] shrink-0 rounded-full bg-ae-accent transition-[height] duration-100" style={{ height: `${Math.max(12, b * 100)}%` }} />
        ))}
      </div>
      {locked ? (
        <button type="button" aria-label="Send voice message" className="ae-press grid h-10 w-10 place-items-center rounded-full bg-ae-accent text-ae-on-accent" onClick={() => void finish()}>
          <SendIcon size={17} />
        </button>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-ae-muted" style={{ transform: `translateX(${slide / 2}px)`, opacity: 1 - Math.min(0.6, -slide / LOCK_DISTANCE) }}>
          <LockIcon size={13} /> ‹ Slide to lock · release to send
        </span>
      )}
    </div>
  );
}

/** A voice message in chat: play/pause, a waveform you can tap to seek, and the time. */
/** "Transcript" under a voice message: Whisper on this device (lib/transcribe.ts). */
function Transcript({ url }: { url: string }) {
  const [state, setState] = useState<{ s: 'idle' } | { s: 'busy'; p: number | null } | { s: 'done'; text: string } | { s: 'error'; msg: string }>({ s: 'idle' });
  const run = () => {
    setState({ s: 'busy', p: null });
    const lang = currentLanguage().slice(0, 2).toLowerCase();
    transcribe(url, /^[a-z]{2}$/.test(lang) ? lang : undefined, (p) => setState({ s: 'busy', p }))
      .then((text) => setState({ s: 'done', text }))
      .catch((e: Error) => setState({ s: 'error', msg: e.message }));
  };
  if (state.s === 'idle')
    return (
      <button type="button" onClick={run} className="mt-1 text-xs font-semibold text-ae-muted hover:text-ae-text hover:underline">
        {t('Show transcript')}
      </button>
    );
  if (state.s === 'busy')
    return (
      <p className="mt-1 text-xs text-ae-muted" role="status">
        {state.p !== null && state.p < 1 ? t('Getting transcription ready on this device… {n}%', { n: Math.round(state.p * 100) }) : t('Transcribing…')}
      </p>
    );
  if (state.s === 'error')
    return (
      <p className="mt-1 text-xs text-ae-danger">
        {t('Couldn’t transcribe this.')}{' '}
        <button type="button" onClick={run} className="underline">
          {t('Try again')}
        </button>
      </p>
    );
  return <p className="mt-1 max-w-[300px] text-sm whitespace-pre-wrap text-ae-text/90 italic">{state.text || t('(No speech found)')}</p>;
}

export function VoiceMessagePlayer({ a }: { a: VoiceAttachment }) {
  return (
    <div>
      <VoicePlayerBar a={a} />
      <Transcript url={a.url} />
    </div>
  );
}

function VoicePlayerBar({ a }: { a: VoiceAttachment }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [speed, setSpeed] = useState(1);
  const duration = a.duration ?? 0;
  const wave = a.waveform?.length ? a.waveform : Array.from({ length: BARS }, (_, i) => 30 + ((i * 37) % 50));
  const progress = duration ? pos / duration : 0;

  return (
    <div className="flex w-[300px] max-w-full items-center gap-3 rounded-2xl border border-ae-border bg-ae-sunken px-3 py-2">
      <audio
        ref={audio}
        src={a.url}
        preload="metadata"
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => (setPlaying(false), setPos(0))}
      />
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play voice message'}
        className="ae-press grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ae-accent text-ae-on-accent"
        onClick={() => {
          const el = audio.current;
          if (!el) return;
          if (el.paused) {
            // Only one voice message plays at a time.
            document.querySelectorAll('audio').forEach((x) => x !== el && x.pause());
            void el.play();
          } else el.pause();
        }}
      >
        {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} className="translate-x-[1px]" />}
      </button>
      <div
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[1.5px] overflow-hidden"
        role="slider"
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(pos)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const el = audio.current;
          if (!el || !duration) return;
          el.currentTime = ((e.clientX - r.left) / r.width) * duration;
          setPos(el.currentTime);
        }}
      >
        {wave.map((h, i) => (
          <span
            key={i}
            className={`min-w-px flex-1 rounded-full transition-colors ${i / wave.length < progress ? 'bg-ae-accent' : 'bg-ae-text/30'}`}
            style={{ height: `${Math.max(10, h)}%` }}
          />
        ))}
      </div>
      <span className="w-9 shrink-0 text-right text-xs text-ae-muted tabular-nums">{fmt(playing || pos ? pos : duration)}</span>
      <button
        type="button"
        aria-label="Playback speed"
        className="shrink-0 rounded-md bg-ae-surface px-1.5 py-0.5 text-[11px] font-bold text-ae-muted hover:text-ae-text"
        onClick={() => {
          const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
          setSpeed(next);
          if (audio.current) audio.current.playbackRate = next;
        }}
      >
        {speed}×
      </button>
    </div>
  );
}
