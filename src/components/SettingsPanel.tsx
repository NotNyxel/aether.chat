/**
 * Settings suite: a full-screen modal with these tabs (plus Notifications, Windows and Activity
 * Privacy from SettingsDesktop.tsx):
 *   Profile    : edit every profile field, upload media, live ProfileCard preview, save to Supabase
 *   Appearance : theme presets, accent override or profile accent, reduce motion, custom CSS editor
 *   Voice      : input/output devices, live mic meter with noise-gate threshold, processing toggles
 *   Keybinds   : record shortcuts for mute, deafen and push-to-talk
 *   Bandwidth  : audio/video bitrate profile and screen-share resolution and frame-rate defaults
 * Audio settings live in the settings store. MainLayout pushes changes into the running voice engine.
 */
import { AccountTab, PrivacyTab } from './SettingsAccount';
import { ProfileEditor } from './ProfileEditor';
import { AdminTab } from './AdminPanel';
import { useProfile } from '../hooks/useChatData';
import { useEffect, useState, type ReactNode } from 'react';
import { listAudioDevices, type BandwidthProfile, type ScreenFrameRate, type ScreenResolution } from '../hooks/useVoiceEngine';
import { comboFromEvent, formatCombo } from '../lib/keybinds';
import { ALL_SOUNDS, playSound, SOUND_INFO } from '../lib/sounds';
import { useSettingsStore, type Keybinds } from '../stores/settingsStore';
import { useUiStore, type SettingsTab } from '../stores/uiStore';
import { isHexColor, PRESET_ORDER, THEME_PRESETS } from '../theme/presets';
import { AdminIcon, AppWindowIcon, BellIcon, CloseIcon, GameIcon, IdCardIcon, KeyboardIcon, LogOutIcon, NetworkIcon, PaletteIcon, ShieldIcon, StageIcon, UserIcon } from './icons';
import { ActivityTab, BackgroundShortcutsSection, DesktopNotificationsSection, WindowsTab } from './SettingsDesktop';
import { useTheme } from './ThemeEngine';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shared form primitives
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-ae-border pb-6 last:border-0">
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-ae-muted">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ae-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = 'ae-input w-full';

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-ae-muted">{hint}</span>}
      </span>
      <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <Field label={`${props.label}: ${props.format(props.value)}`} hint={props.hint}>
      <input
        type="range"
        className="w-full"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </Field>
  );
}

/** A row of pill buttons for picking one option. */
export function Chips<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`ae-press rounded-ae border px-3 py-1.5 text-xs ${value === o.id ? 'border-ae-accent bg-ae-accent/15' : 'border-ae-border hover:bg-ae-hover'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          className="h-9 w-12 cursor-pointer rounded border border-ae-border bg-transparent"
          value={isHexColor(value) ? value : '#7c5cff'}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className={inputCls}
          value={value ?? ''}
          placeholder="#7c5cff"
          maxLength={7}
          onChange={(e) => onChange(e.target.value || null)}
        />
        {value && (
          <button type="button" className="text-xs text-ae-muted hover:text-ae-text" onClick={() => onChange(null)}>
            Reset
          </button>
        )}
      </div>
    </Field>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Appearance tab
// ─────────────────────────────────────────────────────────────────────────────────────────────

function AppearanceTab() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const profileAccent = useSettingsStore((s) => s.profileAccent);
  const { customCss } = useTheme();
  const [cssDraft, setCssDraft] = useState(theme.customCss);

  // Debounce CSS recompilation while typing.
  useEffect(() => {
    const t = setTimeout(() => setTheme({ customCss: cssDraft }), 300);
    return () => clearTimeout(t);
  }, [cssDraft, setTheme]);

  return (
    <div className="space-y-6">
      <Section title="Theme">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRESET_ORDER.map((id) => {
            const preset = THEME_PRESETS[id];
            const t = preset.tokens;
            const active = theme.presetId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTheme({ presetId: id })}
                className={`ae-lift overflow-hidden rounded-ae border text-left ${active ? 'border-ae-accent ae-glow' : 'border-ae-border hover:border-ae-muted'}`}
              >
                <div className="flex h-16 gap-1 p-2" style={{ background: t.backdrop }}>
                  <div className="w-6 rounded" style={{ background: t.bgSunken }} />
                  <div className="w-16 rounded" style={{ background: t.bgElevated, border: `1px solid ${t.border}` }} />
                  <div className="flex flex-1 flex-col justify-end gap-1 rounded p-1.5" style={{ background: t.surface }}>
                    <div className="h-1.5 w-3/4 rounded" style={{ background: t.text }} />
                    <div className="h-1.5 w-1/3 rounded" style={{ background: t.accent }} />
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-sm font-semibold">
                    {preset.label}
                    {preset.light && <span className="ml-2 rounded bg-ae-surface px-1.5 text-[10px] text-ae-muted">LIGHT</span>}
                  </p>
                  <p className="text-xs text-ae-muted">{preset.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Accent color">
        <Toggle
          label="Use my profile accent"
          hint={profileAccent ? `Your profile accent is ${profileAccent}.` : 'Set an accent color on your profile first.'}
          checked={theme.useProfileAccent}
          onChange={(v) => setTheme({ useProfileAccent: v })}
        />
        {!theme.useProfileAccent && (
          <ColorField label="Accent override" value={theme.accentOverride} onChange={(v) => setTheme({ accentOverride: v })} />
        )}
      </Section>

      <Section title="Motion" description="Springy menus, sliding messages, glowing speakers and live badges.">
        <Field label="Animations">
          <Chips
            options={[
              { id: 'full', label: 'Full' },
              { id: 'subtle', label: 'Subtle (no decorative loops)' },
              { id: 'off', label: 'Off' },
              { id: 'system', label: 'Follow Windows' },
            ]}
            value={theme.animations}
            onChange={(v) => setTheme({ animations: v })}
          />
        </Field>
        <Toggle
          label="Animate status icons"
          hint="Online, Idle, Do Not Disturb and Offline icons morph when they change and glow gently."
          checked={theme.animateStatus}
          onChange={(v) => setTheme({ animateStatus: v })}
        />
        <Toggle
          label="Ambient background"
          hint="A slow, faint aurora in your accent colour drifting behind everything."
          checked={theme.ambientBackground}
          onChange={(v) => setTheme({ ambientBackground: v })}
        />
        <Toggle
          label="Reduce motion"
          hint="Stops every animation, including avatar frames and profile effects."
          checked={theme.reduceMotion}
          onChange={(v) => setTheme({ reduceMotion: v })}
        />
      </Section>

      <Section
        title="Custom CSS"
        description="Applies to the whole app, scoped so it cannot affect anything outside aether.chat. Override theme tokens with :scope { --ae-accent: #ff2fd6; }."
      >
        <Toggle label="Enable custom CSS" checked={theme.customCssEnabled} onChange={(v) => setTheme({ customCssEnabled: v })} />
        <textarea
          className={`${inputCls} min-h-56 font-mono text-xs`}
          spellCheck={false}
          value={cssDraft}
          placeholder={':scope {\n  --ae-radius: 0px;\n  --ae-accent: #ff2fd6;\n}\n\n.ae-md a { text-decoration: underline; }'}
          onChange={(e) => setCssDraft(e.target.value)}
        />
        <p className="text-xs text-ae-muted">
          {customCss.error
            ? <span className="text-ae-danger">Parse error: {customCss.error}</span>
            : theme.customCssEnabled
              ? `${customCss.ruleCount} rule${customCss.ruleCount === 1 ? '' : 's'} active${customCss.truncated ? ' (truncated at 32 KB)' : ''}.`
              : 'Custom CSS is disabled.'}
        </p>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Voice tab
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Live input level meter with the noise-gate threshold marked. Opens its own mic stream while running. */
function MicMeter({ deviceId, gateDb }: { deviceId: string | null; gateDb: number }) {
  const [running, setRunning] = useState(false);
  const [levelDb, setLevelDb] = useState(-100);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: deviceId ? { exact: deviceId } : undefined },
        });
        if (cancelled) return;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const loop = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          setLevelDb(20 * Math.log10(Math.max(Math.sqrt(sum / buf.length), 1e-8)));
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setRunning(false);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      setLevelDb(-100);
    };
  }, [running, deviceId]);

  const pct = (db: number) => `${Math.max(0, Math.min(100, db + 100))}%`;
  const open = levelDb >= gateDb;

  return (
    <div className="space-y-2">
      <div className="relative h-3 overflow-hidden rounded-full bg-ae-sunken">
        <div
          className="h-full transition-[width] duration-75"
          style={{ width: pct(levelDb), background: open ? 'var(--ae-success)' : 'var(--ae-text-muted)' }}
        />
        {gateDb > -100 && <div className="absolute inset-y-0 w-0.5 bg-ae-warning" style={{ left: pct(gateDb) }} title="Noise gate" />}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setRunning((r) => !r);
          }}
          className="rounded-ae bg-ae-surface px-3 py-1.5 text-xs hover:bg-ae-hover"
        >
          {running ? 'Stop mic test' : 'Test microphone'}
        </button>
        {running && <span className="text-xs text-ae-muted">{open ? 'Gate open: you are transmitting' : 'Below gate: silent'}</span>}
        {error && <span className="text-xs text-ae-danger">{error}</span>}
      </div>
    </div>
  );
}

function VoiceTab() {
  const audio = useSettingsStore((s) => s.audio);
  const setAudio = useSettingsStore((s) => s.setAudio);
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }>({
    inputs: [],
    outputs: [],
    cameras: [],
  });

  useEffect(() => {
    const refresh = () => void listAudioDevices().then(setDevices).catch(() => undefined);
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, []);

  const outputSelectable = 'setSinkId' in AudioContext.prototype;
  const label = (d: MediaDeviceInfo, i: number) => d.label || `Device ${i + 1}`;

  return (
    <div className="space-y-6">
      <Section title="Devices" description="Device names appear after you grant microphone permission once.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Input device">
            <select className={inputCls} value={audio.inputDeviceId ?? ''} onChange={(e) => setAudio({ inputDeviceId: e.target.value || null })}>
              <option value="">System default</option>
              {devices.inputs
                .filter((d) => d.deviceId && d.deviceId !== 'default')
                .map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {label(d, i)}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Output device" hint={outputSelectable ? undefined : 'Output selection is not supported by this runtime.'}>
            <select
              className={inputCls}
              disabled={!outputSelectable}
              value={audio.outputDeviceId ?? ''}
              onChange={(e) => setAudio({ outputDeviceId: e.target.value || null })}
            >
              <option value="">System default</option>
              {devices.outputs
                .filter((d) => d.deviceId && d.deviceId !== 'default')
                .map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {label(d, i)}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Camera">
            <select className={inputCls} value={audio.videoDeviceId ?? ''} onChange={(e) => setAudio({ videoDeviceId: e.target.value || null })}>
              <option value="">System default</option>
              {devices.cameras
                .filter((d) => d.deviceId)
                .map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {label(d, i)}
                  </option>
                ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Input sensitivity">
        <Slider
          label="Noise gate"
          value={audio.noiseGateDb}
          min={-100}
          max={-10}
          step={1}
          format={(v) => (v <= -100 ? 'Off' : `${v} dB`)}
          hint="Your mic transmits only while the level is above this line. Drag fully left to disable."
          onChange={(v) => setAudio({ noiseGateDb: v })}
        />
        <MicMeter deviceId={audio.inputDeviceId} gateDb={audio.noiseGateDb} />
        <Slider
          label="Input gain"
          value={audio.inputGain}
          min={0}
          max={2}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => setAudio({ inputGain: v })}
        />
        <Slider
          label="High-pass filter"
          value={audio.highPassHz}
          min={20}
          max={300}
          step={5}
          format={(v) => `${v} Hz`}
          hint="Removes low rumble: fans, desk bumps, traffic."
          onChange={(v) => setAudio({ highPassHz: v })}
        />
      </Section>

      <Section title="Processing">
        <Toggle label="Echo cancellation" checked={audio.echoCancellation} onChange={(v) => setAudio({ echoCancellation: v })} />
        <Toggle
          label="AI noise suppression (RNNoise)"
          hint="A small neural network removes keyboards, fans and background chatter. Runs on your PC; replaces the browser's noise suppression."
          checked={audio.rnnoise}
          onChange={(v) => setAudio({ rnnoise: v })}
        />
        {!audio.rnnoise && (
          <Toggle label="Standard noise suppression" checked={audio.noiseSuppression} onChange={(v) => setAudio({ noiseSuppression: v })} />
        )}
        <Toggle
          label="Automatic gain control"
          hint="Usually best off; aether.chat's compressor already levels your voice."
          checked={audio.autoGainControl}
          onChange={(v) => setAudio({ autoGainControl: v })}
        />
      </Section>
      <Section
        title="TURN relay (advanced)"
        description="Some networks (strict NAT, corporate Wi-Fi) block peer-to-peer. A TURN server relays the audio instead. Bring your own (e.g. a free tier from a TURN provider, or coturn); leave empty to stay direct. Applies the next time you join."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="TURN URL(s)" hint="turn:host:3478 or turns:host:5349, comma-separated">
            <input className={inputCls} value={audio.turnUrl} placeholder="turn:turn.example.com:3478" onChange={(e) => setAudio({ turnUrl: e.target.value })} />
          </Field>
          <Field label="Username">
            <input className={inputCls} value={audio.turnUsername} autoComplete="off" onChange={(e) => setAudio({ turnUsername: e.target.value })} />
          </Field>
          <Field label="Credential">
            <input className={inputCls} type="password" value={audio.turnCredential} autoComplete="off" onChange={(e) => setAudio({ turnCredential: e.target.value })} />
          </Field>
        </div>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Keybinds tab
// ─────────────────────────────────────────────────────────────────────────────────────────────

function KeybindRow({ label, hint, combo, onChange }: { label: string; hint: string; combo: string | null; onChange: (c: string | null) => void }) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setRecording(false);
        return;
      }
      const next = comboFromEvent(e);
      if (next) {
        onChange(next);
        setRecording(false);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [recording, onChange]);

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm">{label}</p>
        <p className="text-xs text-ae-muted">{hint}</p>
      </div>
      <div className="flex items-center gap-2">
        <kbd className={`min-w-32 rounded-ae border px-3 py-1.5 text-center font-mono text-xs ${recording ? 'border-ae-accent text-ae-accent' : 'border-ae-border'}`}>
          {recording ? 'Press keys… (Esc cancels)' : formatCombo(combo)}
        </kbd>
        <button type="button" className="rounded-ae bg-ae-surface px-3 py-1.5 text-xs hover:bg-ae-hover" onClick={() => setRecording(true)}>
          Record
        </button>
        {combo && (
          <button type="button" className="text-xs text-ae-muted hover:text-ae-danger" onClick={() => onChange(null)}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function NotificationsTab() {
  const sounds = useSettingsStore((s) => s.sounds);
  const setSounds = useSettingsStore((s) => s.setSounds);
  const groups: { title: string; ids: typeof ALL_SOUNDS }[] = [
    { title: 'Messages', ids: ['message', 'mention', 'messageSent'] },
    { title: 'Voice', ids: ['voiceJoin', 'voiceLeave', 'userJoin', 'userLeave', 'mute', 'unmute', 'deafen', 'undeafen', 'streamStart', 'streamStop'] },
    { title: 'Calls', ids: ['callIncoming', 'callOutgoing', 'callEnd'] },
  ];

  return (
    <div className="space-y-6">
      <DesktopNotificationsSection />
      <Section
        title="Sounds"
        description="DM and mention sounds only play when you're not already looking at that chat. Do Not Disturb silences messages and ringing."
      >
        <Toggle label="Enable sound effects" checked={sounds.enabled} onChange={(v) => setSounds({ enabled: v })} />
        <Slider
          label="Volume"
          value={sounds.volume}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => setSounds({ volume: v })}
        />
      </Section>

      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          <div className="space-y-2">
            {g.ids.map((id) => {
              const on = !sounds.disabled.includes(id);
              return (
                <div key={id} className="flex items-center gap-3">
                  <button
                    type="button"
                    title="Preview"
                    aria-label={`Preview ${SOUND_INFO[id].label}`}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ae-surface text-xs hover:bg-ae-hover"
                    onClick={() => playSound(id, true)}
                  >
                    ▶
                  </button>
                  <label className="flex flex-1 cursor-pointer items-center justify-between gap-4">
                    <span>
                      <span className="block text-sm">{SOUND_INFO[id].label}</span>
                      <span className="block text-xs text-ae-muted">{SOUND_INFO[id].hint}</span>
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={on}
                      disabled={!sounds.enabled}
                      onChange={(e) =>
                        setSounds({ disabled: e.target.checked ? sounds.disabled.filter((x) => x !== id) : [...sounds.disabled, id] })
                      }
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </Section>
      ))}
    </div>
  );
}

function KeybindsTab() {
  const keybinds = useSettingsStore((s) => s.keybinds);
  const setKeybinds = useSettingsStore((s) => s.setKeybinds);
  const bind = (key: keyof Omit<Keybinds, 'pushToTalkEnabled'>) => (combo: string | null) => setKeybinds({ [key]: combo });

  return (
    <div className="space-y-6">
      <Section
        title="Shortcuts"
        description="Single keys without modifiers are ignored while you type in a text box. They also work from the tray icon's menu."
      >
        <KeybindRow label="Toggle mute" hint="Mute or unmute your microphone." combo={keybinds.toggleMute} onChange={bind('toggleMute')} />
        <KeybindRow label="Toggle deafen" hint="Silence all incoming audio (also mutes you)." combo={keybinds.toggleDeafen} onChange={bind('toggleDeafen')} />
      </Section>
      <Section title="Push to talk">
        <Toggle
          label="Enable push to talk"
          hint="Your mic stays muted except while the key is held."
          checked={keybinds.pushToTalkEnabled}
          onChange={(v) => setKeybinds({ pushToTalkEnabled: v })}
        />
        <KeybindRow label="Push-to-talk key" hint="Hold to transmit." combo={keybinds.pushToTalk} onChange={bind('pushToTalk')} />
      </Section>
      <BackgroundShortcutsSection />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Bandwidth tab
// ─────────────────────────────────────────────────────────────────────────────────────────────

const PROFILES: { id: BandwidthProfile; label: string; detail: string }[] = [
  { id: 'low', label: 'Data saver', detail: 'Voice 24 kbps · screen about 0.9–3.2 Mbps per viewer. Best for mobile hotspots.' },
  { id: 'balanced', label: 'Balanced', detail: 'Voice 64 kbps · screen about 1.8–6.4 Mbps per viewer. Recommended.' },
  { id: 'high', label: 'High fidelity', detail: 'Voice 128 kbps · screen about 2.8–10 Mbps per viewer. For fast connections.' },
];

function BandwidthTab() {
  const audio = useSettingsStore((s) => s.audio);
  const setAudio = useSettingsStore((s) => s.setAudio);
  const screen = useSettingsStore((s) => s.screen);
  const setScreen = useSettingsStore((s) => s.setScreen);

  const peers = 5;
  return (
    <div className="space-y-6">
      <Section
        title="Bandwidth profile"
        description={`In a mesh call you upload to each peer separately. With ${peers} others, multiply your upload by ${peers}.`}
      >
        <div className="space-y-2">
          {PROFILES.map((p) => (
            <label
              key={p.id}
              className={`flex cursor-pointer items-start gap-3 rounded-ae border p-3 ${audio.bandwidthProfile === p.id ? 'border-ae-accent bg-ae-accent/10' : 'border-ae-border'}`}
            >
              <input
                type="radio"
                name="bw"
                className="mt-1"
                checked={audio.bandwidthProfile === p.id}
                onChange={() => setAudio({ bandwidthProfile: p.id })}
              />
              <span>
                <span className="block text-sm font-semibold">{p.label}</span>
                <span className="block text-xs text-ae-muted">{p.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Screen share defaults">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Resolution cap">
            <select className={inputCls} value={screen.resolution} onChange={(e) => setScreen({ resolution: e.target.value as ScreenResolution })}>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </Field>
          <Field label="Frame-rate cap">
            <select
              className={inputCls}
              value={screen.frameRate}
              onChange={(e) => setScreen({ frameRate: Number(e.target.value) as ScreenFrameRate })}
            >
              <option value={15}>15 FPS: text and slides</option>
              <option value={30}>30 FPS: general use</option>
              <option value={60}>60 FPS: games and video</option>
            </select>
          </Field>
        </div>
        <Toggle label="Share system or tab audio" checked={screen.includeAudio} onChange={(v) => setScreen({ includeAudio: v })} />
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shell
// ─────────────────────────────────────────────────────────────────────────────────────────────

const TAB_GROUPS: { title: string; tabs: { id: SettingsTab; label: string; icon: ReactNode }[] }[] = [
  {
    title: 'User settings',
    tabs: [
      { id: 'account', label: 'My Account', icon: <UserIcon size={15} /> },
      { id: 'profile', label: 'Profiles', icon: <IdCardIcon size={15} /> },
      { id: 'privacy', label: 'Privacy & Safety', icon: <ShieldIcon size={15} /> },
    ],
  },
  {
    title: 'App settings',
    tabs: [
      { id: 'appearance', label: 'Appearance', icon: <PaletteIcon size={15} /> },
      { id: 'voice', label: 'Voice & Audio', icon: <StageIcon size={15} /> },
      { id: 'notifications', label: 'Notifications & Sounds', icon: <BellIcon size={15} /> },
      { id: 'keybinds', label: 'Keybinds', icon: <KeyboardIcon size={15} /> },
      { id: 'bandwidth', label: 'Streaming & Bandwidth', icon: <NetworkIcon size={15} /> },
      { id: 'activity', label: 'Activity Privacy', icon: <GameIcon size={15} /> },
      { id: 'windows', label: 'Windows Settings', icon: <AppWindowIcon size={15} /> },
    ],
  },
];
const ADMIN_GROUP = { title: 'Staff', tabs: [{ id: 'admin' as SettingsTab, label: 'Admin Panel', icon: <AdminIcon size={15} /> }] };
const TABS = [...TAB_GROUPS, ADMIN_GROUP].flatMap((g) => g.tabs);

export function SettingsPanel({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  const open = useUiStore((s) => s.settingsOpen);
  const tab = useUiStore((s) => s.settingsTab);
  const openSettings = useUiStore((s) => s.openSettings);
  const close = useUiStore((s) => s.closeSettings);
  const { data: me } = useProfile(userId);
  const groups = me?.is_admin ? [...TAB_GROUPS, ADMIN_GROUP] : TAB_GROUPS;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="ae-zoom-in fixed inset-0 z-50 flex bg-ae-bg" role="dialog" aria-modal="true" aria-label="Settings">
      <nav className="ae-panel ae-scroll flex w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-ae-border p-4">
        {groups.map((g) => (
          <div key={g.title} className="mb-3">
            <p className="mb-1 px-3 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{g.title}</p>
            {g.tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => openSettings(t.id)}
                className={`flex w-full items-center gap-2.5 rounded-ae px-3 py-2 text-left text-sm transition-colors ${
                  tab === t.id ? 'bg-ae-surface font-semibold text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'
                }`}
              >
                <span className="w-5 text-center">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        ))}
        <div className="mt-auto border-t border-ae-border pt-3">
          <button type="button" onClick={onSignOut} className="flex w-full items-center gap-2.5 rounded-ae px-3 py-2 text-left text-sm text-ae-danger hover:bg-ae-hover">
            <span className="w-5 text-center"><LogOutIcon size={15} className="ae-ico" /></span> Sign out
          </button>
          <p className="mt-2 px-3 text-[11px] text-ae-muted">aether.chat v{__APP_VERSION__}</p>
        </div>
      </nav>

      <main className="ae-scroll relative flex-1 overflow-y-auto">
        <div key={tab} className="ae-enter mx-auto max-w-5xl p-8">
          <h2 className="mb-6 text-2xl font-bold tracking-tight">{TABS.find((t) => t.id === tab)?.label}</h2>
          {tab === 'account' && <AccountTab userId={userId} onSignOut={onSignOut} />}
          {tab === 'privacy' && <PrivacyTab userId={userId} />}
          {tab === 'profile' && <ProfileEditor userId={userId} />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'voice' && <VoiceTab />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'keybinds' && <KeybindsTab />}
          {tab === 'bandwidth' && <BandwidthTab />}
          {tab === 'activity' && <ActivityTab userId={userId} />}
          {tab === 'windows' && <WindowsTab />}
          {tab === 'admin' && me?.is_admin && <AdminTab userId={userId} />}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close settings"
          className="fixed top-6 right-6 grid h-9 w-9 place-items-center rounded-full border border-ae-border text-ae-muted hover:text-ae-text"
        >
          <CloseIcon />
        </button>
      </main>
    </div>
  );
}
