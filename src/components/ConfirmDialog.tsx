/**
 * In-app replacement for window.confirm (which WebView2 renders as a bare "tauri.localhost says"
 * box). `await ask('Delete this?', { danger: true })` resolves true/false.
 */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

interface AskOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface Pending extends AskOptions {
  message: string;
  resolve: (ok: boolean) => void;
}

const useAsk = create<{ pending: Pending | null; set: (p: Pending | null) => void }>()((set) => ({ pending: null, set: (pending) => set({ pending }) }));

export function ask(message: string, options: AskOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useAsk.getState().pending?.resolve(false);
    useAsk.getState().set({ message, resolve, ...options });
  });
}

export function ConfirmLayer() {
  const pending = useAsk((s) => s.pending);
  const set = useAsk((s) => s.set);
  const okRef = useRef<HTMLButtonElement>(null);
  const done = (ok: boolean) => {
    pending?.resolve(ok);
    set(null);
  };
  useEffect(() => {
    if (!pending) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  if (!pending) return null;
  const danger = pending.danger ?? /delete|remove|ban|kick|block|leave|transfer|sign out|turn off/i.test(pending.message);
  return (
    <div className="ae-backdrop fixed inset-0 z-[95] grid place-items-center bg-black/60 p-4" onMouseDown={() => done(false)}>
      <div role="alertdialog" aria-modal="true" className="ae-dialog ae-panel w-full max-w-sm space-y-4 rounded-ae border border-ae-border p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{pending.title ?? (danger ? 'Are you sure?' : 'Confirm')}</h2>
        <p className="text-sm whitespace-pre-line text-ae-muted">{pending.message}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover" onClick={() => done(false)}>
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={okRef}
            type="button"
            className={`ae-press rounded-ae px-4 py-2 text-sm font-semibold ${danger ? 'bg-ae-danger text-white' : 'bg-ae-accent text-ae-on-accent'}`}
            onClick={() => done(true)}
          >
            {pending.confirmLabel ?? (danger ? 'Yes, do it' : 'OK')}
          </button>
        </div>
      </div>
    </div>
  );
}
