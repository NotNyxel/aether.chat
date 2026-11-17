/**
 * On-device AI worker (2.1): voice transcription (Whisper) and a translation fallback (OPUS-MT,
 * any language → English) via transformers.js + ONNX Runtime WebAssembly. Nothing you transcribe
 * or translate leaves the device, so it works for encrypted chats too. The runtime's script is
 * bundled with the app; only its .wasm binary (jsDelivr's npm mirror, pinned to the bundled version)
 * and the model weights (Hugging Face) download, once, on first use, and the browser caches them.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline, type TranslationPipeline } from '@huggingface/transformers';

const ASR_MODEL = 'onnx-community/whisper-base';
const TO_ENGLISH_MODEL = 'Xenova/opus-mt-mul-en';

env.allowLocalModels = false;
// Load the runtime from the bundle, not as a blob/CDN script (our CSP allows neither).
env.useWasmCache = false;
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number; proxy?: boolean }; versions?: { web?: string } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${onnx.versions?.web ?? '1.22.0'}/dist/`;
  onnx.wasm.numThreads = 1;
  onnx.wasm.proxy = false;
}

export type WorkerIn = { id: number; task: 'asr'; audio: Float32Array; language?: string } | { id: number; task: 'to-english'; text: string };
export type WorkerOut = { id: number; progress?: number; text?: string; error?: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

/** Download progress across a model's files, reported to the job that's waiting. */
function progressFor(id: number) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let l = 0;
    let t = 0;
    for (const f of files.values()) {
      l += f.loaded;
      t += f.total;
    }
    if (t) post({ id, progress: l / t });
  };
}

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let toEnglish: Promise<TranslationPipeline> | null = null;

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const job = e.data;
  try {
    if (job.task === 'asr') {
      asr ??= pipeline('automatic-speech-recognition', ASR_MODEL, { dtype: 'q8', device: 'wasm', progress_callback: progressFor(job.id) }) as Promise<AutomaticSpeechRecognitionPipeline>;
      const run = await asr;
      const out = await run(job.audio, { chunk_length_s: 30, stride_length_s: 5, ...(job.language ? { language: job.language } : {}), task: 'transcribe' });
      post({ id: job.id, text: (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim() });
    } else {
      toEnglish ??= pipeline('translation', TO_ENGLISH_MODEL, { dtype: 'q8', device: 'wasm', progress_callback: progressFor(job.id) }) as Promise<TranslationPipeline>;
      const run = await toEnglish;
      // Sentence by sentence keeps long messages inside the model's window.
      const parts = job.text.split(/(?<=[.!?。！？])\s+|\n+/).filter((s) => s.trim());
      const out: string[] = [];
      for (const p of parts) {
        const r = (await run(p.trim(), { max_new_tokens: 256 })) as { translation_text: string }[];
        out.push(r[0]?.translation_text ?? '');
      }
      post({ id: job.id, text: out.join(' ').trim() });
    }
  } catch (err) {
    if (job.task === 'asr') asr = null;
    else toEnglish = null;
    post({ id: job.id, error: err instanceof Error ? err.message : String(err) });
  }
};
