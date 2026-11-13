/**
 * Voice messages: record from the message box, send as an audio attachment with its length and a
 * small waveform, and play back in chat with a scrubbable waveform.
 *   - Phones: press and hold the mic, let go to send; slide left to cancel.
 *   - Computers: click the mic to start, then Send or the bin to discard.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Attachment } from '../types/db';
import { MicIcon, PauseIcon, PlayIcon, SendIcon, TrashIcon } from './icons';
import { toast } from './Toaster';

const MAX_SECONDS = 300;
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
  const cleanup = () => {
    clearInterval(sampler);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
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
        rec.onstop = () => {
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
        rec.stop();
      }),
  };
}

/**
 * The mic button and, while recording, the recording bar. `onSend` gets the file and its details;
 * the caller uploads and sends it.
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
  const [seconds, setSeconds] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const [held, setHeld] = useState(false);
  const [slide, setSlide] = useState(0);
  const startX = useRef(0);

  useEffect(() => onRecordingChange(!!rec), [rec, onRecordingChange]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec]);

  const begin = async () => {
    if (rec || disabled) return;
    try {
      const r = await startRecording();
      setSeconds(0);
      setBars([]);
      setRec(r);
      navigator.vibrate?.(15);
    } catch (e) {
      toast.error(e instanceof Error && e.name === 'NotAllowedError' ? 'Aether needs microphone access to record voice messages.' : 'Could not start recording.');
    }
  };
  const finish = async (r: Recording | null = rec) => {
    if (!r) return;
    setRec(null);
    const out = await r.stop();
    if (out) onSend(out);
    else toast('Hold a little longer to record a voice message.');
  };
  const cancel = () => {
    rec?.cancel();
    setRec(null);
  };

  // Touch: hold to record, release to send, slide left to cancel.
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    startX.current = e.clientX;
    setHeld(true);
    setSlide(0);
    void begin();
  };
  const onPointerMove = (e: ReactPointerEvent) => held && setSlide(Math.min(0, e.clientX - startX.current));
  const onPointerUp = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch' || !held) return;
    setHeld(false);
    if (slide < -90) cancel();
    else void finish();
  };

  if (!rec)
    return (
      <button
        type="button"
        data-tip="Record a voice message"
        aria-label="Record a voice message"
        disabled={disabled}
        className="ae-press grid h-8 w-8 touch-none place-items-center rounded-full text-ae-muted select-none hover:bg-ae-hover hover:text-ae-text disabled:opacity-40"
        onClick={(e) => (e.nativeEvent as PointerEvent).pointerType !== 'touch' && void begin()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (setHeld(false), cancel())}
        onContextMenu={(e) => e.preventDefault()}
      >
        <MicIcon size={18} />
      </button>
    );

  return (
    <div
      className="absolute inset-0 z-20 flex items-center gap-3 rounded-[inherit] bg-ae-elevated px-3"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ transform: held ? `translateX(${slide / 3}px)` : undefined }}
    >
      {!held && (
        <button type="button" aria-label="Discard recording" className="grid h-8 w-8 place-items-center rounded-full text-ae-muted hover:bg-ae-hover hover:text-ae-danger" onClick={cancel}>
          <TrashIcon size={17} />
        </button>
      )}
      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-ae-danger" />
      <span className="w-10 shrink-0 text-sm font-semibold tabular-nums">{fmt(seconds)}</span>
      <div className="flex h-7 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
        {bars.map((b, i) => (
          <span key={i} className="w-[3px] shrink-0 rounded-full bg-ae-accent" style={{ height: `${Math.max(12, b * 100)}%` }} />
        ))}
      </div>
      {held ? (
        <span className={`shrink-0 text-xs ${slide < -90 ? 'text-ae-danger' : 'text-ae-muted'}`}>{slide < -90 ? 'Release to cancel' : '‹ Slide to cancel'}</span>
      ) : (
        <button type="button" aria-label="Send voice message" className="ae-press grid h-9 w-9 place-items-center rounded-full bg-ae-accent text-ae-on-accent" onClick={() => void finish()}>
          <SendIcon size={16} />
        </button>
      )}
    </div>
  );
}

/** A voice message in chat: play/pause, a waveform you can tap to seek, and the time. */
export function VoiceMessagePlayer({ a }: { a: VoiceAttachment }) {
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
