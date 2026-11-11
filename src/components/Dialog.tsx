/** Small modal primitives shared by server and channel creation flows. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ae-backdrop fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ae-panel ae-dialog w-full max-w-md space-y-4 rounded-ae border border-ae-border p-6 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function PromptForm(props: {
  label: string;
  placeholder?: string;
  submitLabel: string;
  pending?: boolean;
  error?: string | null;
  extra?: ReactNode;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) props.onSubmit(value.trim());
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">{props.label}</span>
        <input
          autoFocus
          className="w-full rounded-ae border border-ae-border bg-ae-sunken px-3 py-2 text-sm outline-none focus:border-ae-accent"
          placeholder={props.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {props.extra}
      {props.error && <p className="text-sm text-ae-danger">{props.error}</p>}
      <button
        type="submit"
        disabled={props.pending || !value.trim()}
        className="w-full rounded-ae bg-ae-accent py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-40"
      >
        {props.pending ? 'Working…' : props.submitLabel}
      </button>
    </form>
  );
}
