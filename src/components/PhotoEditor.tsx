/**
 * Photo editor (2.1): crop, rotate/flip, filters and adjustments, drawing and text, before a photo
 * is sent or shared as a moment. Everything happens on this device in a canvas; the result is a
 * new file (the original metadata, like location, is dropped with it).
 *
 * Coordinates: everything (crop, strokes, text) is stored normalised (0..1) against the rotated /
 * flipped image, so rotating moves your edits with the photo.
 */
import { applyCssFilter, canvasFilterWorks } from '../lib/momentArt';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { t } from '../lib/i18n';
import { BrushIcon, CloseIcon, CutIcon, FontIcon, RedoIcon, SlidersIcon, UndoIcon } from './icons';
import { toast } from './Toaster';

type Pt = { x: number; y: number };
type Stroke = { kind: 'stroke'; color: string; size: number; pts: Pt[] };
type Text = { kind: 'text'; color: string; size: number; at: Pt; text: string };
type Mark = Stroke | Text;
type Rect = { x: number; y: number; w: number; h: number };
type Tool = 'adjust' | 'crop' | 'draw' | 'text';

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
const COLORS = ['#ffffff', '#111111', '#ff4d4f', '#ffb020', '#3ddc84', '#3b82f6', '#a855f7', '#ff6fb5'];

const FILTERS: { id: string; label: string; css: string }[] = [
  { id: 'none', label: 'Original', css: '' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.45) contrast(1.08)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.25) saturate(1.2) hue-rotate(-8deg)' },
  { id: 'cool', label: 'Cool', css: 'saturate(1.1) hue-rotate(12deg) brightness(1.03)' },
  { id: 'fade', label: 'Fade', css: 'contrast(0.85) brightness(1.08) saturate(0.8)' },
  { id: 'mono', label: 'Mono', css: 'grayscale(1)' },
  { id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.4) brightness(0.92)' },
  { id: 'retro', label: 'Retro', css: 'sepia(0.55) contrast(1.1) saturate(0.9)' },
];

const ASPECTS: { label: string; r: number | null }[] = [
  { label: 'Free', r: null },
  { label: '1:1', r: 1 },
  { label: '4:5', r: 4 / 5 },
  { label: '9:16', r: 9 / 16 },
  { label: '16:9', r: 16 / 9 },
];

/** Rotate a normalised point 90° clockwise / flip it horizontally. */
const rot = (p: Pt): Pt => ({ x: 1 - p.y, y: p.x });
const rotRect = (r: Rect): Rect => ({ x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w });
const flipPt = (p: Pt): Pt => ({ x: 1 - p.x, y: p.y });
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function PhotoEditor({ file, onDone, onCancel }: { file: Blob & { name?: string }; onDone: (f: File) => void; onCancel: () => void }) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [turns, setTurns] = useState(0); // quarter turns clockwise
  const [flipped, setFlipped] = useState(false);
  const [crop, setCrop] = useState<Rect>(FULL);
  const [filter, setFilter] = useState('none');
  const [adj, setAdj] = useState({ brightness: 100, contrast: 100, saturation: 100 });
  const [marks, setMarks] = useState<Mark[]>([]);
  const [redo, setRedo] = useState<Mark[]>([]);
  const [tool, setTool] = useState<Tool>('adjust');
  const [color, setColor] = useState(COLORS[2]!);
  const [size, setSize] = useState(6);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ start: Pt; stroke?: Stroke } | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [textAt, setTextAt] = useState<Pt | null>(null);
  const [textDraft, setTextDraft] = useState('');

  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    let gone = false;
    createImageBitmap(file)
      .then((b) => !gone && setBitmap(b))
      .catch(() => {
        toast.error(t('This image can’t be edited.'));
        cancelRef.current();
      });
    return () => {
      gone = true;
    };
  }, [file]);

  // The rotated/flipped photo, rebuilt only when orientation changes.
  const oriented = useMemo(() => {
    if (!bitmap) return null;
    const side = turns % 2 === 1;
    const c = document.createElement('canvas');
    c.width = side ? bitmap.height : bitmap.width;
    c.height = side ? bitmap.width : bitmap.height;
    const ctx = c.getContext('2d')!;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((turns * Math.PI) / 2);
    if (flipped) ctx.scale(-1, 1);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    return c;
  }, [bitmap, turns, flipped]);

  const filterCss = `${FILTERS.find((f) => f.id === filter)?.css ?? ''} brightness(${adj.brightness / 100}) contrast(${adj.contrast / 100}) saturate(${adj.saturation / 100})`.trim();

  /** Draw the edited photo at a given longest side. In crop mode, the whole photo with the crop box. */
  const paint = (target: HTMLCanvasElement, maxSide: number, showWhole: boolean, exporting = false) => {
    if (!oriented) return;
    const r = showWhole ? FULL : crop;
    const sw = oriented.width * r.w;
    const sh = oriented.height * r.h;
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    target.width = Math.max(1, Math.round(sw * k));
    target.height = Math.max(1, Math.round(sh * k));
    const ctx = target.getContext('2d')!;
    ctx.save();
    const native = canvasFilterWorks();
    if (native) ctx.filter = filterCss || 'none';
    ctx.drawImage(oriented, oriented.width * r.x, oriented.height * r.y, sw, sh, 0, 0, target.width, target.height);
    ctx.restore();
    // iPhone/iPad Safari ignores ctx.filter: apply the same colour change pixel by pixel.
    // (The live preview uses a CSS filter on the canvas instead; this runs only when saving.)
    if (!native && exporting && filterCss) applyCssFilter(ctx, filterCss, target.width, target.height);
    // Marks are in whole-photo coordinates; map them into this view.
    const map = (p: Pt) => ({ x: ((p.x - r.x) / r.w) * target.width, y: ((p.y - r.y) / r.h) * target.height });
    const unit = (oriented.width * k) / 400; // size 1 = 1/400 of the photo's width
    for (const m of marks) {
      ctx.fillStyle = m.color;
      ctx.strokeStyle = m.color;
      if (m.kind === 'stroke') {
        ctx.lineWidth = m.size * unit;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        m.pts.forEach((p, i) => {
          const q = map(p);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        if (m.pts.length === 1) {
          const q = map(m.pts[0]!);
          ctx.lineTo(q.x + 0.1, q.y);
        }
        ctx.stroke();
      } else {
        const q = map(m.at);
        ctx.font = `800 ${m.size * unit * 5}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, m.size * unit * 0.6);
        ctx.strokeStyle = m.color === '#111111' ? '#ffffff' : '#000000';
        ctx.strokeText(m.text, q.x, q.y);
        ctx.fillText(m.text, q.x, q.y);
      }
    }
    if (showWhole) {
      const c = cropDraft ?? crop;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const [x, y, w, h] = [c.x * target.width, c.y * target.height, c.w * target.width, c.h * target.height];
      ctx.fillRect(0, 0, target.width, y);
      ctx.fillRect(0, y + h, target.width, target.height - y - h);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, target.width - x - w, h);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(x, y, w, h);
    }
  };

  useEffect(() => {
    if (canvas.current) paint(canvas.current, 1400, tool === 'crop');
  });

  /** Pointer → whole-photo coordinates. */
  const toPhoto = (e: ReactPointerEvent): Pt => {
    const b = canvas.current!.getBoundingClientRect();
    const nx = clamp01((e.clientX - b.left) / b.width);
    const ny = clamp01((e.clientY - b.top) / b.height);
    const r = tool === 'crop' ? FULL : crop;
    return { x: r.x + nx * r.w, y: r.y + ny * r.h };
  };

  const addText = () => {
    const v = textDraft.trim();
    if (v && textAt) {
      setMarks((m) => [...m, { kind: 'text', color, size, at: textAt, text: v }]);
      setRedo([]);
    }
    setTextAt(null);
    setTextDraft('');
  };

  const onDown = (e: ReactPointerEvent) => {
    const p = toPhoto(e);
    if (tool === 'draw') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const stroke: Stroke = { kind: 'stroke', color, size, pts: [p] };
      drag.current = { start: p, stroke };
      setMarks((m) => [...m, stroke]);
      setRedo([]);
    } else if (tool === 'crop') {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { start: p };
    } else if (tool === 'text') {
      setTextAt(p);
    }
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toPhoto(e);
    if (d.stroke) {
      d.stroke.pts.push(p);
      setMarks((m) => [...m]);
    } else if (tool === 'crop') {
      setCropDraft({ x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) });
    }
  };
  const onUp = () => {
    if (tool === 'crop' && cropDraft) {
      if (cropDraft.w > 0.03 && cropDraft.h > 0.03) setCrop(cropDraft);
      setCropDraft(null);
    }
    drag.current = null;
  };

  const rotate = () => {
    setTurns((n) => (n + 1) % 4);
    setCrop(rotRect);
    setMarks((ms) => ms.map((m) => (m.kind === 'stroke' ? { ...m, pts: m.pts.map(rot) } : { ...m, at: rot(m.at) })));
  };
  const flip = () => {
    // Flipping after rotating mirrors the rotated photo: equivalent to flipping, then rotating the other way.
    setFlipped((f) => !f);
    setTurns((n) => (4 - n) % 4);
    setCrop((c) => ({ ...c, x: 1 - c.x - c.w }));
    setMarks((ms) => ms.map((m) => (m.kind === 'stroke' ? { ...m, pts: m.pts.map(flipPt) } : { ...m, at: flipPt(m.at) })));
  };
  const aspect = (r: number | null) => {
    if (!oriented || r === null) return setCrop(FULL);
    const photo = oriented.width / oriented.height;
    const w = r > photo ? 1 : r / photo;
    const h = r > photo ? photo / r : 1;
    setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  };

  const save = () => {
    if (!oriented) return;
    setSaving(true);
    const out = document.createElement('canvas');
    paint(out, 4096, false, true);
    const png = file.type === 'image/png';
    out.toBlob(
      (b) => {
        setSaving(false);
        if (!b) return toast.error(t('Couldn’t save the photo.'));
        const base = (file.name ?? 'photo').replace(/\.[^.]+$/, '');
        onDone(new File([b], `${base}-edited.${png ? 'png' : 'jpg'}`, { type: png ? 'image/png' : 'image/jpeg' }));
      },
      png ? 'image/png' : 'image/jpeg',
      0.92,
    );
  };

  const toolBtn = (id: Tool, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={tool === id}
      onClick={() => setTool(id)}
      className={`flex flex-col items-center gap-1 rounded-ae px-3 py-1.5 text-[11px] font-semibold ${tool === id ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'}`}
    >
      {icon}
      {label}
    </button>
  );
  const chip = (on: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${on ? 'bg-white text-black' : 'bg-white/10 text-white/80 hover:bg-white/20'}`;

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black/95 text-white" role="dialog" aria-modal="true" aria-label={t('Edit photo')}>
      <header className="flex items-center gap-2 px-3 py-2">
        <button type="button" aria-label={t('Cancel')} onClick={onCancel} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10">
          <CloseIcon size={18} />
        </button>
        <span className="font-semibold">{t('Edit photo')}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label={t('Undo')} disabled={!marks.length} onClick={() => (setRedo((r) => [marks.at(-1)!, ...r]), setMarks((m) => m.slice(0, -1)))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30">
            <UndoIcon size={17} />
          </button>
          <button type="button" aria-label={t('Redo')} disabled={!redo.length} onClick={() => (setMarks((m) => [...m, redo[0]!]), setRedo((r) => r.slice(1)))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30">
            <RedoIcon size={17} />
          </button>
          <button type="button" onClick={save} disabled={!oriented || saving} className="ml-2 rounded-full bg-ae-accent px-4 py-1.5 text-sm font-bold text-ae-on-accent disabled:opacity-50">
            {saving ? t('Saving…') : t('Done')}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {oriented ? (
          <canvas
            ref={canvas}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            className={`max-h-full max-w-full touch-none object-contain ${tool === 'adjust' ? '' : 'cursor-crosshair'}`}
            style={canvasFilterWorks() ? undefined : { filter: filterCss || undefined }}
          />
        ) : (
          <span className="ae-skeleton h-40 w-60 rounded-xl" />
        )}
      </div>

      <div className="space-y-3 border-t border-white/10 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {tool === 'adjust' && (
          <>
            <div className="ae-scroll flex gap-2 overflow-x-auto [scrollbar-width:none]">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={chip(filter === f.id)}>
                  {t(f.label)}
                </button>
              ))}
            </div>
            <div className="mx-auto grid max-w-xl gap-2 sm:grid-cols-3">
              {(['brightness', 'contrast', 'saturation'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-xs text-white/80">
                  <span className="w-20 shrink-0">{t(k[0]!.toUpperCase() + k.slice(1))}</span>
                  <input type="range" min={50} max={150} value={adj[k]} onChange={(e) => setAdj((a) => ({ ...a, [k]: Number(e.target.value) }))} onDoubleClick={() => setAdj((a) => ({ ...a, [k]: 100 }))} className="min-w-0 flex-1" />
                </label>
              ))}
            </div>
          </>
        )}
        {tool === 'crop' && (
          <div className="ae-scroll flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
            {ASPECTS.map((a) => (
              <button key={a.label} type="button" onClick={() => aspect(a.r)} className={chip(false)}>
                {t(a.label)}
              </button>
            ))}
            <span className="mx-1 h-5 w-px shrink-0 bg-white/20" />
            <button type="button" onClick={rotate} className={chip(false)}>
              {t('Rotate')}
            </button>
            <button type="button" onClick={flip} className={chip(false)}>
              {t('Flip')}
            </button>
            <span className="shrink-0 text-xs text-white/60">{t('Drag on the photo to crop.')}</span>
          </div>
        )}
        {(tool === 'draw' || tool === 'text') && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <div className="flex gap-1.5" role="radiogroup" aria-label={t('Colour')}>
              {COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className={`h-7 w-7 rounded-full border-2 ${color === c ? 'border-white' : 'border-white/20'}`} style={{ background: c }} />
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-white/80">
              {t('Size')}
              <input type="range" min={2} max={24} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            </label>
            {tool === 'text' && textAt ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addText();
                }}
              >
                <input autoFocus value={textDraft} maxLength={80} onChange={(e) => setTextDraft(e.target.value)} placeholder={t('Type your text')} aria-label={t('Type your text')} className="w-52 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white placeholder:text-white/50 outline-none focus:bg-white/15" />
                <button type="submit" className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black">
                  {t('Add')}
                </button>
              </form>
            ) : (
              <span className="text-xs text-white/60">{tool === 'draw' ? t('Draw on the photo.') : t('Tap the photo where the text goes.')}</span>
            )}
          </div>
        )}
        <nav className="flex justify-center gap-1" aria-label={t('Tools')}>
          {toolBtn('adjust', t('Adjust'), <SlidersIcon size={18} />)}
          {toolBtn('crop', t('Crop'), <CutIcon size={18} />)}
          {toolBtn('draw', t('Draw'), <BrushIcon size={18} />)}
          {toolBtn('text', t('Text'), <FontIcon size={18} />)}
        </nav>
      </div>
    </div>
  );
}
