/** Themed audio and video players (no browser media controls anywhere). */
import { useEffect, useRef, useState } from 'react';
import { AudioFileIcon, FullscreenIcon, PauseIcon, PlayIcon, PopOutIcon, VolumeIcon } from './icons';

function fmt(t: number) {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  return `${m}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

function useMedia(ref: React.RefObject<HTMLMediaElement | null>) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      setPlaying(!el.paused);
      setTime(el.currentTime);
      setDuration(el.duration || 0);
      setVolume(el.muted ? 0 : el.volume);
    };
    const evs = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'volumechange', 'ended'];
    evs.forEach((ev) => el.addEventListener(ev, sync));
    return () => evs.forEach((ev) => el.removeEventListener(ev, sync));
  }, [ref]);
  return {
    playing,
    time,
    duration,
    volume,
    toggle: () => {
      const el = ref.current;
      if (el) void (el.paused ? el.play() : el.pause());
    },
    seek: (t: number) => ref.current && (ref.current.currentTime = t),
    setVol: (v: number) => {
      if (!ref.current) return;
      ref.current.volume = v;
      ref.current.muted = v === 0;
    },
  };
}

function Controls({ m, extra }: { m: ReturnType<typeof useMedia>; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <button type="button" aria-label={m.playing ? 'Pause' : 'Play'} onClick={m.toggle} className="ae-press grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ae-accent text-ae-on-accent">
        {m.playing ? <PauseIcon size={15} fill="currentColor" /> : <PlayIcon size={15} fill="currentColor" className="ml-0.5" />}
      </button>
      <span className="w-20 shrink-0 text-[11px] text-ae-muted tabular-nums">
        {fmt(m.time)} / {fmt(m.duration)}
      </span>
      <input type="range" min={0} max={m.duration || 0} step={0.1} value={m.time} onChange={(e) => m.seek(Number(e.target.value))} className="min-w-0 flex-1" aria-label="Seek" />
      <VolumeIcon size={15} className="shrink-0 text-ae-muted" />
      <input type="range" min={0} max={1} step={0.05} value={m.volume} onChange={(e) => m.setVol(Number(e.target.value))} className="w-16" aria-label="Volume" />
      {extra}
    </div>
  );
}

export function AudioPlayer({ src, name }: { src: string; name: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const m = useMedia(ref);
  return (
    <div className="w-[min(26rem,100%)] space-y-2 rounded-ae border border-ae-border bg-ae-sunken p-3">
      <div className="flex items-center gap-2">
        <AudioFileIcon size={18} className="text-ae-accent" />
        <a href={src} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold text-ae-accent hover:underline">
          {name}
        </a>
      </div>
      <Controls m={m} />
      <audio ref={ref} src={src} preload="metadata" />
    </div>
  );
}

export function VideoPlayer({ src, label }: { src: string; label?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const m = useMedia(ref);
  return (
    <div ref={box} className="group relative w-[min(28rem,100%)] overflow-hidden rounded-ae border border-ae-border bg-black">
      <video ref={ref} src={src} preload="metadata" playsInline onClick={m.toggle} className="max-h-80 w-full cursor-pointer object-contain" aria-label={label} />
      {!m.playing && (
        <button type="button" aria-label="Play" onClick={m.toggle} className="absolute inset-0 grid place-items-center bg-black/25">
          <span className="ae-press grid h-14 w-14 place-items-center rounded-full bg-black/60 text-white backdrop-blur">
            <PlayIcon size={26} fill="currentColor" className="ml-1" />
          </span>
        </button>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pt-6 pb-2 text-white opacity-0 transition-opacity group-hover:opacity-100">
        <Controls
          m={m}
          extra={
            <>
              {'requestPictureInPicture' in HTMLVideoElement.prototype && (
                <button type="button" aria-label="Pop out" onClick={() => void ref.current?.requestPictureInPicture().catch(() => undefined)} className="text-white/80 hover:text-white">
                  <PopOutIcon size={15} />
                </button>
              )}
              <button type="button" aria-label="Fullscreen" onClick={() => void box.current?.requestFullscreen().catch(() => undefined)} className="text-white/80 hover:text-white">
                <FullscreenIcon size={15} />
              </button>
            </>
          }
        />
      </div>
    </div>
  );
}
