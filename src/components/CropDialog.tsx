/**
 * Crop & zoom an avatar or banner. Saves a focus point and zoom (users.decor.avatarCrop /
 * bannerCrop) instead of re-encoding the image, so GIFs stay animated and nothing loses quality.
 */
import { useRef, useState } from 'react';
import type { Crop } from '../lib/cosmetics';
import { Dialog } from './Dialog';
import { cropStyle } from './ProfileCard';
import { MinusIcon, PlusIcon } from './icons';

export function CropDialog({ url, kind, value, onSave, onClose }: { url: string; kind: 'avatar' | 'banner'; value?: Crop; onSave: (c: Crop | undefined) => void; onClose: () => void }) {
  const [c, setC] = useState<Crop>(value ?? { x: 50, y: 50, z: 1 });
  const frame = useRef<HTMLDivElement>(null);
  const box = kind === 'avatar' ? 'h-64 w-64 rounded-full' : 'h-40 w-full max-w-[520px] rounded-ae';
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

  const drag = (e: React.PointerEvent) => {
    const el = frame.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, c };
    const move = (ev: PointerEvent) => {
      // Dragging the picture right shows more of its left side, so the focus point moves left.
      const dx = ((ev.clientX - start.x) / rect.width) * 100;
      const dy = ((ev.clientY - start.y) / rect.height) * 100;
      setC({ ...start.c, x: clamp(start.c.x - dx / start.c.z, 0, 100), y: clamp(start.c.y - dy / start.c.z, 0, 100) });
    };
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <Dialog wide title={kind === 'avatar' ? 'Adjust avatar' : 'Adjust banner'} onClose={onClose}>
      <p className="text-sm text-ae-muted">Drag to move, scroll or use the slider to zoom. GIFs keep animating.</p>
      <div className="grid place-items-center rounded-ae bg-ae-sunken p-6">
        <div
          ref={frame}
          className={`relative cursor-grab touch-none overflow-hidden border-2 border-white/70 shadow-[0_0_0_9999px_#0007] active:cursor-grabbing ${box}`}
          onPointerDown={drag}
          onWheel={(e) => setC((cur) => ({ ...cur, z: clamp(cur.z - e.deltaY * 0.0015, 1, 4) }))}
        >
          <img src={url} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover select-none" style={cropStyle(c)} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Zoom out" className="text-ae-muted hover:text-ae-text" onClick={() => setC((cur) => ({ ...cur, z: clamp(cur.z - 0.1, 1, 4) }))}>
          <MinusIcon size={16} />
        </button>
        <input type="range" className="flex-1" min={1} max={4} step={0.01} value={c.z} onChange={(e) => setC((cur) => ({ ...cur, z: Number(e.target.value) }))} aria-label="Zoom" />
        <button type="button" aria-label="Zoom in" className="text-ae-muted hover:text-ae-text" onClick={() => setC((cur) => ({ ...cur, z: clamp(cur.z + 0.1, 1, 4) }))}>
          <PlusIcon size={16} />
        </button>
        <span className="w-12 text-right text-xs text-ae-muted tabular-nums">{c.z.toFixed(1)}×</span>
      </div>
      <div className="flex justify-between gap-2">
        <button type="button" className="rounded-ae px-3 py-2 text-sm text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={() => setC({ x: 50, y: 50, z: 1 })}>
          Reset
        </button>
        <div className="flex gap-2">
          <button type="button" className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ae-press rounded-ae bg-ae-accent px-5 py-2 text-sm font-semibold text-ae-on-accent"
            onClick={() => {
              onSave(c.x === 50 && c.y === 50 && c.z === 1 ? undefined : { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, z: Math.round(c.z * 100) / 100 });
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
}
