/**
 * Moments studio (2.3): a full-screen creator, Snapchat-style. Pick a photo, video or colour, then
 * add text (8 styles), stickers and emoji, pictures, drawings (pen, highlighter, arrows), and
 * templates that look different every day. Swipe sideways on a photo to change its filter.
 * Everything you add moves with a finger: drag, pinch to resize and rotate, drag to the bin to
 * remove. See lib/momentArt.ts for the layout and the final drawing.
 */
import '@fontsource/bebas-neue/latin-400.css';
import '@fontsource/permanent-marker/latin-400.css';
import '@fontsource-variable/dancing-script/index.css';
import '@fontsource-variable/caveat/index.css';
import '@fontsource/pacifico/latin-400.css';
import '@fontsource/abril-fatface/latin-400.css';
import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/monoton/latin-400.css';
import '@fontsource/bungee/latin-400.css';
import '@fontsource/special-elite/latin-400.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useServers } from '../hooks/useChatData';
import { useMeId } from '../hooks/useMe';
import { usePostMoment, type MomentAudience } from '../hooks/useMoments';
import { searchEmoji, useEmojiData } from '../lib/emoji';
import { t } from '../lib/i18n';
import {
  drawStroke,
  EMOJI_SIZE,
  filterCss,
  FONTS,
  layoutText,
  loadFonts,
  lookOf,
  PHOTO_FILTERS,
  renderScene,
  STAGE_H,
  STAGE_W,
  TEMPLATE_KINDS,
  templateBlock,
  templateDesign,
  TEXT_COLORS,
  TEXT_STYLES,
  textCss,
  type El,
  type Scene,
  type Stroke,
  type TemplateKind,
} from '../lib/momentArt';
import { emojiUrl } from '../lib/twemoji';
import { BrushIcon, CalendarIcon, CameraIcon, CloseIcon, FontIcon, ImageIcon, SendIcon, SparklesIcon, StickerIcon, TrashIcon, UndoIcon } from './icons';
import { useServerStickers } from './Stickers';
import { toast } from './Toaster';

const GRADIENTS: string[][] = [
  ['#7658fb', '#22d3ee'],
  ['#ff6fd8', '#3813c2'],
  ['#ff9f1c', '#ff4d6d'],
  ['#0f9f7a', '#1c64f2'],
  ['#111111', '#3a3a4a'],
  ['#fbc2eb', '#a6c1ee'],
  ['#f6d365', '#fda085'],
];
const POPULAR = ['😂', '❤️', '🔥', '😍', '🥹', '😭', '✨', '💀', '🙏', '🥳', '😎', '👀', '💯', '🎉', '😴', '🤝', '🍕', '☕', '🎮', '🎧', '🌙', '☀️', '🌸', '⭐', '💜', '🫶', '😤', '🤯', '👑', '🫠'];
const DRAW_COLORS = ['#ffffff', '#111111', '#ff4d6d', '#ff9f1c', '#ffe14d', '#3ddc84', '#22d3ee', '#4f7dff', '#a855f7'];

type Tool = null | 'draw' | 'stickers' | 'templates' | 'filters';
type Media = { file: File; url: string; type: 'image' | 'video' };
type Snapshot = { elements: El[]; strokes: Stroke[] };

const uid = () => Math.random().toString(36).slice(2, 10);

export default function MomentStudio({ onClose }: { onClose: () => void }) {
  const post = usePostMoment();
  const [media, setMedia] = useState<Media | null>(null);
  const [gradient, setGradient] = useState(0);
  const [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const [filter, setFilter] = useState('none');
  const [elements, setElements] = useState<El[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; style: string; color: string } | null>(null);
  const [pen, setPen] = useState<{ tool: Stroke['tool']; color: string; width: number }>({ tool: 'pen', color: '#ffffff', width: 14 });
  const [audience, setAudience] = useState<MomentAudience>('friends');
  const [dragging, setDragging] = useState<{ overBin: boolean } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);

  // Stage size: the biggest 9:16 box that fits.
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 360, h: 640 });
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fitBox = () => {
      const r = el.getBoundingClientRect();
      const h = Math.min(r.height, (r.width * 16) / 9);
      setBox({ w: Math.round((h * 9) / 16), h: Math.round(h) });
    };
    fitBox();
    const ro = new ResizeObserver(fitBox);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k = box.w / STAGE_W;

  useEffect(() => {
    const specs = TEXT_STYLES.map((s) => `${s.look.weight} 40px ${FONTS[s.look.font]}`).concat(Object.values(FONTS).map((f) => `400 40px ${f}`));
    void loadFonts(specs).then(() => setFontsReady(true));
  }, []);

  useEffect(() => () => void (media && URL.revokeObjectURL(media.url)), [media]);

  const snapshot = () => setHistory((h) => [...h.slice(-30), { elements, strokes }]);
  const undo = () => {
    const last = history.at(-1);
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setElements(last.elements);
    setStrokes(last.strokes);
    setSelected(null);
  };
  const update = (id: string, patch: Partial<El>) => setElements((els) => els.map((e) => (e.id === id ? ({ ...e, ...patch } as El) : e)));
  const add = (el: El) => {
    snapshot();
    // New things land a little apart instead of on top of each other.
    const n = elements.length % 5;
    const placed = { ...el, x: el.x + (n % 2 ? -1 : 1) * n * 36, y: el.y + n * 70 } as El;
    setElements((els) => [...els, placed]);
    setSelected(el.id);
  };
  const remove = (id: string) => {
    snapshot();
    setElements((els) => els.filter((e) => e.id !== id));
    setSelected(null);
  };
  const toFront = (id: string) => setElements((els) => [...els.filter((e) => e.id !== id), els.find((e) => e.id === id)!]);
  const hasContent = !!media || elements.length > 0 || strokes.length > 0;

  const flashTimer = useRef<number | undefined>(undefined);
  const say = (msg: string) => {
    setFlash(msg);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1100);
  };

  // ── Media ───────────────────────────────────────────────────────────────────────────────────
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const picture = useRef<HTMLInputElement>(null);
  const pickMedia = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) return toast.error(t('Moments can be up to 20 MB.'));
    const type = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : null;
    if (!type) return toast.error(t('Pick a photo or a video.'));
    setMedia({ file: f, url: URL.createObjectURL(f), type });
    setFilter('none');
  };
  const addPicture = (f: File | undefined) => {
    if (!f || !f.type.startsWith('image/')) return;
    const src = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const w = 520;
      const h = Math.min(760, (w * img.height) / img.width);
      add({ id: uid(), kind: 'image', src, w, h: h, x: STAGE_W / 2, y: STAGE_H / 2, scale: 1, rot: 0, round: false });
    };
    img.src = src;
  };

  // ── Text ────────────────────────────────────────────────────────────────────────────────────
  const newText = () => {
    setTool(null);
    setEditing({ id: uid(), text: '', style: 'classic', color: '#ffffff' });
  };
  const editText = (el: Extract<El, { kind: 'text' }>) => setEditing({ id: el.id, text: el.text, style: el.style, color: el.color });
  const finishText = () => {
    if (!editing) return;
    const e = editing;
    setEditing(null);
    const existing = elements.find((x) => x.id === e.id);
    if (!e.text.trim()) {
      if (existing) remove(e.id);
      return;
    }
    if (existing) {
      snapshot();
      update(e.id, { text: e.text, style: e.style, color: e.color } as Partial<El>);
    } else add({ id: e.id, kind: 'text', text: e.text, style: e.style, color: e.color, x: STAGE_W / 2, y: STAGE_H * 0.45, scale: 1, rot: 0 });
  };

  // ── Element gestures: drag, pinch, rotate, bin ─────────────────────────────────────────────
  const stageRef = useRef<HTMLDivElement>(null);
  const binRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: string;
    pts: Map<number, { x: number; y: number }>;
    start: { x: number; y: number; scale: number; rot: number };
    base: { mx: number; my: number; dist: number; ang: number } | null;
    moved: boolean;
    t: number;
    snap: boolean;
  } | null>(null);
  const pinchBase = (pts: Map<number, { x: number; y: number }>) => {
    const [a, b] = [...pts.values()];
    return { mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2, dist: Math.hypot(b!.x - a!.x, b!.y - a!.y), ang: Math.atan2(b!.y - a!.y, b!.x - a!.x) };
  };
  const onElDown = (e: RPointerEvent, el: El) => {
    if (tool === 'draw' || editing) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const g = gesture.current;
    if (g && g.id === el.id) {
      g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g.pts.size === 2) {
        const cur = elements.find((x) => x.id === el.id)!;
        g.start = { x: cur.x, y: cur.y, scale: cur.scale, rot: cur.rot };
        g.base = pinchBase(g.pts);
      }
      return;
    }
    gesture.current = { id: el.id, pts: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]), start: { x: el.x, y: el.y, scale: el.scale, rot: el.rot }, base: null, moved: false, t: Date.now(), snap: false };
    setSelected(el.id);
  };
  const onElMove = (e: RPointerEvent) => {
    const g = gesture.current;
    if (!g || !g.pts.has(e.pointerId)) return;
    const first = g.pts.get(e.pointerId)!;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!g.snap) {
      snapshot();
      g.snap = true;
    }
    if (g.pts.size >= 2 && g.base) {
      const now = pinchBase(g.pts);
      g.moved = true;
      update(g.id, {
        scale: Math.min(8, Math.max(0.15, g.start.scale * (now.dist / Math.max(1, g.base.dist)))),
        rot: g.start.rot + (now.ang - g.base.ang),
        x: g.start.x + (now.mx - g.base.mx) / k,
        y: g.start.y + (now.my - g.base.my) / k,
      });
      return;
    }
    // One finger: move. Track from where this gesture started.
    const origin = (g as unknown as { o?: { x: number; y: number } }).o ?? ((g as unknown as { o?: { x: number; y: number } }).o = { x: first.x, y: first.y });
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    if (Math.hypot(dx, dy) > 4) g.moved = true;
    update(g.id, { x: g.start.x + dx / k, y: g.start.y + dy / k });
    if (g.moved) {
      const bin = binRef.current?.getBoundingClientRect();
      const over = !!bin && e.clientX > bin.left - 20 && e.clientX < bin.right + 20 && e.clientY > bin.top - 20 && e.clientY < bin.bottom + 20;
      setDragging((d) => (d?.overBin === over ? d : { overBin: over }));
    }
  };
  const onElUp = (e: RPointerEvent, el: El) => {
    const g = gesture.current;
    if (!g) return;
    g.pts.delete(e.pointerId);
    if (g.pts.size === 1) {
      // Pinch ended with one finger still down: carry on moving from here.
      const [p] = [...g.pts.values()];
      const cur = elements.find((x) => x.id === g.id)!;
      g.start = { x: cur.x, y: cur.y, scale: cur.scale, rot: cur.rot };
      (g as unknown as { o?: { x: number; y: number } }).o = { x: p!.x, y: p!.y };
      g.base = null;
      return;
    }
    if (g.pts.size > 0) return;
    gesture.current = null;
    const overBin = dragging?.overBin;
    setDragging(null);
    if (overBin) {
      setElements((els) => els.filter((x) => x.id !== g.id));
      setSelected(null);
      return;
    }
    // A quick tap on text opens it for editing.
    if (!g.moved && Date.now() - g.t < 300 && el.kind === 'text') editText(el);
  };
  // Mouse: wheel resizes, Shift+wheel rotates.
  const onElWheel = (e: React.WheelEvent, el: El) => {
    e.stopPropagation();
    if (e.shiftKey) update(el.id, { rot: el.rot + e.deltaY * 0.003 });
    else update(el.id, { scale: Math.min(8, Math.max(0.15, el.scale * (1 - e.deltaY * 0.0015))) });
  };
  // Mouse: the corner handle resizes and rotates around the centre.
  const onHandleDown = (e: RPointerEvent, el: El) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    snapshot();
    const r = stageRef.current!.getBoundingClientRect();
    const cx = r.left + el.x * k;
    const cy = r.top + el.y * k;
    const d0 = Math.hypot(e.clientX - cx, e.clientY - cy);
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    const s0 = el.scale;
    const r0 = el.rot;
    const move = (ev: PointerEvent) => update(el.id, { scale: Math.min(8, Math.max(0.15, (s0 * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / Math.max(1, d0))), rot: r0 + Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0 });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── Background: swipe sideways to change the photo filter; tap to deselect ─────────────────
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onStageDown = (e: RPointerEvent) => {
    setSelected(null);
    if (tool === 'draw') return;
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onStageUp = (e: RPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || media?.type !== 'image') return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < 60 || Math.abs(e.clientY - s.y) > 80) return;
    const i = PHOTO_FILTERS.findIndex((f) => f.id === filter);
    const next = PHOTO_FILTERS[(i + (dx < 0 ? 1 : -1) + PHOTO_FILTERS.length) % PHOTO_FILTERS.length]!;
    setFilter(next.id);
    say(t(next.label));
  };

  // ── Drawing ─────────────────────────────────────────────────────────────────────────────────
  const drawCanvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<Stroke | null>(null);
  useEffect(() => {
    const c = drawCanvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    for (const s of strokes) drawStroke(ctx, s);
  }, [strokes, tool]);
  const toStage = (e: RPointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };
  const onDrawDown = (e: RPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    snapshot();
    live.current = { ...pen, width: pen.tool === 'highlight' ? pen.width * 2.6 : pen.width, pts: [toStage(e)] };
  };
  const onDrawMove = (e: RPointerEvent) => {
    const s = live.current;
    if (!s) return;
    const p = toStage(e);
    if (s.tool === 'arrow') s.pts = [s.pts[0]!, p];
    else s.pts.push(p);
    const ctx = drawCanvas.current!.getContext('2d')!;
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    for (const st of strokes) drawStroke(ctx, st);
    drawStroke(ctx, s);
  };
  const onDrawUp = () => {
    const s = live.current;
    live.current = null;
    if (s && s.pts.length) setStrokes((all) => [...all, s]);
  };

  // ── Keyboard ────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (editing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        remove(selected);
      } else if (e.key === 'Escape') {
        if (tool) setTool(null);
        else if (selected) setSelected(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // ── Share ───────────────────────────────────────────────────────────────────────────────────
  const [sharing, setSharing] = useState(false);
  const scene = (): Scene => ({
    background: media ? (media.type === 'video' ? { kind: 'video' } : { kind: 'photo', src: media.url, fit }) : { kind: 'color', css: '', stops: GRADIENTS[gradient]! },
    filter,
    strokes,
    elements,
  });
  const share = async () => {
    if (!hasContent || sharing) return;
    setSharing(true);
    setSelected(null);
    try {
      if (media?.type === 'video') {
        const overlay = elements.length || strokes.length ? await renderScene(scene()) : undefined;
        await post.mutateAsync({ file: media.file, overlay, audience });
      } else {
        const blob = await renderScene(scene());
        await post.mutateAsync({ file: new File([blob], 'moment.jpg', { type: 'image/jpeg' }), audience });
      }
      toast.success(t('Moment shared. It disappears in 24 hours.'));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Couldn’t share your moment.'));
    } finally {
      setSharing(false);
    }
  };
  const tryClose = () => (hasContent ? setConfirmClose(true) : onClose());

  const sel = elements.find((e) => e.id === selected) ?? null;
  const bgCss = media ? '#000' : `linear-gradient(135deg, ${GRADIENTS[gradient]!.join(', ')})`;

  return (
    <div className="fixed inset-0 z-[98] flex flex-col bg-black text-white select-none" role="dialog" aria-modal="true" aria-label={t('New moment')}>
      <div ref={wrap} className="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4">
        <div
          ref={stageRef}
          className="relative touch-none overflow-hidden rounded-[22px] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
          style={{ width: box.w, height: box.h, background: bgCss }}
          onPointerDown={onStageDown}
          onPointerUp={onStageUp}
        >
          {/* Background media */}
          {media?.type === 'image' && (
            <>
              {fit === 'contain' && <img src={media.url} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-80 blur-2xl" draggable={false} />}
              <img src={media.url} alt="" className={`absolute inset-0 h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`} style={{ filter: filterCss(filter) }} draggable={false} />
            </>
          )}
          {media?.type === 'video' && <video src={media.url} className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline />}

          {/* Drawings */}
          <canvas
            ref={drawCanvas}
            width={STAGE_W}
            height={STAGE_H}
            className={`absolute inset-0 h-full w-full ${tool === 'draw' ? 'cursor-crosshair' : 'pointer-events-none'}`}
            onPointerDown={tool === 'draw' ? onDrawDown : undefined}
            onPointerMove={tool === 'draw' ? onDrawMove : undefined}
            onPointerUp={tool === 'draw' ? onDrawUp : undefined}
            onPointerCancel={tool === 'draw' ? onDrawUp : undefined}
          />

          {/* Things you added */}
          {fontsReady &&
            elements.map((el) => (
              <ElementView
                key={el.id}
                el={el}
                k={k}
                selected={selected === el.id && !dragging}
                hidden={editing?.id === el.id}
                interactive={tool !== 'draw'}
                onDown={(e) => onElDown(e, el)}
                onMove={onElMove}
                onUp={(e) => onElUp(e, el)}
                onWheel={(e) => onElWheel(e, el)}
                onHandle={(e) => onHandleDown(e, el)}
              />
            ))}

          {flash && <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-2xl font-extrabold drop-shadow-lg">{flash}</div>}

          {/* Bin, while dragging */}
          {dragging && (
            <div ref={binRef} className={`absolute bottom-6 left-1/2 grid h-14 w-14 -translate-x-1/2 place-items-center rounded-full border-2 transition-transform ${dragging.overBin ? 'scale-125 border-red-400 bg-red-500/80' : 'border-white/70 bg-black/40'}`}>
              <TrashIcon size={22} />
            </div>
          )}
          {!dragging && <div ref={binRef} className="hidden" />}

          {/* Text editor */}
          {editing && <TextEditor value={editing} k={k} onChange={setEditing} onDone={finishText} />}

          {/* Top bar */}
          {!editing && (
            <div className="absolute top-0 left-0 p-3">
              <RoundButton label={t('Close')} onClick={tryClose}>
                <CloseIcon size={18} />
              </RoundButton>
            </div>
          )}
          {!editing && sel && tool === null && !dragging && (
            <div className="absolute inset-x-0 bottom-4 flex justify-center px-3">
                <div className="flex flex-wrap items-center justify-center gap-1 rounded-full bg-black/60 p-1 backdrop-blur">
                  <Pill onClick={() => remove(sel.id)}>{t('Delete')}</Pill>
                  <Pill onClick={() => toFront(sel.id)}>{t('To front')}</Pill>
                  {sel.kind === 'image' && <Pill onClick={() => update(sel.id, { round: !sel.round } as Partial<El>)}>{sel.round ? t('Square') : t('Circle')}</Pill>}
                  {sel.kind === 'template' && <Pill onClick={() => update(sel.id, { shuffle: sel.shuffle + 1 } as Partial<El>)}>{t('New look')}</Pill>}
                  {sel.kind === 'text' && <Pill onClick={() => editText(sel)}>{t('Edit')}</Pill>}
                </div>
            </div>
          )}

          {/* Tool rail */}
          {!editing && (
            <div className="absolute top-3 right-3 flex flex-col items-center gap-2">
              <RailButton label={t('Text')} onClick={newText}>
                <FontIcon size={20} />
              </RailButton>
              <RailButton label={t('Draw')} active={tool === 'draw'} onClick={() => setTool(tool === 'draw' ? null : 'draw')}>
                <BrushIcon size={20} />
              </RailButton>
              <RailButton label={t('Stickers')} active={tool === 'stickers'} onClick={() => setTool(tool === 'stickers' ? null : 'stickers')}>
                <StickerIcon size={20} />
              </RailButton>
              <RailButton label={t('Picture')} onClick={() => picture.current?.click()}>
                <ImageIcon size={20} />
              </RailButton>
              <RailButton label={t('Templates')} active={tool === 'templates'} onClick={() => setTool(tool === 'templates' ? null : 'templates')}>
                <CalendarIcon size={20} />
              </RailButton>
              {media?.type === 'image' && (
                <RailButton label={t('Filters')} active={tool === 'filters'} onClick={() => setTool(tool === 'filters' ? null : 'filters')}>
                  <SparklesIcon size={20} />
                </RailButton>
              )}
              {media?.type === 'image' && (
                <RailButton label={fit === 'cover' ? t('Fit') : t('Fill')} onClick={() => setFit(fit === 'cover' ? 'contain' : 'cover')}>
                  <span className="text-[11px] font-black">{fit === 'cover' ? 'FIT' : 'FILL'}</span>
                </RailButton>
              )}
              {history.length > 0 && (
                <RailButton label={t('Undo')} onClick={undo}>
                  <UndoIcon size={20} />
                </RailButton>
              )}
            </div>
          )}

          {/* Start: pick something, or use a colour */}
          {!media && !hasContent && !editing && !tool && (
            <div className="absolute inset-x-0 top-1/3 flex flex-col items-center gap-3 px-6 text-center">
              <p className="text-lg font-bold drop-shadow">{t('Share a moment')}</p>
              <div className="flex gap-2">
                <button type="button" className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-black" onClick={() => camera.current?.click()}>
                  <CameraIcon size={16} /> {t('Camera')}
                </button>
                <button type="button" className="flex items-center gap-2 rounded-full bg-white/20 px-4 py-2.5 text-sm font-bold backdrop-blur" onClick={() => gallery.current?.click()}>
                  <ImageIcon size={16} /> {t('Gallery')}
                </button>
              </div>
              <p className="text-xs text-white/75">{t('Or tap Aa to write on a colour.')}</p>
            </div>
          )}

          {/* Draw options */}
          {tool === 'draw' && !editing && (
            <div className="absolute inset-x-3 bottom-3 space-y-2 rounded-2xl bg-black/60 p-3 backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
              <div className="flex justify-center gap-1">
                {(['pen', 'highlight', 'arrow'] as const).map((tl) => (
                  <Pill key={tl} active={pen.tool === tl} onClick={() => setPen({ ...pen, tool: tl })}>
                    {tl === 'pen' ? t('Pen') : tl === 'highlight' ? t('Highlighter') : t('Arrow')}
                  </Pill>
                ))}
              </div>
              <div className="flex items-center justify-center gap-1.5">
                {DRAW_COLORS.map((c) => (
                  <button key={c} type="button" aria-label={c} onClick={() => setPen({ ...pen, color: c })} className={`h-7 w-7 rounded-full border-2 ${pen.color === c ? 'scale-110 border-white' : 'border-white/30'}`} style={{ background: c }} />
                ))}
              </div>
              <input type="range" min={4} max={40} value={pen.width} onChange={(e) => setPen({ ...pen, width: Number(e.target.value) })} aria-label={t('Size')} className="w-full" />
              <button type="button" onClick={() => setTool(null)} className="w-full rounded-full bg-white py-2 text-sm font-bold text-black">
                {t('Done')}
              </button>
            </div>
          )}

          {tool === 'stickers' && <StickerSheet onPick={(el) => (add(el), setTool(null))} onClose={() => setTool(null)} />}
          {tool === 'templates' && <TemplateSheet k={k} onPick={(el) => (add(el), setTool(null))} onClose={() => setTool(null)} />}
          {tool === 'filters' && media?.type === 'image' && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 p-3" onPointerDown={(e) => e.stopPropagation()}>
              <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
                {PHOTO_FILTERS.map((f) => (
                  <button key={f.id} type="button" onClick={() => setFilter(f.id)} className="flex shrink-0 flex-col items-center gap-1">
                    <img src={media.url} alt="" className={`h-16 w-12 rounded-lg object-cover ring-2 ${filter === f.id ? 'ring-white' : 'ring-transparent'}`} style={{ filter: filterCss(f.id) }} draggable={false} />
                    <span className="text-[11px] font-semibold">{t(f.label)}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-center text-[11px] text-white/70">{t('Tip: swipe left or right on the photo.')}</p>
            </div>
          )}
          {confirmClose && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 p-6" onPointerDown={(e) => e.stopPropagation()}>
              <div className="w-full max-w-xs rounded-2xl bg-ae-elevated p-4 text-ae-text">
                <p className="font-bold">{t('Discard this moment?')}</p>
                <p className="mt-1 text-sm text-ae-muted">{t('What you added will be lost.')}</p>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" className="rounded-ae px-3 py-1.5 text-sm hover:bg-ae-hover" onClick={() => setConfirmClose(false)}>
                    {t('Keep editing')}
                  </button>
                  <button type="button" className="rounded-ae bg-ae-danger px-3 py-1.5 text-sm font-bold text-white" onClick={onClose}>
                    {t('Discard')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar: background colours (no photo), audience, share */}
      {!editing && (
        <div className="flex flex-wrap items-center justify-center gap-2 px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {!media ? (
            <div className="flex gap-1.5" role="radiogroup" aria-label={t('Background')}>
              {GRADIENTS.map((g, i) => (
                <button key={i} type="button" role="radio" aria-checked={gradient === i} aria-label={`${t('Background')} ${i + 1}`} onClick={() => setGradient(i)} className={`h-7 w-7 rounded-full border-2 ${gradient === i ? 'border-white' : 'border-white/25'}`} style={{ background: `linear-gradient(135deg, ${g.join(', ')})` }} />
              ))}
            </div>
          ) : (
            <button type="button" className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold" onClick={() => setMedia(null)}>
              {t('Remove photo')}
            </button>
          )}
          <div className="flex gap-1 rounded-full bg-white/10 p-1">
            {(['everyone', 'friends', 'close'] as MomentAudience[]).map((a) => (
              <button key={a} type="button" aria-pressed={audience === a} onClick={() => setAudience(a)} className={`rounded-full px-3 py-1 text-xs font-bold ${audience === a ? 'bg-white text-black' : 'text-white/80'}`}>
                {a === 'everyone' ? t('Everyone') : a === 'friends' ? t('Friends') : t('Close friends')}
              </button>
            ))}
          </div>
          <button type="button" disabled={!hasContent || sharing} onClick={() => void share()} className="flex items-center gap-2 rounded-full bg-ae-accent px-5 py-2 text-sm font-bold text-ae-on-accent disabled:opacity-40">
            {sharing ? t('Sharing…') : t('Share')} <SendIcon size={15} />
          </button>
        </div>
      )}

      <input ref={camera} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={(e) => (pickMedia(e.target.files?.[0]), (e.target.value = ''))} />
      <input ref={gallery} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => (pickMedia(e.target.files?.[0]), (e.target.value = ''))} />
      <input ref={picture} type="file" accept="image/*" className="hidden" onChange={(e) => (addPicture(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────────────────────

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} onPointerDown={(e) => e.stopPropagation()} className="grid h-10 w-10 place-items-center rounded-full bg-black/45 backdrop-blur hover:bg-black/60">
      {children}
    </button>
  );
}

function RailButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className={`group relative grid h-11 w-11 place-items-center rounded-full backdrop-blur transition-colors ${active ? 'bg-white text-black' : 'bg-black/45 hover:bg-black/65'}`}
    >
      {children}
      <span className="pointer-events-none absolute right-full mr-2 hidden rounded-md bg-black/75 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-white group-hover:block">{label}</span>
    </button>
  );
}

function Pill({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} onPointerDown={(e) => e.stopPropagation()} className={`rounded-full px-3 py-1 text-xs font-bold ${active ? 'bg-white text-black' : 'text-white hover:bg-white/15'}`}>
      {children}
    </button>
  );
}

function BlockView({ kind, at, shuffle, k }: { kind: TemplateKind; at: number; shuffle: number; k: number }) {
  const b = templateBlock(kind, new Date(at), shuffle);
  return (
    <div className="relative" style={{ width: b.width * k, height: b.height * k, background: b.bg?.color, borderRadius: (b.bg?.radius ?? 0) * k }}>
      {b.runs.map((r, i) => (
        <span
          key={i}
          className="absolute left-1/2 whitespace-pre"
          style={{
            top: `calc(50% + ${r.dy * k}px)`,
            transform: 'translate(-50%, -50%)',
            font: `${r.weight} ${r.size * k}px ${FONTS[r.font]}`,
            lineHeight: 1,
            color: r.color,
            WebkitTextStroke: r.stroke ? `${r.stroke.width * k}px ${r.stroke.color}` : undefined,
            paintOrder: r.stroke ? 'stroke fill' : undefined,
            textShadow: r.glow ? `0 0 ${24 * k}px ${r.glow}, 0 0 ${40 * k}px ${r.glow}` : !b.bg ? `0 ${4 * k}px ${10 * k}px rgba(0,0,0,0.4)` : undefined,
          }}
        >
          {r.text}
        </span>
      ))}
    </div>
  );
}

function ElementView({
  el,
  k,
  selected,
  hidden,
  interactive,
  onDown,
  onMove,
  onUp,
  onWheel,
  onHandle,
}: {
  el: El;
  k: number;
  selected: boolean;
  hidden: boolean;
  interactive: boolean;
  onDown: (e: RPointerEvent) => void;
  onMove: (e: RPointerEvent) => void;
  onUp: (e: RPointerEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  onHandle: (e: RPointerEvent) => void;
}) {
  let body: ReactNode;
  if (el.kind === 'text') {
    const look = lookOf(el.style);
    const lines = layoutText(el.text, look).lines;
    body = <div style={textCss(look, el.color, k)}>{lines.join('\n')}</div>;
  } else if (el.kind === 'template') body = <BlockView kind={el.template} at={el.at} shuffle={el.shuffle} k={k} />;
  else if (el.kind === 'emoji') body = <img src={emojiUrl(el.emoji)} alt={el.emoji} style={{ width: EMOJI_SIZE * k, height: EMOJI_SIZE * k }} draggable={false} />;
  else
    body = (
      <img
        src={el.kind === 'image' ? el.src : el.url}
        alt=""
        style={{ width: el.w * k, height: el.h * k, borderRadius: el.kind === 'image' ? (el.round ? '50%' : 28 * k) : undefined, objectFit: 'cover' }}
        draggable={false}
      />
    );
  return (
    <div
      className={`absolute ${interactive ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'} ${hidden ? 'opacity-0' : ''}`}
      style={{ left: el.x * k, top: el.y * k, transform: `translate(-50%, -50%) rotate(${el.rot}rad) scale(${el.scale})`, touchAction: 'none' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onWheel={onWheel}
    >
      {body}
      {selected && (
        <>
          <span className="pointer-events-none absolute -inset-2 rounded-lg border-2 border-dashed border-white/80" style={{ borderWidth: 2 / el.scale }} />
          {/* Mouse: drag to resize and rotate. Hidden on touch screens (pinch instead). */}
          <span
            className="absolute -right-4 -bottom-4 hidden h-6 w-6 cursor-nwse-resize rounded-full border-2 border-black bg-white [@media(pointer:fine)]:block"
            style={{ transform: `scale(${1 / el.scale})` }}
            onPointerDown={onHandle}
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
}

function TextEditor({ value, k, onChange, onDone }: { value: { id: string; text: string; style: string; color: string }; k: number; onChange: (v: typeof value) => void; onDone: () => void }) {
  const look = lookOf(value.style);
  const style = TEXT_STYLES.find((s) => s.id === value.style)!;
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);
  const css = textCss(look, value.color, k);
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-black/45" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => {
            const i = TEXT_STYLES.findIndex((s) => s.id === value.style);
            onChange({ ...value, style: TEXT_STYLES[(i + 1) % TEXT_STYLES.length]!.id });
          }}
          className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-bold backdrop-blur"
          aria-label={t('Text style')}
        >
          Aa <span className="font-semibold text-white/80">{t(style.label)}</span>
        </button>
        <button type="button" onClick={onDone} className="ml-auto rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black">
          {t('Done')}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <textarea
          ref={area}
          value={value.text}
          maxLength={200}
          rows={Math.max(1, value.text.split('\n').length)}
          placeholder={t('Type something')}
          aria-label={t('Text')}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          className="max-w-full resize-none overflow-hidden border-0 bg-transparent outline-none placeholder:text-white/50"
          style={{ ...css, width: '92%', whiteSpace: 'pre-wrap', fontSize: Math.max(16, look.size * k), lineHeight: `${Math.max(16, look.size * k) * look.lineHeight}px` }}
        />
      </div>
      {/* Colours: a vertical strip on the right, like on phones */}
      <div className="absolute top-16 right-3 flex flex-col gap-1.5 rounded-full bg-black/40 p-1.5 backdrop-blur" role="radiogroup" aria-label={t('Colour')}>
        {TEXT_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={value.color === c} aria-label={c} onClick={() => onChange({ ...value, color: c })} className={`h-6 w-6 rounded-full border-2 ${value.color === c ? 'scale-110 border-white' : 'border-white/30'}`} style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[62%] flex-col rounded-t-3xl bg-[#121219]/95 backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="font-bold">{title}</span>
        <button type="button" aria-label={t('Close')} onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10">
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="ae-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4">{children}</div>
    </div>
  );
}

function StickerSheet({ onPick, onClose }: { onPick: (el: El) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji');
  const [q, setQ] = useState('');
  const data = useEmojiData();
  const me = useMeId();
  const { data: servers = [] } = useServers(me);
  const { data: stickers = [] } = useServerStickers(servers.map((s) => s.id));
  const emoji = useMemo(() => (q.trim() && data ? searchEmoji(data, q, 80).map((e) => e.emoji) : POPULAR), [q, data]);
  const place = { x: STAGE_W / 2, y: STAGE_H * 0.42, scale: 1, rot: 0 };
  return (
    <Sheet title={t('Stickers')} onClose={onClose}>
      <div className="mb-3 flex gap-1">
        <Pill active={tab === 'emoji'} onClick={() => setTab('emoji')}>
          {t('Emoji')}
        </Pill>
        <Pill active={tab === 'stickers'} onClick={() => setTab('stickers')}>
          {t('Server stickers')}
        </Pill>
      </div>
      {tab === 'emoji' ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search emoji')} className="mb-3 w-full rounded-full bg-white/10 px-4 py-2 text-sm text-white outline-none placeholder:text-white/50" />
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
            {emoji.map((e) => (
              <button key={e} type="button" onClick={() => onPick({ id: uid(), kind: 'emoji', emoji: e, ...place })} className="grid aspect-square place-items-center rounded-xl hover:bg-white/10">
                <img src={emojiUrl(e)} alt={e} className="h-9 w-9" loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        </>
      ) : stickers.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/60">{t('Stickers from your servers show up here.')}</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {stickers.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.name}
              onClick={() => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                  const w = 420;
                  onPick({ id: uid(), kind: 'sticker', url: s.url, w, h: (w * img.height) / Math.max(1, img.width), ...place });
                };
                img.onerror = () => toast.error(t('That sticker can’t be used here.'));
                img.src = s.url;
              }}
              className="grid aspect-square place-items-center rounded-xl hover:bg-white/10"
            >
              <img src={s.url} alt={s.name} className="max-h-16 max-w-16" loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function TemplateSheet({ k, onPick, onClose }: { k: number; onPick: (el: El) => void; onClose: () => void }) {
  const [shuffle, setShuffle] = useState(0);
  const now = Date.now();
  const scale = Math.min(0.32, k * 0.9);
  return (
    <Sheet title={t('Templates')} onClose={onClose}>
      <p className="mb-3 text-xs text-white/65">{t('New designs every day. Tap one to add it, then move it anywhere.')}</p>
      <div className="grid grid-cols-2 gap-2">
        {TEMPLATE_KINDS.map((tk) => (
          <button
            key={tk.id}
            type="button"
            onClick={() => onPick({ id: uid(), kind: 'template', template: tk.id, shuffle, at: now, x: STAGE_W / 2, y: STAGE_H * 0.3, scale: 1, rot: 0 })}
            className="flex min-h-28 flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-br from-white/10 to-white/5 p-3 hover:from-white/15"
          >
            <BlockView kind={tk.id} at={now} shuffle={shuffle} k={scale} />
            <span className="text-[11px] font-semibold text-white/70">
              {t(tk.label)} · {templateDesign(tk.id, new Date(now), shuffle).name}
            </span>
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setShuffle((s) => s + 1)} className="mt-3 w-full rounded-full bg-white/10 py-2 text-sm font-bold hover:bg-white/15">
        {t('Try other looks')}
      </button>
    </Sheet>
  );
}
