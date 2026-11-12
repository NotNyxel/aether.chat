/**
 * "Share your screen": pick what kind of thing to share, resolution, frame rate (24 / 30 / 60 or
 * any custom value), what to optimise for and whether to include audio, then Go Live. The system
 * then asks for the exact screen or window. Choices are remembered as your defaults.
 */
import { useState, type ReactNode } from 'react';
import type { ScreenContent, ScreenResolution, ScreenShareOptions, ScreenSurface } from '../hooks/useVoiceEngine';
import { useEscape } from '../lib/escape';
import { isTauri } from '../lib/platform';
import { useSettingsStore } from '../stores/settingsStore';
import { AppWindowIcon, CloseIcon, GlobeIcon, LiveIcon, MonitorIcon, VolumeIcon } from './icons';

const SURFACES: { id: ScreenSurface; label: string; hint: string; icon: ReactNode; web?: boolean }[] = [
  { id: 'monitor', label: 'Entire screen', hint: 'Everything on one display', icon: <MonitorIcon size={22} /> },
  { id: 'window', label: 'Application', hint: 'One app window only', icon: <AppWindowIcon size={22} /> },
  { id: 'browser', label: 'Browser tab', hint: 'A tab in this browser', icon: <GlobeIcon size={22} />, web: true },
];
const RES: { id: ScreenResolution; label: string; hint: string }[] = [
  { id: '720p', label: '720p', hint: 'Light' },
  { id: '1080p', label: '1080p', hint: 'Sharp' },
  { id: '1440p', label: '1440p', hint: 'Crisp' },
  { id: 'source', label: 'Source', hint: 'Full res' },
];
const FPS = [24, 30, 60];
const CONTENT: { id: ScreenContent; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'detail', label: 'Text & detail' },
  { id: 'motion', label: 'Motion & games' },
];

export function ScreenShareDialog({ onStart, onClose }: { onStart: (o: ScreenShareOptions) => void; onClose: () => void }) {
  const saved = useSettingsStore((s) => s.screen);
  const setScreen = useSettingsStore((s) => s.setScreen);
  const [o, setO] = useState<ScreenShareOptions>({ surface: 'monitor', content: 'auto', ...saved });
  const [custom, setCustom] = useState(!FPS.includes(saved.frameRate));
  const set = (patch: Partial<ScreenShareOptions>) => setO((cur) => ({ ...cur, ...patch }));
  useEscape(onClose);

  const go = () => {
    const frameRate = Math.round(Math.min(120, Math.max(5, Number(o.frameRate) || 30)));
    const final = { ...o, frameRate };
    setScreen(final);
    onStart(final);
  };
  const seg = (on: boolean) =>
    `ae-press rounded-ae border px-3 py-2 text-left transition-colors ${on ? 'border-ae-accent bg-ae-accent/12 text-ae-text' : 'border-ae-border text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`;
  const label = 'mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase';

  return (
    <div className="ae-backdrop fixed inset-0 z-[60] grid place-items-center bg-black/65 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Share your screen" className="ae-dialog ae-scroll max-h-[calc(100vh-32px)] w-full max-w-lg overflow-y-auto rounded-[calc(var(--ae-radius)+6px)] border border-ae-border bg-ae-elevated shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-start gap-3 px-6 pt-6">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ae-accent/15 text-ae-accent">
            <LiveIcon size={20} />
          </span>
          <div className="flex-1">
            <h2 className="text-lg font-bold">Share your screen</h2>
            <p className="text-sm text-ae-muted">Pick how it looks. Next you choose the exact screen or window.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="-mt-1 -mr-2 grid h-8 w-8 place-items-center rounded-full text-ae-muted hover:bg-ae-hover hover:text-ae-text">
            <CloseIcon size={16} />
          </button>
        </header>

        <div className="space-y-5 px-6 py-5">
          <div>
            <p className={label}>What to share</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SURFACES.filter((x) => !x.web || !isTauri).map((x) => (
                <button key={x.id} type="button" onClick={() => set({ surface: x.id })} className={`${seg(o.surface === x.id)} flex flex-col items-start gap-1.5 py-3`}>
                  <span className={o.surface === x.id ? 'text-ae-accent' : ''}>{x.icon}</span>
                  <span className="text-sm font-semibold text-ae-text">{x.label}</span>
                  <span className="text-xs">{x.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className={label}>Resolution</p>
            <div className="grid grid-cols-4 gap-1.5">
              {RES.map((r) => (
                <button key={r.id} type="button" onClick={() => set({ resolution: r.id })} className={seg(o.resolution === r.id)}>
                  <span className="block text-sm font-semibold text-ae-text">{r.label}</span>
                  <span className="text-[11px]">{r.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className={label}>Frame rate</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {FPS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setCustom(false);
                    set({ frameRate: f });
                  }}
                  className={`${seg(!custom && o.frameRate === f)} min-w-16 text-center text-sm font-semibold`}
                >
                  {f} FPS
                </button>
              ))}
              <button type="button" onClick={() => setCustom(true)} className={`${seg(custom)} text-sm font-semibold`}>
                Custom
              </button>
              {custom && (
                <span className="flex items-center gap-1.5 text-sm text-ae-muted">
                  <input
                    autoFocus
                    className="ae-input w-20 !py-1.5 text-center"
                    inputMode="numeric"
                    value={o.frameRate || ''}
                    onChange={(e) => set({ frameRate: Number(e.target.value.replace(/\D/g, '').slice(0, 3)) })}
                  />
                  FPS (5–120)
                </span>
              )}
            </div>
          </div>

          <div>
            <p className={label}>Optimise for</p>
            <div className="flex gap-1.5">
              {CONTENT.map((c) => (
                <button key={c.id} type="button" onClick={() => set({ content: c.id })} className={`${seg((o.content ?? 'auto') === c.id)} flex-1 text-center text-sm font-semibold`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-ae border border-ae-border px-3 py-2.5">
            <VolumeIcon size={18} className="text-ae-muted" />
            <span className="flex-1">
              <span className="block text-sm font-semibold">Share audio</span>
              <span className="block text-xs text-ae-muted">{o.surface === 'window' ? 'Windows only shares audio from a whole screen or a browser tab.' : 'Include the sound from what you share.'}</span>
            </span>
            <input type="checkbox" className="h-4 w-4" checked={o.includeAudio} onChange={(e) => set({ includeAudio: e.target.checked })} />
          </label>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-ae-border bg-ae-sunken/40 px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover">
            Cancel
          </button>
          <button type="button" onClick={go} className="ae-press flex items-center gap-1.5 rounded-ae bg-ae-accent px-5 py-2 text-sm font-semibold text-ae-on-accent">
            <LiveIcon size={15} /> Go Live
          </button>
        </footer>
      </div>
    </div>
  );
}
