/**
 * Toasts: short confirmations and errors in the bottom-right corner ("Link copied", "Saved",
 * "Blocked by AutoMod"). Call `toast('Saved')` or `toast.error('Couldn't save')` from anywhere.
 */
import { create } from 'zustand';

type Tone = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
  icon?: string;
}

const useToasts = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, 'id'>) => void; dismiss: (id: number) => void }>()((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), t.tone === 'error' ? 6000 : 3200);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

export function toast(text: string, icon?: string) {
  useToasts.getState().push({ text, tone: 'info', icon });
}
toast.success = (text: string, icon = '✓') => useToasts.getState().push({ text, tone: 'success', icon });
toast.error = (text: string, icon = '⚠') => useToasts.getState().push({ text, tone: 'error', icon });

export function Toaster() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[80] flex flex-col items-end gap-2" role="status" aria-live="polite">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`ae-toast pointer-events-auto flex max-w-sm items-center gap-2 rounded-ae border px-3.5 py-2.5 text-left text-sm shadow-2xl backdrop-blur ${
            t.tone === 'error'
              ? 'border-ae-danger/50 bg-ae-elevated text-ae-text'
              : t.tone === 'success'
                ? 'border-ae-success/40 bg-ae-elevated text-ae-text'
                : 'border-ae-border bg-ae-elevated text-ae-text'
          }`}
        >
          {t.icon && (
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${t.tone === 'error' ? 'bg-ae-danger/20 text-ae-danger' : t.tone === 'success' ? 'bg-ae-success/20 text-ae-success' : 'bg-ae-surface'}`}>
              {t.icon}
            </span>
          )}
          {t.text}
        </button>
      ))}
    </div>
  );
}
