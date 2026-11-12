/**
 * Themed replacements for the browser's own popups. NativeUiShim intercepts <select>,
 * <input type="color"> and date/time inputs, opens one of these instead, and writes the chosen
 * value back to the element (firing the same events React listens for), so every existing form
 * keeps working unchanged.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from './icons';

/** Sets a form element's value the way a user edit would, so React's onChange fires. */
export function commitValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function usePopoverPosition(anchor: DOMRect, width: number, height: number) {
  const below = anchor.bottom + 6 + height < window.innerHeight;
  return {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
    top: below ? anchor.bottom + 6 : Math.max(8, anchor.top - height - 6),
  };
}

function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    const scroll = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose, ref]);
}

// ── Select ─────────────────────────────────────────────────────────────────────────────────

export function SelectPopover({ el, onClose }: { el: HTMLSelectElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const options = useMemo(() => [...el.options].map((o) => ({ value: o.value, label: o.textContent ?? o.value, disabled: o.disabled })), [el]);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === el.value)));
  const rect = el.getBoundingClientRect();
  const width = Math.max(rect.width, 180);
  const height = Math.min(320, options.length * 34 + 12);
  const pos = usePopoverPosition(rect, width, height);
  useDismiss(ref, onClose);

  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    commitValue(el, o.value);
    onClose();
    el.focus();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(options.length - 1, a + 1)));
      else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
      else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), pick(active));
      else if (e.key === 'Tab') onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      ref={ref}
      role="listbox"
      className="ae-pop ae-scroll fixed z-[96] overflow-y-auto rounded-ae border border-ae-border bg-ae-elevated p-1.5 shadow-2xl"
      style={{ left: pos.left, top: pos.top, width, maxHeight: 320 }}
    >
      {options.map((o, i) => (
        <button
          key={`${o.value}-${i}`}
          data-i={i}
          type="button"
          role="option"
          aria-selected={o.value === el.value}
          disabled={o.disabled}
          onMouseEnter={() => setActive(i)}
          onClick={() => pick(i)}
          className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm disabled:opacity-40 ${i === active ? 'bg-ae-accent text-ae-on-accent' : ''}`}
        >
          <span className="flex-1 truncate">{o.label}</span>
          {o.value === el.value && <CheckIcon size={14} />}
        </button>
      ))}
    </div>
  );
}

// ── Colour ─────────────────────────────────────────────────────────────────────────────────

function hexToHsv(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}
function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const SWATCHES = ['#7c5cff', '#5865f2', '#00d4ff', '#2ee6d6', '#3ddc84', '#f5b942', '#ff8a4c', '#ff5c6c', '#ff3cac', '#e0569b', '#ffffff', '#0b0b0f'];

export function ColorPopover({ el, onClose }: { el: HTMLInputElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hsv, setHsv] = useState(() => hexToHsv(el.value || '#7c5cff'));
  const [text, setText] = useState(el.value);
  const rect = el.getBoundingClientRect();
  const pos = usePopoverPosition(rect, 236, 300);
  useDismiss(ref, onClose);
  const hex = hsvToHex(...hsv);
  const live = (next: [number, number, number]) => {
    setHsv(next);
    const h = hsvToHex(...next);
    setText(h);
    commitValue(el, h);
  };
  const drag = (e: React.PointerEvent, area: 'sv' | 'hue') => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const x = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height));
      setHsv((cur) => {
        const next: [number, number, number] = area === 'sv' ? [cur[0], x, 1 - y] : [x * 360, cur[1], cur[2]];
        const h = hsvToHex(...next);
        setText(h);
        commitValue(el, h);
        return next;
      });
    };
    move(e.nativeEvent);
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div ref={ref} className="ae-pop fixed z-[96] w-[236px] space-y-3 rounded-ae border border-ae-border bg-ae-elevated p-3 shadow-2xl" style={pos}>
      <div
        className="relative h-36 cursor-crosshair rounded-md"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv[0]} 100% 50%))` }}
        onPointerDown={(e) => drag(e, 'sv')}
      >
        <span
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: hex }}
        />
      </div>
      <div
        className="relative h-3 cursor-pointer rounded-full"
        style={{ background: 'linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)' }}
        onPointerDown={(e) => drag(e, 'hue')}
      >
        <span className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${(hsv[0] / 360) * 100}%`, background: `hsl(${hsv[0]} 100% 50%)` }} />
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {SWATCHES.map((c) => (
          <button key={c} type="button" aria-label={c} className="h-6 rounded-md border border-ae-border" style={{ background: c }} onClick={() => live(hexToHsv(c))} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="h-8 w-8 shrink-0 rounded-md border border-ae-border" style={{ background: hex }} />
        <input
          className="ae-input w-full !py-1.5 font-mono text-sm"
          value={text}
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) live(hexToHsv(e.target.value));
          }}
        />
      </div>
    </div>
  );
}

// ── Date & time ────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function DateTimePopover({ el, onClose }: { el: HTMLInputElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const withTime = el.type === 'datetime-local';
  const initial = el.value ? new Date(el.value) : new Date();
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [picked, setPicked] = useState(initial);
  const rect = el.getBoundingClientRect();
  const pos = usePopoverPosition(rect, 280, withTime ? 380 : 320);
  useDismiss(ref, onClose);

  const write = (d: Date) => {
    setPicked(d);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    commitValue(el, withTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date);
  };
  const first = (month.getDay() + 6) % 7;
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const today = new Date();

  return (
    <div ref={ref} className="ae-pop fixed z-[96] w-[280px] space-y-3 rounded-ae border border-ae-border bg-ae-elevated p-3 shadow-2xl" style={pos}>
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Previous month" className="grid h-7 w-7 place-items-center rounded-md hover:bg-ae-hover" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeftIcon size={16} />
        </button>
        <span className="text-sm font-semibold">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button type="button" aria-label="Next month" className="grid h-7 w-7 place-items-center rounded-md hover:bg-ae-hover" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRightIcon size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ae-muted">
        {DAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <span key={`e${i}`} />
          ) : (
            <button
              key={day}
              type="button"
              onClick={() => write(new Date(month.getFullYear(), month.getMonth(), day, picked.getHours(), picked.getMinutes()))}
              className={`grid h-8 place-items-center rounded-md text-sm ${
                picked.getFullYear() === month.getFullYear() && picked.getMonth() === month.getMonth() && picked.getDate() === day
                  ? 'bg-ae-accent font-bold text-ae-on-accent'
                  : today.toDateString() === new Date(month.getFullYear(), month.getMonth(), day).toDateString()
                    ? 'text-ae-accent ring-1 ring-ae-accent'
                    : 'text-ae-text hover:bg-ae-hover'
              }`}
            >
              {day}
            </button>
          ),
        )}
      </div>
      {withTime && (
        <div className="flex items-center gap-2 border-t border-ae-border pt-3">
          <span className="text-xs text-ae-muted">Time</span>
          <input
            className="ae-input w-16 !py-1 text-center"
            inputMode="numeric"
            value={pad(picked.getHours())}
            onChange={(e) => {
              const h = Math.min(23, Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0));
              write(new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), h, picked.getMinutes()));
            }}
          />
          <span>:</span>
          <input
            className="ae-input w-16 !py-1 text-center"
            inputMode="numeric"
            value={pad(picked.getMinutes())}
            onChange={(e) => {
              const m = Math.min(59, Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0));
              write(new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), picked.getHours(), m));
            }}
          />
          <button type="button" className="ae-press ml-auto rounded-md bg-ae-accent px-3 py-1 text-xs font-semibold text-ae-on-accent" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
