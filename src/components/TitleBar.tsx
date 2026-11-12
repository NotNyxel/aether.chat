/**
 * Aether's own title bar (the Windows frame is turned off). Drag to move, double-click to
 * maximise, and custom minimise / maximise / close buttons. Close follows the tray setting.
 * In a browser it's just a slim header.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { isMacApp, isTauri } from '../lib/platform';
import { CloseIcon, MinusIcon, RestoreWindowIcon, SquareIcon } from './icons';

async function win() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export function TitleBar({ children, title = 'Aether', lead }: { children?: ReactNode; title?: ReactNode; lead?: ReactNode }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void win().then(async (w) => {
      setMaximized(await w.isMaximized());
      unlisten = await w.onResized(async () => setMaximized(await w.isMaximized()));
    });
    return () => unlisten?.();
  }, []);

  const btn = 'grid h-8 w-11 place-items-center text-ae-muted transition-colors hover:bg-ae-hover hover:text-ae-text';
  return (
    <header data-tauri-drag-region className={`ae-titlebar relative z-[70] flex shrink-0 items-center gap-2 bg-ae-sunken text-xs select-none ${isMacApp ? 'h-9 pl-[78px]' : 'h-8 pl-3'}`}>
      {lead}
      <img data-tauri-drag-region src="/icon.svg" alt="" className="h-4 w-4" draggable={false} />
      <span data-tauri-drag-region className="font-semibold tracking-wide text-ae-muted">
        {title}
      </span>
      <div data-tauri-drag-region className="h-full flex-1" />
      {children && <div className={`flex items-center gap-1 ${isMacApp ? 'pr-2' : 'pr-1'}`}>{children}</div>}
      {isTauri && !isMacApp && (
        <div className="flex">
          <button type="button" aria-label="Minimise" className={btn} onClick={() => void win().then((w) => w.minimize())}>
            <MinusIcon size={15} />
          </button>
          <button type="button" aria-label={maximized ? 'Restore' : 'Maximise'} className={btn} onClick={() => void win().then((w) => w.toggleMaximize())}>
            {maximized ? <RestoreWindowIcon size={13} /> : <SquareIcon size={12} />}
          </button>
          <button type="button" aria-label="Close" className={`${btn} hover:!bg-[#e81123] hover:!text-white`} onClick={() => void win().then((w) => w.close())}>
            <CloseIcon size={16} />
          </button>
        </div>
      )}
    </header>
  );
}

/** Full-height column: title bar on top, `children` fill the rest. */
export function WindowFrame({ children, bar }: { children: ReactNode; bar?: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      {bar ?? <TitleBar />}
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}
