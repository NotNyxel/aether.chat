/**
 * RNNoise (a small recurrent neural network trained to remove background noise) running as an
 * AudioWorklet, via @sapphi-red/web-noise-suppressor. Everything runs locally; the WASM and worklet
 * are bundled with the app and loaded on first use. Needs a 48 kHz AudioContext.
 */
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

let wasm: Promise<ArrayBuffer> | null = null;
const loadedContexts = new WeakSet<BaseAudioContext>();

export interface Denoiser {
  node: AudioNode;
  destroy: () => void;
}

export async function createDenoiser(ctx: AudioContext): Promise<Denoiser> {
  wasm ??= loadRnnoise({ url: wasmUrl, simdUrl }).catch((e: unknown) => {
    wasm = null;
    throw e;
  });
  const binary = await wasm;
  if (!loadedContexts.has(ctx)) {
    await ctx.audioWorklet.addModule(workletUrl);
    loadedContexts.add(ctx);
  }
  const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary });
  return {
    node,
    destroy: () => {
      node.disconnect();
      node.destroy();
    },
  };
}
