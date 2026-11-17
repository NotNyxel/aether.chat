/**
 * Custom layout editor (2.1): edits the real app in place. Each panel gets an outline and a
 * handle: drag a handle sideways to move that panel, drag the bar on a panel's edge to resize it.
 * A floating toolbar picks the base layout and the panel style. Everything saves as you go.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEscape } from '../lib/escape';
import { t } from '../lib/i18n';
import { DEFAULT_CUSTOM_LAYOUT, useSettingsStore, type BaseLayoutId, type CustomLayout, type LayoutPanel } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import { CheckIcon, EyeOffIcon, GripIcon } from './icons';
import { toast } from './Toaster';

const NAMES: Record<LayoutPanel, string> = { rail: 'Spaces bar', list: 'Chat list', main: 'Chat' };
const BASES: { id: BaseLayoutId; name: string }[] = [
  { id: 'classic', name: 'Classic' },
  { id: 'orbit', name: 'Orbit' },
  { id: 'lounge', name: 'Lounge' },
  { id: 'workspace', name: 'Workspace' },
];

type Rect = { left: number; top: number; width: number; height: number };

/** The saved custom layout right now (outside React, for drag handlers). */
const current = (): CustomLayout => ({ ...DEFAULT_CUSTOM_LAYOUT, ...useSettingsStore.getState().theme.customLayout });

function useCustomLayout(): [CustomLayout, (patch: Partial<CustomLayout>) => void] {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const cl = { ...DEFAULT_CUSTOM_LAYOUT, ...theme.customLayout };
  const set = useCallback(
    (patch: Partial<CustomLayout>) => {
      setTheme({ layout: 'custom', customLayout: { ...current(), ...patch } });
    },
    [setTheme],
  );
  return [cl, set];
}

/** Where each panel is on screen right now (re-measured as things move). */
function usePanelRects(deps: unknown[]): { panels: Map<LayoutPanel, Rect>; details: Rect | null } {
  const [state, setState] = useState<{ panels: Map<LayoutPanel, Rect>; details: Rect | null }>({ panels: new Map(), details: null });
  const measure = useCallback(() => {
    const panels = new Map<LayoutPanel, Rect>();
    for (const el of document.querySelectorAll<HTMLElement>('.ae-shell > [data-panel]')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) panels.set(el.dataset.panel as LayoutPanel, { left: r.left, top: r.top, width: r.width, height: r.height });
    }
    const d = document.querySelector<HTMLElement>('.ae-chat-body > aside')?.getBoundingClientRect();
    setState({ panels, details: d && d.width > 0 ? { left: d.left, top: d.top, width: d.width, height: d.height } : null });
  }, []);
  useLayoutEffect(() => measure(), deps);
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    document.querySelectorAll('.ae-shell, .ae-shell > [data-panel]').forEach((el) => ro.observe(el));
    window.addEventListener('resize', measure);
    const t = setInterval(measure, 400); // panels appearing (details opened) aren't observed yet
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      clearInterval(t);
    };
  }, [measure]);
  return state;
}

/** Drag-to-resize bar on a panel edge. */
function ResizeBar({ rect, side, label, onResize }: { rect: Rect; side: 'left' | 'right'; label: string; onResize: (dx: number) => void }) {
  const start = useRef<number | null>(null);
  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = e.clientX;
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (start.current === null) return;
    onResize(e.clientX - start.current);
    start.current = e.clientX;
  };
  const up = () => (start.current = null);
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onResize(-16);
        if (e.key === 'ArrowRight') onResize(16);
      }}
      className="group fixed z-[96] flex w-4 cursor-col-resize justify-center"
      style={{ left: (side === 'right' ? rect.left + rect.width : rect.left) - 8, top: rect.top + rect.height / 2 - 40, height: 80 }}
    >
      <span className="h-full w-1.5 rounded-full bg-ae-accent opacity-70 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}

export function LayoutEditor() {
  const setEditing = useUiStore((s) => s.setLayoutEditing);
  const [cl, set] = useCustomLayout();
  const { panels, details } = usePanelRects([cl.order.join(), cl.listWidth, cl.detailsWidth, cl.detailsSide, cl.floating, cl.gap, cl.showRail, cl.base]);
  const drag = useRef<{ panel: LayoutPanel; x: number } | null>(null);
  const [dragging, setDragging] = useState<LayoutPanel | null>(null);
  const [detailsOn, setDetailsOn] = useState(() => {
    try {
      return localStorage.getItem('aether.dmProfilePanel') !== '0';
    } catch {
      return true;
    }
  });
  const setDetails = (on: boolean) => {
    setDetailsOn(on);
    try {
      localStorage.setItem('aether.dmProfilePanel', on ? '1' : '0');
    } catch {
      /* not saved */
    }
    window.dispatchEvent(new CustomEvent('aether-details-panel', { detail: on }));
    const ui = useUiStore.getState();
    if (ui.memberListOpen !== on) ui.toggleMemberList();
  };
  const done = () => {
    setEditing(false);
    toast.success(t('Layout saved'));
  };
  useEscape(done);

  // Moving a panel: as the pointer passes another panel's middle, they swap places.
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const order = [...current().order];
    const i = order.indexOf(d.panel);
    const neighbour = e.clientX > d.x ? order[i + 1] : order[i - 1];
    const r = neighbour ? panels.get(neighbour) : undefined;
    if (!neighbour || !r) return;
    const mid = r.left + r.width / 2;
    if ((e.clientX > d.x && e.clientX > mid) || (e.clientX < d.x && e.clientX < mid)) {
      const j = order.indexOf(neighbour);
      [order[i], order[j]] = [order[j]!, order[i]!];
      set({ order });
      drag.current = { panel: d.panel, x: e.clientX };
    }
  };
  useEffect(() => {
    const up = () => {
      drag.current = null;
      setDragging(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
    };
  });

  const listRect = panels.get('list');
  const listFacesRight = cl.order.indexOf('list') < cl.order.indexOf('main');
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const chip = (on: boolean) => `ae-press rounded-full px-3 py-1 text-xs font-semibold ${on ? 'bg-ae-accent text-ae-on-accent' : 'bg-ae-surface text-ae-muted hover:text-ae-text'}`;
  const railAllowed = cl.base === 'classic' || cl.base === 'orbit';

  return (
    <>
      {/* Outlines and move handles over each panel. */}
      {[...panels.entries()].map(([panel, r]) => (
        <div key={panel} className="pointer-events-none fixed z-[95] rounded-[10px] border-2 border-dashed border-ae-accent bg-ae-accent/5" style={{ left: r.left, top: r.top, width: r.width, height: r.height }}>
          {panel !== 'main' && (
            <button
              type="button"
              aria-label={t('Hide {name}', { name: t(NAMES[panel]) })}
              title={t('Hide {name}', { name: t(NAMES[panel]) })}
              className="pointer-events-auto absolute top-11 left-1/2 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full bg-ae-elevated text-ae-text shadow-lg ring-1 ring-ae-border hover:bg-ae-hover"
              onClick={() => set(panel === 'rail' ? { showRail: false } : { showList: false })}
            >
              <EyeOffIcon size={14} />
            </button>
          )}
          <button
            type="button"
            className={`pointer-events-auto absolute top-2 left-1/2 flex -translate-x-1/2 cursor-grab items-center gap-1.5 rounded-full bg-ae-accent px-3 py-1.5 text-xs font-bold whitespace-nowrap text-ae-on-accent shadow-lg active:cursor-grabbing ${dragging === panel ? 'scale-105' : ''}`}
            aria-label={t('Move {name}', { name: t(NAMES[panel]) })}
            onPointerDown={(e) => {
              e.preventDefault();
              drag.current = { panel, x: e.clientX };
              setDragging(panel);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              const order = [...cl.order];
              const i = order.indexOf(panel);
              const j = e.key === 'ArrowLeft' ? i - 1 : i + 1;
              if (j < 0 || j >= order.length) return;
              [order[i], order[j]] = [order[j]!, order[i]!];
              set({ order });
            }}
          >
            {r.width > 90 ? (
              <>
                <GripIcon size={13} /> {t(NAMES[panel])}
              </>
            ) : (
              <GripIcon size={13} />
            )}
          </button>
        </div>
      ))}
      {panels.get('rail') && (
        <ResizeBar
          rect={panels.get('rail')!}
          side={cl.order.indexOf('rail') < cl.order.indexOf('main') ? 'right' : 'left'}
          label={t('Resize the spaces bar')}
          onResize={(dx) => set({ railWidth: clamp(current().railWidth + (cl.order.indexOf('rail') < cl.order.indexOf('main') ? dx : -dx), 60, 104) })}
        />
      )}
      {listRect && (
        <ResizeBar rect={listRect} side={listFacesRight ? 'right' : 'left'} label={t('Resize the chat list')} onResize={(dx) => set({ listWidth: clamp(current().listWidth + (listFacesRight ? dx : -dx), 180, 440) })} />
      )}
      {details && (
        <>
          <div className="pointer-events-none fixed z-[95] rounded-[10px] border-2 border-dashed border-ae-accent/70" style={details} />
          <ResizeBar
            rect={details}
            side={cl.detailsSide === 'right' ? 'left' : 'right'}
            label={t('Resize the profile and members panel')}
            onResize={(dx) => set({ detailsWidth: clamp(current().detailsWidth + (cl.detailsSide === 'right' ? -dx : dx), 220, 440) })}
          />
        </>
      )}

      {/* The toolbar. */}
      <div role="dialog" aria-label={t('Edit layout')} className="ae-pop fixed bottom-6 left-1/2 z-[97] flex w-[min(940px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-3 rounded-[18px] border border-ae-border bg-ae-elevated p-4 shadow-2xl">
        <div className="flex flex-wrap items-center gap-2">
          <b className="mr-2 text-sm">{t('Edit layout')}</b>
          <span className="text-xs text-ae-muted">{t('Built on')}</span>
          {BASES.map((b) => (
            <button key={b.id} type="button" aria-pressed={cl.base === b.id} className={chip(cl.base === b.id)} onClick={() => set({ base: b.id })}>
              {b.name}
            </button>
          ))}
          <div className="flex-1" />
          <button
            type="button"
            className="rounded-ae px-3 py-1.5 text-sm text-ae-muted hover:bg-ae-hover hover:text-ae-text"
            onClick={() => set({ ...DEFAULT_CUSTOM_LAYOUT, base: cl.base })}
          >
            {t('Reset')}
          </button>
          <button type="button" className="flex items-center gap-1.5 rounded-ae bg-ae-accent px-4 py-1.5 text-sm font-semibold text-ae-on-accent" onClick={done}>
            <CheckIcon size={14} /> {t('Done')}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <label className={`flex items-center gap-2 ${railAllowed ? '' : 'opacity-50'}`} title={railAllowed ? undefined : t('This base layout shows spaces its own way.')}>
            <input type="checkbox" disabled={!railAllowed} checked={cl.showRail} onChange={(e) => set({ showRail: e.target.checked })} />
            {t('Spaces bar')}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={cl.showList} onChange={(e) => set({ showList: e.target.checked })} />
            {t('Chat list')}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={detailsOn} onChange={(e) => setDetails(e.target.checked)} />
            {t('Profile panel')}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={cl.floating} onChange={(e) => set({ floating: e.target.checked })} />
            {t('Floating panels')}
          </label>
          <span className="flex items-center gap-1.5">
            {t('Profile side')}
            <button type="button" aria-pressed={cl.detailsSide === 'left'} className={chip(cl.detailsSide === 'left')} onClick={() => set({ detailsSide: 'left' })}>
              {t('Left')}
            </button>
            <button type="button" aria-pressed={cl.detailsSide === 'right'} className={chip(cl.detailsSide === 'right')} onClick={() => set({ detailsSide: 'right' })}>
              {t('Right')}
            </button>
          </span>
          <label className={`flex items-center gap-2 ${cl.floating ? '' : 'opacity-50'}`}>
            {t('Roundness')}
            <input type="range" min={0} max={28} value={cl.radius} disabled={!cl.floating} onChange={(e) => set({ radius: Number(e.target.value) })} className="w-24 accent-[var(--ae-accent)]" />
          </label>
          <label className="flex items-center gap-2">
            {t('Message width')}
            <input
              type="range"
              min={0}
              max={1400}
              step={40}
              value={cl.mainMaxWidth || 1400}
              onChange={(e) => set({ mainMaxWidth: Number(e.target.value) >= 1400 ? 0 : Math.max(560, Number(e.target.value)) })}
              className="w-24 accent-[var(--ae-accent)]"
            />
            <span className="w-10 text-ae-muted">{cl.mainMaxWidth ? `${cl.mainMaxWidth}` : t('Full')}</span>
          </label>
          <label className={`flex items-center gap-2 ${cl.floating ? '' : 'opacity-50'}`}>
            {t('Spacing')}
            <input type="range" min={0} max={24} value={cl.gap} disabled={!cl.floating} onChange={(e) => set({ gap: Number(e.target.value) })} className="w-24 accent-[var(--ae-accent)]" />
          </label>
        </div>
        <p className="text-xs text-ae-muted">{t('Drag a handle to move a panel, the accent bar on its edge to resize it, or the eye to hide it. Untick a panel above to hide it, tick it to bring it back.')}</p>
      </div>
    </>
  );
}
