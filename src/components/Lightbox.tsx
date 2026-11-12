/** Full-screen image viewer. Esc or click outside closes; "Open original" opens the browser. */
import { openExternal } from '../lib/platform';
import { useUiStore } from '../stores/uiStore';
import { CloseIcon } from './icons';
import { useEscape } from '../lib/escape';

export function Lightbox() {
  const image = useUiStore((s) => s.lightbox);
  const close = useUiStore((s) => s.openLightbox);

  useEscape(() => close(null), !!image);

  if (!image) return null;
  return (
    <div className="ae-backdrop fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/85 p-8" onMouseDown={() => close(null)}>
      <img
        src={image.url}
        alt={image.alt ?? image.name ?? ''}
        className="max-h-[85vh] max-w-[90vw] rounded object-contain shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      />
      <div className="mt-3 flex items-center gap-4 text-sm text-white/80" onMouseDown={(e) => e.stopPropagation()}>
        {image.alt && <span className="max-w-xl truncate italic">{image.alt}</span>}
        <button type="button" className="hover:text-white hover:underline" onClick={() => void openExternal(image.url)}>
          Open original
        </button>
      </div>
      <button type="button" aria-label="Close" className="absolute top-5 right-5 text-white/70 hover:text-white" onClick={() => close(null)}>
        <CloseIcon size={28} />
      </button>
    </div>
  );
}
