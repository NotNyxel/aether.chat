/**
 * Full-screen image viewer. Top right: download, forward the message, save the picture as a GIF
 * (it's added to your favourite GIFs), open the original, close. Esc or a click outside closes.
 */
import { useEffect, useRef, useState } from 'react';
import { uploadAttachmentTo } from '../hooks/useChatData';
import { openExternal } from '../lib/platform';
import { useSupabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import { useEscape } from '../lib/escape';
import { useGifFavorites } from './GifPicker';
import { CloseIcon, DownloadIcon, ExternalLinkIcon, ForwardIcon, MinusIcon, PlusIcon, StarIcon } from './icons';
import { toast } from './Toaster';

function Action({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      data-tip-side="bottom"
      disabled={disabled}
      onClick={onClick}
      className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white/85 backdrop-blur transition-colors hover:bg-white/20 hover:text-white disabled:opacity-40"
    >
      {children}
    </button>
  );
}

async function download(url: string, name: string) {
  try {
    const blob = await (await fetch(url)).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name || 'image';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast.success('Saved to your Downloads.');
  } catch {
    void openExternal(url);
  }
}

export function Lightbox() {
  const image = useUiStore((s) => s.lightbox);
  const close = useUiStore((s) => s.openLightbox);
  const openForward = useUiStore((s) => s.openForward);
  const sb = useSupabase();
  const fav = useGifFavorites();
  const [busy, setBusy] = useState(false);
  // Zoom and pan: wheel, double-click/double-tap, two-finger pinch, drag to move, +/− buttons.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragFrom = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [image?.url]);
  const setZ = (z: number) => {
    const next = Math.min(6, Math.max(1, z));
    setZoom(next);
    if (next === 1) setPan({ x: 0, y: 0 });
  };

  useEscape(() => close(null), !!image);
  if (!image) return null;

  const isGif = image.contentType === 'image/gif';
  const saved = fav.urls.has(image.url);
  const saveAsGif = async () => {
    if (busy) return;
    // Already a GIF: favourite it as it is.
    if (isGif) {
      await fav.add({ url: image.url, preview: image.url, type: 'image/gif', width: image.width ?? 480, height: image.height ?? 270, title: image.alt || image.name || 'GIF' });
      toast.success('Added to your favorite GIFs.', <StarIcon size={14} />);
      return;
    }
    if (!image.scopeId) return toast.error('This picture can’t be turned into a GIF here.');
    setBusy(true);
    try {
      const { imageToGif } = await import('../lib/toGif');
      const gif = await imageToGif(image.url);
      const att = await uploadAttachmentTo(sb, image.scopeId, gif.file);
      await fav.add({ url: att.url, preview: att.url, type: 'image/gif', width: gif.width, height: gif.height, title: image.alt || (image.name ?? 'GIF').replace(/\.[^.]+$/, '') });
      toast.success('Saved as a GIF in your favorites.', <StarIcon size={14} />);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not make a GIF from this picture.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ae-backdrop fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/85 p-8" onMouseDown={() => close(null)}>
      <img
        src={image.url}
        alt={image.alt ?? image.name ?? ''}
        className={`max-h-[85vh] max-w-[90vw] touch-none rounded object-contain shadow-2xl select-none ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: dragFrom.current || pinch.current ? 'none' : 'transform 120ms ease-out' }}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={() => setZ(zoom > 1 ? 1 : 2.5)}
        onWheel={(e) => setZ(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (touches.current.size === 2) {
            const [a, b] = [...touches.current.values()];
            pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), z: zoom };
          } else dragFrom.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        }}
        onPointerMove={(e) => {
          if (!touches.current.has(e.pointerId)) return;
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && touches.current.size === 2) {
            const [a, b] = [...touches.current.values()];
            setZ((pinch.current.z * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / pinch.current.d);
          } else if (dragFrom.current && zoom > 1) {
            const d = dragFrom.current;
            setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
          }
        }}
        onPointerUp={(e) => {
          touches.current.delete(e.pointerId);
          if (touches.current.size < 2) pinch.current = null;
          if (touches.current.size === 0) dragFrom.current = null;
        }}
        onPointerCancel={(e) => {
          touches.current.delete(e.pointerId);
          pinch.current = null;
          dragFrom.current = null;
        }}
        draggable={false}
      />
      {image.alt && (
        <p className="mt-3 max-w-xl truncate text-sm text-white/80 italic" onMouseDown={(e) => e.stopPropagation()}>
          {image.alt}
        </p>
      )}
      <div className="absolute top-[max(16px,env(safe-area-inset-top))] right-4 flex items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
        <Action label="Zoom out" disabled={zoom <= 1} onClick={() => setZ(zoom / 1.5)}>
          <MinusIcon size={18} />
        </Action>
        <Action label="Zoom in" disabled={zoom >= 6} onClick={() => setZ(zoom * 1.5)}>
          <PlusIcon size={18} />
        </Action>
        <Action label="Download" onClick={() => void download(image.url, image.name ?? 'image')}>
          <DownloadIcon size={18} />
        </Action>
        {image.messageId && (
          <Action
            label="Forward"
            onClick={() => {
              const id = image.messageId!;
              close(null);
              openForward(id);
            }}
          >
            <ForwardIcon size={18} />
          </Action>
        )}
        <Action label={saved ? 'In your favorite GIFs' : busy ? 'Making a GIF…' : 'Save as GIF'} disabled={busy || saved} onClick={() => void saveAsGif()}>
          {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <span className={`text-[10px] font-black ${saved ? 'text-[#f5b942]' : ''}`}>GIF</span>}
        </Action>
        <Action label="Open original" onClick={() => void openExternal(image.url)}>
          <ExternalLinkIcon size={17} />
        </Action>
        <Action label="Close" onClick={() => close(null)}>
          <CloseIcon size={20} />
        </Action>
      </div>
    </div>
  );
}
