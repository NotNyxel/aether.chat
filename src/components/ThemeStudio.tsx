/**
 * "Customize your theme": a panel on the right of the app where you build your own theme and see
 * it live behind the panel: dark or light, a gradient of up to 5 colours, its direction and
 * intensity, and a moving background effect. Opened from Settings → Appearance.
 */
import { useEffect, useMemo, type CSSProperties } from 'react';
import { useEscape } from '../lib/escape';
import { DEFAULT_CUSTOM_THEME, useSettingsStore, type CustomTheme, type ThemeEffect } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import { customBackdrop } from '../theme/custom';
import { ArrowLeftIcon, CloseIcon, MoonIcon, PlusIcon, ResetIcon, ShuffleIcon, SunIcon, TrashIcon } from './icons';

export const THEME_EFFECTS: { id: ThemeEffect; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'stars', label: 'Stars' },
  { id: 'snow', label: 'Snow' },
  { id: 'petals', label: 'Petals' },
  { id: 'bubbles', label: 'Bubbles' },
  { id: 'fireflies', label: 'Fireflies' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'rain', label: 'Rain' },
];

const SURPRISE = [
  ['#02ffe9', '#f5e44a'],
  ['#ff5f6d', '#ffc371'],
  ['#7f5af0', '#2cb67d'],
  ['#ff9a9e', '#a18cd1', '#fbc2eb'],
  ['#0f2027', '#2c5364', '#00c9ff'],
  ['#f857a6', '#ff5858'],
  ['#43cea2', '#185a9d'],
  ['#ffb347', '#ff6f91', '#845ec2'],
  ['#c6ffdd', '#fbd786', '#f7797d'],
  ['#1d976c', '#93f9b9'],
  ['#6a3093', '#a044ff'],
  ['#e96443', '#904e95'],
];

function Slider({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm font-semibold">
        {label}
        <span className="text-xs font-normal text-ae-muted tabular-nums">
          {value}
          {unit}
        </span>
      </span>
      <input type="range" className="mt-2 w-full accent-[var(--ae-accent)]" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function ThemeStudio() {
  const open = useUiStore((s) => s.themeStudioOpen);
  const close = useUiStore((s) => s.closeThemeStudio);
  const openSettings = useUiStore((s) => s.openSettings);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const c = useMemo<CustomTheme>(() => ({ ...DEFAULT_CUSTOM_THEME, ...(theme.custom ?? {}) }), [theme.custom]);
  useEscape(close, open);

  // Opening the panel switches the custom theme on, so you see your changes straight away.
  useEffect(() => {
    if (open && !theme.custom?.enabled) setTheme({ custom: { ...c, enabled: true } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const set = (patch: Partial<CustomTheme>) => setTheme({ custom: { ...c, ...patch, enabled: true } });
  const setColor = (i: number, v: string) => set({ colors: c.colors.map((x, j) => (j === i ? v : x)) });

  return (
    <aside
      className="ae-theme-studio fixed top-0 right-0 bottom-0 z-[75] flex w-[300px] max-w-full flex-col border-l border-ae-border shadow-2xl"
      style={{ background: 'var(--ae-bg-solid, var(--ae-bg-elevated))' } as CSSProperties}
      aria-label="Customize your theme"
    >
      <header className="flex items-center gap-2 px-4 pt-4 pb-3">
        <h2 className="flex-1 text-base font-bold">Customize your theme</h2>
        <button type="button" aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={close}>
          <CloseIcon size={18} />
        </button>
      </header>

      <div className="ae-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Appearance</h3>
          <div className="grid grid-cols-2 gap-1 rounded-ae bg-ae-sunken p-1">
            {(['dark', 'light'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={c.mode === m}
                onClick={() => set({ mode: m })}
                className={`grid h-9 place-items-center rounded-[calc(var(--ae-radius)-2px)] ${c.mode === m ? 'bg-ae-surface text-ae-text shadow' : 'text-ae-muted hover:text-ae-text'}`}
                data-tip={m === 'dark' ? 'Dark' : 'Light'}
              >
                {m === 'dark' ? <MoonIcon size={17} /> : <SunIcon size={17} />}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Colors</h3>
          <div className="h-12 rounded-ae border border-ae-border" style={{ background: customBackdrop({ ...c, intensity: Math.max(c.intensity, 70) }) }} />
          <div className="mt-2 space-y-1.5">
            {c.colors.map((col, i) => (
              <div key={i} className="flex items-center gap-2 rounded-ae bg-ae-sunken px-2 py-1.5">
                <input type="color" value={col} onChange={(e) => setColor(i, e.target.value)} className="h-7 w-7 shrink-0 cursor-pointer rounded-md" aria-label={`Color ${i + 1}`} />
                <span className="flex-1 font-mono text-sm uppercase">{col}</span>
                {c.colors.length > 1 && (
                  <button type="button" aria-label="Remove color" className="grid h-7 w-7 place-items-center rounded text-ae-muted hover:bg-ae-hover hover:text-ae-danger" onClick={() => set({ colors: c.colors.filter((_, j) => j !== i) })}>
                    <TrashIcon size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {c.colors.length < 5 && (
            <button
              type="button"
              className="ae-press mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-ae bg-ae-surface text-sm font-semibold hover:bg-ae-hover"
              onClick={() => set({ colors: [...c.colors, SURPRISE[c.colors.length % SURPRISE.length]![0]!] })}
            >
              <PlusIcon size={15} /> Add Color
            </button>
          )}
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Controls</h3>
          <Slider label="Gradient Direction" value={c.angle} min={0} max={360} unit="°" onChange={(angle) => set({ angle })} />
          <Slider label="Color Intensity" value={c.intensity} min={0} max={100} unit="%" onChange={(intensity) => set({ intensity })} />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Background effect</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {THEME_EFFECTS.map((fx) => (
              <button
                key={fx.id}
                type="button"
                aria-pressed={c.effect === fx.id}
                onClick={() => set({ effect: fx.id })}
                className={`ae-press h-9 rounded-ae border text-sm ${c.effect === fx.id ? 'border-ae-accent bg-ae-accent/15 font-semibold' : 'border-ae-border bg-ae-sunken hover:border-ae-text/30'}`}
              >
                {fx.label}
              </button>
            ))}
          </div>
          {c.effect !== 'none' && (
            <div className="mt-3">
              <Slider label="Effect amount" value={c.effectAmount} min={10} max={100} unit="%" onChange={(effectAmount) => set({ effectAmount })} />
            </div>
          )}
        </section>
      </div>

      <footer className="space-y-2 border-t border-ae-border p-4">
        <button
          type="button"
          className="ae-press flex h-10 w-full items-center justify-center gap-2 rounded-ae bg-ae-surface text-sm font-semibold hover:bg-ae-hover"
          onClick={() => {
            const colors = SURPRISE[Math.floor(Math.random() * SURPRISE.length)]!;
            const fx = THEME_EFFECTS[Math.floor(Math.random() * THEME_EFFECTS.length)]!.id;
            set({ colors: [...colors], angle: Math.floor(Math.random() * 36) * 10, intensity: 35 + Math.floor(Math.random() * 50), effect: fx });
          }}
        >
          <ShuffleIcon size={16} /> Surprise Me!
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className="ae-press flex h-10 flex-1 items-center justify-center gap-1.5 rounded-ae text-sm text-ae-muted hover:bg-ae-hover hover:text-ae-text"
            onClick={() => setTheme({ custom: { ...DEFAULT_CUSTOM_THEME, enabled: false } })}
          >
            <ResetIcon size={14} /> Reset
          </button>
          <button
            type="button"
            className="ae-press flex h-10 flex-1 items-center justify-center gap-1.5 rounded-ae bg-ae-accent text-sm font-semibold text-ae-on-accent"
            onClick={() => {
              close();
              openSettings('appearance');
            }}
          >
            <ArrowLeftIcon size={14} /> Settings
          </button>
        </div>
      </footer>
    </aside>
  );
}
