// Plays 48 kHz interleaved stereo f32 chunks posted from the main thread (native screen-share
// audio from the Windows app) into the audio graph, with a small jitter buffer.
class AetherPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.buffered = 0;
    this.started = false;
    this.port.onmessage = (e) => {
      const chunk = new Float32Array(e.data);
      this.queue.push(chunk);
      this.buffered += chunk.length / 2;
      // Cap latency at ~200 ms: drop the oldest audio if we fall behind.
      while (this.buffered > 9600 && this.queue.length > 1) {
        const old = this.queue.shift();
        this.buffered -= (old.length - this.offset) / 2;
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    // Wait for ~40 ms of audio before starting, so small gaps don't click.
    if (!this.started) {
      if (this.buffered < 1920) return true;
      this.started = true;
    }
    for (let i = 0; i < left.length; i++) {
      const chunk = this.queue[0];
      if (!chunk) {
        left[i] = right[i] = 0;
        continue;
      }
      left[i] = chunk[this.offset];
      right[i] = chunk[this.offset + 1];
      this.offset += 2;
      this.buffered--;
      if (this.offset >= chunk.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    if (this.queue.length === 0) this.started = false;
    return true;
  }
}

registerProcessor('aether-pcm', AetherPcm);
