/**
 * In-app replacements for window.confirm and window.prompt (which WebView2 renders as bare
 * "tauri.localhost says" boxes).
 *   await ask('Delete this?', { danger: true })            → true / false
 *   await promptText('Nickname', { initial: 'Bob' })        → the text, or null if cancelled
 */
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

interface AskOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface PromptOptions extends AskOptions {
  initial?: string;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
}
interface Pending extends PromptOptions {
  message: string;
  input: boolean;
  resolve: (value: string | null) => void;
}

const useAsk = create<{ pending: Pending | null; set: (p: Pending | null) => void }>()((set) => ({ pending: null, set: (pending) => set({ pending }) }));

function open(p: Omit<Pending, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    useAsk.getState().pending?.resolve(null);
    useAsk.getState().set({ ...p, resolve });
  });
}

export function ask(message: string, options: AskOptions = {}): Promise<boolean> {
  return open({ message, input: false, ...options }).then((v) => v !== null);
}

export function promptText(message: string, options: PromptOptions = {}): Promise<string | null> {
  return open({ message, input: true, ...options });
}

export function ConfirmLayer() {
  const pending = useAsk((s) => s.pending);
  const set = useAsk((s) => s.set);
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const done = (ok: boolean) => {
    pending?.resolve(ok ? (pending.input ? value : '') : null);
    set(null);
  };
  useEffect(() => {
    if (!pending) return;
    setValue(pending.initial ?? '');
    requestAnimationFrame(() => {
      if (pending.input) {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else okRef.current?.focus();
    });
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
  const danger = pending.danger ?? (!pending.input && /delete|remove|ban|kick|block|leave|transfer|sign out|turn off/i.test(pending.message));
  return (
    <div className="ae-backdrop fixed inset-0 z-[95] grid place-items-center bg-black/60 p-4" onMouseDown={() => done(false)}>
      <form
        role="alertdialog"
        aria-modal="true"
        className="ae-dialog ae-panel w-full max-w-sm space-y-4 rounded-ae border border-ae-border p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          done(true);
        }}
      >
        <h2 className="text-lg font-bold">{pending.title ?? (pending.input ? pending.message : danger ? 'Are you sure?' : 'Confirm')}</h2>
        {(!pending.input || pending.title) && <p className="text-sm whitespace-pre-line text-ae-muted">{pending.message}</p>}
        {pending.input &&
          (pending.multiline ? (
            <textarea
              ref={inputRef}
              className="ae-input min-h-20 w-full"
              value={value}
              maxLength={pending.maxLength}
              placeholder={pending.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  done(true);
                }
              }}
            />
          ) : (
            <input ref={inputRef} className="ae-input w-full" value={value} maxLength={pending.maxLength} placeholder={pending.placeholder} onChange={(e) => setValue(e.target.value)} />
          ))}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover" onClick={() => done(false)}>
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button ref={okRef} type="submit" className={`ae-press rounded-ae px-4 py-2 text-sm font-semibold ${danger ? 'bg-ae-danger text-white' : 'bg-ae-accent text-ae-on-accent'}`}>
            {pending.confirmLabel ?? (pending.input ? 'Save' : danger ? 'Yes, do it' : 'OK')}
          </button>
        </div>
      </form>
    </div>
  );
}
