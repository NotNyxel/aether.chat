/**
 * Turns a picture into a GIF (for "Save as GIF" in the image viewer). Big pictures are scaled down
 * to at most 480px on the long side, which keeps GIFs small and quick to send.
 */
// gifenc has no type definitions of its own.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { applyPalette, GIFEncoder, quantize } from 'gifenc';

const MAX = 480;

export async function imageToGif(url: string): Promise<{ file: File; width: number; height: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download the picture.');
  const bmp = await createImageBitmap(await res.blob());
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const { data } = ctx.getImageData(0, 0, width, height);
  const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
  const index = applyPalette(data, palette, 'rgba4444');
  const gif = GIFEncoder();
  gif.writeFrame(index, width, height, { palette, transparent: true });
  gif.finish();
  const bytes = new Uint8Array(gif.bytes() as Uint8Array);
  return { file: new File([bytes.buffer as ArrayBuffer], `aether-${Date.now()}.gif`, { type: 'image/gif' }), width, height };
}
