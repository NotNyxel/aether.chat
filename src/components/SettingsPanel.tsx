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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useProfile, useUpdateProfile, useUploadProfileMedia } from '../hooks/useChatData';
import { listAudioDevices, type BandwidthProfile, type ScreenFrameRate, type ScreenResolution } from '../hooks/useVoiceEngine';
import { comboFromEvent, formatCombo } from '../lib/keybinds';
import { ALL_SOUNDS, playSound, SOUND_INFO } from '../lib/sounds';
import { useSettingsStore, type Keybinds } from '../stores/settingsStore';
import { useUiStore, type SettingsTab } from '../stores/uiStore';
import { AVATAR_FRAMES, isHexColor, PRESET_ORDER, THEME_PRESETS } from '../theme/presets';
import type { EditableProfile, UserProfile } from '../types/db';
import { CloseIcon } from './icons';
import { ProfileCard } from './ProfileCard';
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

export const inputCls =
  'w-full rounded-ae border border-ae-border bg-ae-sunken px-3 py-2 text-sm text-ae-text outline-none focus:border-ae-accent';

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
// Profile tab
// ─────────────────────────────────────────────────────────────────────────────────────────────

const EDITABLE_KEYS: (keyof EditableProfile)[] = [
  'username',
  'display_name',
  'custom_status',
  'status_emoji',
  'bio',
  'avatar_url',
  'avatar_frame',
  'banner_url',
  'primary_color',
  'accent_color',
  'custom_css',
  'audio_status_url',
  'theme_preset',
];

function toDraft(p: UserProfile): EditableProfile {
  return Object.fromEntries(EDITABLE_KEYS.map((k) => [k, p[k]])) as EditableProfile;
}

function UploadButton({ label, accept, userId, kind, onUploaded }: {
  label: string;
  accept: string;
  userId: string;
  kind: 'avatar' | 'banner' | 'audio';
  onUploaded: (url: string) => void;
}) {
  const upload = useUploadProfileMedia(userId);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) upload.mutate({ file, kind }, { onSuccess: onUploaded });
        }}
      />
      <button
        type="button"
        className="shrink-0 rounded-ae bg-ae-surface px-3 py-2 text-xs hover:bg-ae-hover disabled:opacity-50"
        disabled={upload.isPending}
        onClick={() => inputRef.current?.click()}
        title={upload.error?.message}
      >
        {upload.isPending ? 'Uploading…' : upload.isError ? 'Retry upload' : label}
      </button>
    </>
  );
}

function ProfileTab({ userId }: { userId: string }) {
  const { data: profile } = useProfile(userId);
  const update = useUpdateProfile(userId);
  const [draft, setDraft] = useState<EditableProfile | null>(null);

  useEffect(() => {
    if (profile && !draft) setDraft(toDraft(profile));
  }, [profile, draft]);

  const dirty = useMemo(
    () => !!profile && !!draft && EDITABLE_KEYS.some((k) => (draft[k] ?? null) !== (profile[k] ?? null)),
    [profile, draft],
  );

  if (!profile || !draft) return <p className="text-sm text-ae-muted">Loading profile…</p>;

  const set = <K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  const text = (key: keyof EditableProfile) => (draft[key] as string | null) ?? '';
  const setText = (key: keyof EditableProfile, value: string) => set(key, (value === '' ? null : value) as never);

  const save = () => {
    const patch: Partial<EditableProfile> = {};
    for (const k of EDITABLE_KEYS) if ((draft[k] ?? null) !== (profile[k] ?? null)) (patch as Record<string, unknown>)[k] = draft[k];
    // A status typed here doesn't expire (use the status menu for a timed one).
    if ('custom_status' in patch || 'status_emoji' in patch) patch.custom_status_expires_at = null;
    update.mutate(patch);
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_auto]">
      <div className="space-y-6">
        <Section title="Identity">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Display name">
              <input className={inputCls} maxLength={64} value={text('display_name')} onChange={(e) => setText('display_name', e.target.value)} />
            </Field>
            <Field label="Username" hint="2–32 letters, numbers, _ or .">
              <input className={inputCls} maxLength={32} value={draft.username} onChange={(e) => set('username', e.target.value)} />
            </Field>
            <Field label="Status emoji">
              <input className={inputCls} maxLength={8} value={text('status_emoji')} onChange={(e) => setText('status_emoji', e.target.value)} />
            </Field>
            <Field label="Custom status">
              <input className={inputCls} maxLength={128} value={text('custom_status')} onChange={(e) => setText('custom_status', e.target.value)} />
            </Field>
          </div>
          <Field label="Bio (Markdown)" hint="Supports **bold**, *italic*, `code`, ||spoilers||, > quotes, lists and links.">
            <textarea className={`${inputCls} min-h-28 font-mono`} maxLength={4000} value={text('bio')} onChange={(e) => setText('bio', e.target.value)} />
          </Field>
        </Section>

        <Section title="Look" description="Images must be https URLs. Uploads go to your profile-media folder.">
          <Field label="Avatar URL">
            <div className="flex gap-2">
              <input className={inputCls} value={text('avatar_url')} placeholder="https://…" onChange={(e) => setText('avatar_url', e.target.value)} />
              <UploadButton label="Upload" accept="image/*" userId={userId} kind="avatar" onUploaded={(u) => set('avatar_url', u)} />
            </div>
          </Field>
          <Field label="Banner URL">
            <div className="flex gap-2">
              <input className={inputCls} value={text('banner_url')} placeholder="https://…" onChange={(e) => setText('banner_url', e.target.value)} />
              <UploadButton label="Upload" accept="image/*" userId={userId} kind="banner" onUploaded={(u) => set('banner_url', u)} />
            </div>
          </Field>
          <Field label="Animated avatar frame">
            <div className="flex flex-wrap gap-2">
              {AVATAR_FRAMES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => set('avatar_frame', f.id === 'none' ? null : f.id)}
                  className={`rounded-ae border px-3 py-1.5 text-xs ${
                    (draft.avatar_frame ?? 'none') === f.id ? 'border-ae-accent bg-ae-accent/15' : 'border-ae-border hover:bg-ae-hover'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColorField label="Primary color" value={draft.primary_color} onChange={(v) => set('primary_color', v)} />
            <ColorField label="Accent color" value={draft.accent_color} onChange={(v) => set('accent_color', v)} />
          </div>
        </Section>

        <Section title="Audio status" description="A short clip people can play from your profile card.">
          <div className="flex gap-2">
            <input className={inputCls} value={text('audio_status_url')} placeholder="https://…/clip.mp3" onChange={(e) => setText('audio_status_url', e.target.value)} />
            <UploadButton label="Upload" accept="audio/*" userId={userId} kind="audio" onUploaded={(u) => set('audio_status_url', u)} />
          </div>
        </Section>

        <Section
          title="Profile CSS"
          description="Styles only your profile card, as others see it. External URLs are blocked; use data:image URIs. Target the card with :scope."
        >
          <textarea
            className={`${inputCls} min-h-32 font-mono text-xs`}
            spellCheck={false}
            value={text('custom_css')}
            placeholder={':scope { border-color: #ff2fd6; }\n.ae-profile-banner { filter: hue-rotate(40deg); }'}
            onChange={(e) => setText('custom_css', e.target.value)}
          />
        </Section>

        <div className="sticky bottom-0 flex items-center gap-3 bg-ae-elevated py-3">
          <button
            type="button"
            disabled={!dirty || update.isPending}
            onClick={save}
            className="rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-40"
          >
            {update.isPending ? 'Saving…' : 'Save profile'}
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={() => setDraft(toDraft(profile))}
            className="rounded-ae px-3 py-2 text-sm text-ae-muted hover:text-ae-text disabled:opacity-40"
          >
            Discard
          </button>
          {update.isError && <span className="text-sm text-ae-danger">{update.error.message}</span>}
          {update.isSuccess && !dirty && <span className="text-sm text-ae-success">Saved</span>}
        </div>
      </div>

      <aside className="space-y-2">
        <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Live preview</p>
        <ProfileCard profile={{ ...profile, ...draft }} />
      </aside>
    </div>
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
        <div className="grid gap-3 sm:grid-cols-2">
          {PRESET_ORDER.map((id) => {
            const preset = THEME_PRESETS[id];
            const t = preset.tokens;
            const active = theme.presetId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTheme({ presetId: id })}
                className={`overflow-hidden rounded-ae border text-left ${active ? 'border-ae-accent ae-glow' : 'border-ae-border hover:border-ae-muted'}`}
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
                  <p className="text-sm font-semibold">{preset.label}</p>
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

      <Section title="Motion">
        <Toggle
          label="Reduce motion"
          hint="Stops animated avatar frames and other decorative animation."
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
        <Toggle label="Noise suppression" checked={audio.noiseSuppression} onChange={(v) => setAudio({ noiseSuppression: v })} />
        <Toggle
          label="Automatic gain control"
          hint="Usually best off; aether.chat's compressor already levels your voice."
          checked={audio.autoGainControl}
          onChange={(v) => setAudio({ autoGainControl: v })}
        />
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

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'profile', label: 'My Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'voice', label: 'Voice & Audio' },
  { id: 'notifications', label: 'Notifications & Sounds' },
  { id: 'keybinds', label: 'Keybinds' },
  { id: 'bandwidth', label: 'Streaming & Bandwidth' },
  { id: 'activity', label: 'Activity Privacy' },
  { id: 'windows', label: 'Windows Settings' },
];

export function SettingsPanel({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  const open = useUiStore((s) => s.settingsOpen);
  const tab = useUiStore((s) => s.settingsTab);
  const openSettings = useUiStore((s) => s.openSettings);
  const close = useUiStore((s) => s.closeSettings);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex bg-ae-bg" role="dialog" aria-modal="true" aria-label="Settings">
      <nav className="ae-panel flex w-60 shrink-0 flex-col gap-1 border-r border-ae-border p-4">
        <p className="mb-2 px-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Settings</p>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => openSettings(t.id)}
            className={`rounded-ae px-3 py-2 text-left text-sm ${tab === t.id ? 'bg-ae-surface text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`}
          >
            {t.label}
          </button>
        ))}
        <div className="mt-auto">
          <button type="button" onClick={onSignOut} className="w-full rounded-ae px-3 py-2 text-left text-sm text-ae-danger hover:bg-ae-hover">
            Sign out
          </button>
        </div>
      </nav>

      <main className="ae-scroll relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-8">
          <h2 className="mb-6 text-xl font-bold">{TABS.find((t) => t.id === tab)?.label}</h2>
          {tab === 'profile' && <ProfileTab userId={userId} />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'voice' && <VoiceTab />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'keybinds' && <KeybindsTab />}
          {tab === 'bandwidth' && <BandwidthTab />}
          {tab === 'activity' && <ActivityTab userId={userId} />}
          {tab === 'windows' && <WindowsTab />}
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
