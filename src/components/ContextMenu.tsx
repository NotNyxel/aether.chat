/**
 * Right-click menus. `openContextMenu(event, items)` from any onContextMenu handler; one layer
 * (mounted in MainLayout) renders the menu at the cursor, keeps it on screen, and closes it on
 * click, Escape, scroll or blur. Arrow keys move between items.
 */
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { create } from 'zustand';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}
export type MenuEntry = MenuItem | 'divider' | null | false | '' | 0 | undefined;

const useMenu = create<{ x: number; y: number; items: MenuEntry[] | null; set: (m: { x: number; y: number; items: MenuEntry[] | null }) => void }>()((set) => ({
  x: 0,
  y: 0,
  items: null,
  set: (m) => set(m),
}));

export function openContextMenu(e: ReactMouseEvent | MouseEvent, items: MenuEntry[]) {
  e.preventDefault();
  e.stopPropagation();
  const clean = items.filter(Boolean) as (MenuItem | 'divider')[];
  // collapse leading/trailing/double dividers
  const tidy = clean.filter((it, i) => it !== 'divider' || (i > 0 && i < clean.length - 1 && clean[i - 1] !== 'divider'));
  if (tidy.length) useMenu.getState().set({ x: e.clientX, y: e.clientY, items: tidy });
}

export function closeContextMenu() {
  useMenu.getState().set({ x: 0, y: 0, items: null });
}

export function ContextMenuLayer() {
  const { x, y, items } = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!items || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
    ref.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [items, x, y]);

  useEffect(() => {
    if (!items) return;
    const close = (e: Event) => {
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      closeContextMenu();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('contextmenu', close, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('contextmenu', close, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [items]);

  if (!items) return null;
  return (
    <div
      ref={ref}
      role="menu"
      className="ae-pop fixed z-[85] min-w-52 rounded-ae border border-ae-border bg-ae-elevated p-1.5 shadow-2xl"
      style={{ left: pos.left, top: pos.top, transformOrigin: 'top left' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {(items as (MenuItem | 'divider')[]).map((it, i) =>
        it === 'divider' ? (
          <div key={`d${i}`} className="my-1 h-px bg-ae-border" />
        ) : (
          <button
            key={`${it.label}${i}`}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              closeContextMenu();
              it.onClick?.();
            }}
            className={`flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-sm outline-none disabled:opacity-40 ${
              it.danger ? 'text-ae-danger hover:bg-ae-danger hover:text-white focus:bg-ae-danger focus:text-white' : 'hover:bg-ae-accent hover:text-ae-on-accent focus:bg-ae-accent focus:text-ae-on-accent'
            }`}
          >
            <span className="flex-1">{it.label}</span>
            {it.hint && <span className="text-[11px] opacity-60">{it.hint}</span>}
            {it.icon && <span className="w-4 text-center opacity-80">{it.icon}</span>}
          </button>
        ),
      )}
    </div>
  );
}
