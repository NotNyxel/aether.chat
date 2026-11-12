/**
 * Native screen sharing for the Windows app (see src-tauri/src/capture.rs). Replaces WebView2's
 * own chooser: we list screens and windows ourselves, then turn the JPEG frames and PCM audio the
 * app streams to us into a normal MediaStream (canvas video track + AudioWorklet audio track) that
 * goes into the call like any other screen share.
 */
import { isTauri } from './platform';

export interface CaptureSource {
  id: string;
  kind: 'screen' | 'window';
  name: string;
  app: string | null;
  width: number;
  height: number;
  thumbnail: string | null;
}

export const nativeCaptureAvailable = isTauri && /Windows/i.test(navigator.userAgent);

export async function listCaptureSources(thumbnails = true): Promise<CaptureSource[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CaptureSource[]>('capture_sources', { thumbnails });
}

export interface NativeCaptureOptions {
  source: string;
  maxWidth: number;
  maxHeight: number;
  fps: number;
  cursor?: boolean;
  audio: boolean;
}

export async function startNativeCapture(o: NativeCaptureOptions): Promise<MediaStream> {
  const { invoke, Channel } = await import('@tauri-apps/api/core');

  const canvas = document.createElement('canvas');
  const ctx2d = canvas.getContext('2d', { alpha: false, desynchronized: true })!;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  let ended = false;
  let decoding = 0;
  let audioCtx: AudioContext | null = null;

  const cleanup = () => {
    if (ended) return;
    ended = true;
    void invoke('capture_stop').catch(() => undefined);
    void audioCtx?.close().catch(() => undefined);
    for (const t of stream.getTracks()) if (t.readyState === 'live') nativeStop.get(t)?.call(t);
  };

  const video = new Channel<ArrayBuffer>((buf) => {
    if (ended) return;
    if (!buf || buf.byteLength === 0) {
      // The shared window was closed: end the share like the browser's "Stop sharing" would.
      cleanup();
      track.dispatchEvent(new Event('ended'));
      return;
    }
    if (decoding > 1) return; // keep latency low: drop a frame rather than queue it
    decoding++;
    void createImageBitmap(new Blob([buf], { type: 'image/jpeg' }))
      .then((bmp) => {
        if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
          canvas.width = bmp.width;
          canvas.height = bmp.height;
        }
        ctx2d.drawImage(bmp, 0, 0);
        bmp.close();
        track.requestFrame();
      })
      .catch(() => undefined)
      .finally(() => decoding--);
  });

  let pushAudio: ((buf: ArrayBuffer) => void) | null = null;
  const sound = new Channel<ArrayBuffer>((buf) => pushAudio?.(buf));

  const started = await invoke<{ width: number; height: number; audio: boolean }>('capture_start', {
    source: o.source,
    maxWidth: o.maxWidth,
    maxHeight: o.maxHeight,
    fps: o.fps,
    cursor: o.cursor ?? true,
    audio: o.audio,
    video,
    sound,
  });
  canvas.width = started.width;
  canvas.height = started.height;

  if (started.audio) {
    try {
      audioCtx = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
      await audioCtx.audioWorklet.addModule('/capture-audio.worklet.js');
      const node = new AudioWorkletNode(audioCtx, 'aether-pcm', { numberOfInputs: 0, outputChannelCount: [2] });
      const dest = audioCtx.createMediaStreamDestination();
      node.connect(dest);
      pushAudio = (buf) => node.port.postMessage(buf, [buf]);
      const [audioTrack] = dest.stream.getAudioTracks();
      if (audioTrack) stream.addTrack(audioTrack);
    } catch {
      // No audio: the video share still works.
    }
  }

  // Stopping any track (our UI's "Stop sharing") stops the native capture too.
  for (const t of stream.getTracks()) {
    nativeStop.set(t, t.stop);
    t.stop = function stop() {
      nativeStop.get(this)?.call(this);
      cleanup();
    };
  }
  return stream;
}

const nativeStop = new WeakMap<MediaStreamTrack, () => void>();
