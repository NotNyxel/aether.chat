/**
 * On-device transcription and translation (2.1). Nothing is sent to a server.
 *
 * Translation uses the browser's built-in Translator (Chrome) when it's there, for any pair of
 * languages it supports; otherwise, translating into English runs a small model in our worker
 * (ml.worker.ts). Other targets without the built-in Translator aren't available.
 */
import type { WorkerIn, WorkerOut } from './ml.worker';

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void; onProgress?: (p: number) => void }>();

type Job = WorkerIn extends infer J ? (J extends WorkerIn ? Omit<J, 'id'> : never) : never;

function run(job: Job, onProgress?: (p: number) => void): Promise<string> {
  if (!worker) {
    worker = new Worker(new URL('./ml.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      if (e.data.progress !== undefined) return w.onProgress?.(e.data.progress);
      waiting.delete(e.data.id);
      if (e.data.error !== undefined) w.reject(new Error(e.data.error));
      else w.resolve(e.data.text ?? '');
    };
    worker.onerror = (e) => {
      for (const w of waiting.values()) w.reject(new Error(e.message || 'Stopped.'));
      waiting.clear();
      worker = null;
    };
  }
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    waiting.set(id, { resolve, reject, onProgress });
    worker!.postMessage({ ...job, id } as WorkerIn, job.task === 'asr' ? [job.audio.buffer] : []);
  });
}

// ── Transcription ──────────────────────────────────────────────────────────────────────────────

/** Whisper wants 16 kHz mono. */
async function decode(url: string): Promise<Float32Array> {
  const buf = await (await fetch(url)).arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(buf);
    if (audio.numberOfChannels === 1) return audio.getChannelData(0);
    const a = audio.getChannelData(0);
    const b = audio.getChannelData(1);
    const mono = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) mono[i] = (a[i]! + b[i]!) / 2;
    return mono;
  } finally {
    void ctx.close();
  }
}

const transcripts = new Map<string, Promise<string>>();

/** language: the speaker's language code (Whisper assumes English otherwise). Cached per audio URL. */
export function transcribe(url: string, language?: string, onProgress?: (p: number) => void): Promise<string> {
  const hit = transcripts.get(url);
  if (hit) return hit;
  const job = decode(url).then((audio) => run({ task: 'asr', audio, language }, onProgress));
  transcripts.set(url, job);
  job.catch(() => transcripts.delete(url));
  return job;
}

// ── Translation ────────────────────────────────────────────────────────────────────────────────

interface BuiltInTranslator {
  translate(text: string): Promise<string>;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(o: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<BuiltInTranslator>;
}
interface DetectorStatic {
  create(): Promise<{ detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]> }>;
}
const g = globalThis as unknown as { Translator?: TranslatorStatic; LanguageDetector?: DetectorStatic };

let detector: ReturnType<DetectorStatic['create']> | null = null;
async function detect(text: string): Promise<string | null> {
  if (!g.LanguageDetector) return null;
  try {
    detector ??= g.LanguageDetector.create();
    const best = (await (await detector).detect(text))[0];
    return best && best.confidence > 0.5 && best.detectedLanguage !== 'und' ? best.detectedLanguage : null;
  } catch {
    detector = null;
    return null;
  }
}

const translators = new Map<string, Promise<BuiltInTranslator>>();

export const SAME_LANGUAGE = 'same-language';

/** Can we translate into this language here at all? */
export function canTranslateTo(target: string): boolean {
  return !!g.Translator || target === 'en';
}

/**
 * Translate a message into `target` (a language code such as 'en'). Throws SAME_LANGUAGE when it's
 * already in that language.
 */
export async function translate(text: string, target: string, onProgress?: (p: number) => void): Promise<string> {
  const source = await detect(text);
  if (source && source.split('-')[0] === target) throw new Error(SAME_LANGUAGE);
  if (g.Translator && source) {
    const pair = { sourceLanguage: source, targetLanguage: target };
    if ((await g.Translator.availability(pair)) !== 'unavailable') {
      const key = `${source}>${target}`;
      let tr = translators.get(key);
      if (!tr) {
        tr = g.Translator.create({
          ...pair,
          monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress?.((e as unknown as { loaded: number }).loaded)),
        });
        translators.set(key, tr);
        tr.catch(() => translators.delete(key));
      }
      return (await tr).translate(text);
    }
  }
  if (target === 'en') return run({ task: 'to-english', text }, onProgress);
  throw new Error('Translation into this language isn’t available on this device yet.');
}
