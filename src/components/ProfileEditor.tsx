/**
 * Settings → Profiles. A compact editor: identity fields up top, then one row per kind of
 * decoration (avatar decoration, shape, profile effect, card style, name style, colours). Each row
 * opens a picker with a live preview of every option; hovering an option tries it on your card.
 * "Per-server profiles" sets a different avatar, banner, bio and nickname for each server.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useProfile, useServerMembers, useServers, useUpdateProfile, useUploadProfileMedia } from '../hooks/useChatData';
import { useSupabase } from '../lib/supabase';
import { AVATAR_FRAMES, isHexColor } from '../theme/presets';
import type { AvatarShape, CardStyle, EditableProfile, NameEffect, NameFont, ProfileEffect, ProfileLink, UserProfile } from '../types/db';
import { Dialog } from './Dialog';
import { CloseIcon } from './icons';
import { Avatar, ProfileCard, StyledName } from './ProfileCard';
import { ColorField, Field, inputCls, Section } from './SettingsPanel';
import { toast } from './Toaster';

const EDITABLE_KEYS: (keyof EditableProfile)[] = [
  'username', 'display_name', 'custom_status', 'status_emoji', 'bio', 'avatar_url', 'avatar_frame', 'banner_url', 'primary_color',
  'accent_color', 'custom_css', 'audio_status_url', 'theme_preset', 'pronouns', 'name_font', 'name_effect', 'name_color_a', 'name_color_b',
  'profile_effect', 'card_style', 'avatar_shape', 'profile_links',
];

function toDraft(p: UserProfile): EditableProfile {
  return Object.fromEntries(EDITABLE_KEYS.map((k) => [k, p[k]])) as EditableProfile;
}

const FRAME_LABELS = Object.fromEntries(AVATAR_FRAMES.map((f) => [f.id, f.label]));
const SHAPES: { id: AvatarShape; label: string }[] = [
  { id: 'circle', label: 'Circle' },
  { id: 'squircle', label: 'Squircle' },
  { id: 'hexagon', label: 'Hexagon' },
];
const EFFECTS: { id: ProfileEffect; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'sparkles', label: 'Sparkles' },
  { id: 'stars', label: 'Stars' },
  { id: 'snow', label: 'Snow' },
  { id: 'hearts', label: 'Hearts' },
  { id: 'petals', label: 'Petals' },
  { id: 'confetti', label: 'Confetti' },
  { id: 'fireflies', label: 'Fireflies' },
  { id: 'bubbles', label: 'Bubbles' },
  { id: 'rain', label: 'Rain' },
];
const CARDS: { id: CardStyle; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'glass', label: 'Glass' },
  { id: 'aurora', label: 'Aurora' },
];
const FONTS: { id: NameFont; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' },
  { id: 'handwritten', label: 'Script' },
  { id: 'mono', label: 'Mono' },
  { id: 'pixel', label: 'Pixel' },
];
const NAME_EFFECTS: { id: NameEffect; label: string }[] = [
  { id: 'none', label: 'Plain' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'glow', label: 'Glow' },
  { id: 'neon', label: 'Neon' },
];
const COLOR_PRESETS: [string, string][] = [
  ['#7c5cff', '#00e5ff'],
  ['#ff3cac', '#784ba0'],
  ['#ff8a4c', '#ffd166'],
  ['#2ee6d6', '#4facfe'],
  ['#5fd38d', '#1f4d2e'],
  ['#e11d48', '#1a0f12'],
  ['#ebbcba', '#c4a7e7'],
  ['#f8f8f2', '#44475a'],
  ['#0b1020', '#7aa2ff'],
  ['#fabd2f', '#fb4934'],
];

/** A shrunken, non-interactive ProfileCard for picker tiles. */
function MiniCard({ profile }: { profile: UserProfile }) {
  return (
    <div className="pointer-events-none relative h-[118px] w-full overflow-hidden">
      <div className="absolute top-0 left-1/2 w-[340px] origin-top -translate-x-1/2 scale-[0.3]">
        <ProfileCard profile={profile} />
      </div>
    </div>
  );
}

interface PickerProps<T extends string> {
  title: string;
  options: { id: T; label: string }[];
  current: T;
  base: UserProfile;
  apply: (id: T) => Partial<UserProfile>;
  renderTile: (preview: UserProfile, id: T) => ReactNode;
  extra?: (hovered: T) => ReactNode;
  onApply: (patch: Partial<UserProfile>) => void;
  onClose: () => void;
}

/** Grid of options on the left, your live card on the right. Hover to try, click to select, Apply to keep. */
function Picker<T extends string>({ title, options, current, base, apply, renderTile, extra, onApply, onClose }: PickerProps<T>) {
  const [selected, setSelected] = useState<T>(current);
  const [hovered, setHovered] = useState<T | null>(null);
  const shown = hovered ?? selected;
  const preview = { ...base, ...apply(shown) } as UserProfile;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ae-backdrop fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="ae-dialog flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-4xl flex-col overflow-hidden rounded-[calc(var(--ae-radius)+4px)] border border-ae-border bg-ae-elevated shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ae-border px-5 py-3.5">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" aria-label="Close" className="text-ae-muted hover:text-ae-text" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="ae-scroll min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-3 gap-2.5 lg:grid-cols-4" onMouseLeave={() => setHovered(null)}>
              {options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onMouseEnter={() => setHovered(o.id)}
                  onFocus={() => setHovered(o.id)}
                  onClick={() => setSelected(o.id)}
                  className={`ae-enter group relative overflow-hidden rounded-ae border-2 bg-ae-sunken p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                    selected === o.id ? 'border-ae-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--ae-accent)_25%,transparent)]' : 'border-transparent hover:border-ae-border'
                  }`}
                >
                  {renderTile({ ...base, ...apply(o.id) } as UserProfile, o.id)}
                  <p className="mt-1.5 truncate text-center text-xs font-semibold">{o.label}</p>
                  {current === o.id && <span className="absolute top-1.5 left-1.5 rounded bg-ae-surface px-1.5 text-[9px] font-bold text-ae-muted uppercase">current</span>}
                  {selected === o.id && <span className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-ae-accent text-[11px] text-ae-on-accent">✓</span>}
                </button>
              ))}
            </div>
            {extra?.(shown)}
          </div>
          <aside className="hidden w-[380px] shrink-0 flex-col items-center gap-3 border-l border-ae-border bg-ae-sunken/50 p-5 md:flex">
            <p className="self-start text-[11px] font-bold tracking-wide text-ae-muted uppercase">Preview</p>
            <ProfileCard profile={preview} />
            <p className="text-sm font-semibold">{options.find((o) => o.id === shown)?.label}</p>
          </aside>
        </div>
        <footer className="flex justify-end gap-2 border-t border-ae-border px-5 py-3">
          <button type="button" className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ae-press rounded-ae bg-ae-accent px-5 py-2 text-sm font-semibold text-ae-on-accent"
            onClick={() => {
              onApply(apply(selected));
              onClose();
            }}
          >
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}

function CustomizeRow({ icon, title, value, onChange, children }: { icon: ReactNode; title: string; value: ReactNode; onChange: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-ae border border-ae-border bg-ae-surface/30 px-3 py-2.5 transition-colors hover:bg-ae-surface/60">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ae bg-ae-sunken text-lg">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-ae-muted">{value}</span>
      </span>
      {children}
      <button type="button" onClick={onChange} className="ae-press shrink-0 rounded-ae bg-ae-accent px-3.5 py-1.5 text-xs font-semibold text-ae-on-accent">
        Change
      </button>
    </div>
  );
}

function ImageSlot({ label, url, round, userId, kind, onChange }: {
  label: string;
  url: string | null;
  round?: boolean;
  userId: string;
  kind: 'avatar' | 'banner';
  onChange: (url: string | null) => void;
}) {
  const upload = useUploadProfileMedia(userId);
  const ref = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-ae border border-ae-border bg-ae-surface/30 p-2.5">
      <div className={`grid shrink-0 place-items-center overflow-hidden bg-ae-sunken ${round ? 'h-14 w-14 rounded-full' : 'h-14 w-24 rounded-ae'}`}>
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-ae-muted">none</span>}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-semibold">{label}</p>
        {linking ? (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^https:\/\/\S+$/.test(link.trim())) onChange(link.trim());
              setLinking(false);
              setLink('');
            }}
          >
            <input className={`${inputCls} !py-1 text-xs`} autoFocus placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
            <button type="submit" className="rounded bg-ae-surface px-2 text-xs">
              OK
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-1.5 text-xs">
            <input
              ref={ref}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) upload.mutate({ file, kind }, { onSuccess: onChange, onError: (err) => toast.error(err.message) });
              }}
            />
            <button type="button" className="ae-press rounded bg-ae-accent px-2.5 py-1 font-semibold text-ae-on-accent" onClick={() => ref.current?.click()}>
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </button>
            <button type="button" className="rounded px-2 py-1 text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={() => setLinking(true)}>
              Link
            </button>
            {url && (
              <button type="button" className="rounded px-2 py-1 text-ae-danger hover:bg-ae-hover" onClick={() => onChange(null)}>
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type PickerKind = 'frame' | 'shape' | 'effect' | 'card' | 'name' | 'colors';

function MainProfile({ userId }: { userId: string }) {
  const { data: profile } = useProfile(userId);
  const update = useUpdateProfile(userId);
  const uploadAudio = useUploadProfileMedia(userId);
  const audioRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<EditableProfile | null>(null);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  useEffect(() => {
    if (profile && !draft) setDraft(toDraft(profile));
  }, [profile, draft]);

  const dirty = useMemo(
    () => !!profile && !!draft && EDITABLE_KEYS.some((k) => JSON.stringify(draft[k] ?? null) !== JSON.stringify(profile[k] ?? null)),
    [profile, draft],
  );

  if (!profile || !draft) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ae-skeleton h-14" />
        ))}
      </div>
    );
  }

  const merged = { ...profile, ...draft } as UserProfile;
  const set = (patch: Partial<EditableProfile>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const text = (k: keyof EditableProfile) => (draft[k] as string | null) ?? '';
  const setText = (k: keyof EditableProfile, v: string) => set({ [k]: v === '' ? null : v } as Partial<EditableProfile>);

  const save = () => {
    const patch: Partial<EditableProfile> = {};
    for (const k of EDITABLE_KEYS)
      if (JSON.stringify(draft[k] ?? null) !== JSON.stringify(profile[k] ?? null)) (patch as Record<string, unknown>)[k] = draft[k];
    if ('custom_status' in patch || 'status_emoji' in patch) patch.custom_status_expires_at = null;
    update.mutate(patch, {
      onSuccess: (p) => {
        setDraft(toDraft(p));
        toast.success('Profile saved.');
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const applyPatch = (patch: Partial<UserProfile>) => set(patch as Partial<EditableProfile>);
  const links = draft.profile_links ?? [];

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0 space-y-6 pb-20">
        <Section title="Identity">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Display name">
              <input className={inputCls} maxLength={64} value={text('display_name')} onChange={(e) => setText('display_name', e.target.value)} />
            </Field>
            <Field label="Username">
              <input className={inputCls} maxLength={32} value={draft.username} onChange={(e) => set({ username: e.target.value })} />
            </Field>
            <Field label="Pronouns">
              <input className={inputCls} maxLength={40} placeholder="they/them" value={text('pronouns')} onChange={(e) => setText('pronouns', e.target.value)} />
            </Field>
            <Field label="Status">
              <div className="flex gap-2">
                <input className={`${inputCls} !w-14 shrink-0 text-center`} maxLength={8} placeholder="😀" value={text('status_emoji')} onChange={(e) => setText('status_emoji', e.target.value)} />
                <input className={inputCls} maxLength={128} placeholder="What's up?" value={text('custom_status')} onChange={(e) => setText('custom_status', e.target.value)} />
              </div>
            </Field>
          </div>
          <Field label="About me" hint="Markdown: **bold**, *italic*, `code`, ||spoilers||, links.">
            <textarea className={`${inputCls} min-h-20`} maxLength={4000} value={text('bio')} onChange={(e) => setText('bio', e.target.value)} />
          </Field>
        </Section>

        <Section title="Pictures">
          <div className="flex flex-wrap gap-3">
            <ImageSlot label="Avatar" round url={draft.avatar_url} userId={userId} kind="avatar" onChange={(u) => set({ avatar_url: u })} />
            <ImageSlot label="Banner" url={draft.banner_url} userId={userId} kind="banner" onChange={(u) => set({ banner_url: u })} />
          </div>
        </Section>

        <Section title="Customize" description="Click Change to browse every option. Hover one to try it on your card.">
          <div className="space-y-2">
            <CustomizeRow icon="💫" title="Avatar decoration" value={FRAME_LABELS[draft.avatar_frame ?? 'none'] ?? 'None'} onChange={() => setPicker('frame')} />
            <CustomizeRow icon="⬢" title="Avatar shape" value={SHAPES.find((s) => s.id === (draft.avatar_shape ?? 'circle'))?.label} onChange={() => setPicker('shape')} />
            <CustomizeRow icon="✨" title="Profile effect" value={EFFECTS.find((e) => e.id === (draft.profile_effect ?? 'none'))?.label} onChange={() => setPicker('effect')} />
            <CustomizeRow icon="🪪" title="Card style" value={CARDS.find((c) => c.id === (draft.card_style ?? 'solid'))?.label} onChange={() => setPicker('card')} />
            <CustomizeRow
              icon="Aa"
              title="Name style"
              value={
                <>
                  {FONTS.find((f) => f.id === (draft.name_font ?? 'default'))?.label} · {NAME_EFFECTS.find((f) => f.id === (draft.name_effect ?? 'none'))?.label}
                </>
              }
              onChange={() => setPicker('name')}
            />
            <CustomizeRow icon="🎨" title="Profile colours" value="Banner and accent colours" onChange={() => setPicker('colors')}>
              <span className="flex">
                <span className="h-6 w-6 rounded-full border-2 border-ae-elevated" style={{ background: draft.primary_color ?? 'var(--ae-surface)' }} />
                <span className="-ml-2 h-6 w-6 rounded-full border-2 border-ae-elevated" style={{ background: draft.accent_color ?? 'var(--ae-accent)' }} />
              </span>
            </CustomizeRow>
          </div>
        </Section>

        <Section title="Links" description="Up to 5 https links, shown as buttons on your card.">
          <div className="space-y-1.5">
            {links.map((l: ProfileLink, i: number) => (
              <div key={`${l.url}-${i}`} className="ae-enter flex items-center gap-2 rounded-ae bg-ae-surface px-3 py-1.5 text-sm">
                <span className="font-semibold">🔗 {l.label}</span>
                <span className="flex-1 truncate text-xs text-ae-muted">{l.url}</span>
                <button type="button" className="text-ae-muted hover:text-ae-danger" onClick={() => set({ profile_links: links.filter((_, j) => j !== i) })}>
                  <CloseIcon size={14} />
                </button>
              </div>
            ))}
            {links.length < 5 && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!linkLabel.trim() || !/^https:\/\/\S+$/.test(linkUrl.trim())) return toast.error('Links need a name and an https:// address.');
                  set({ profile_links: [...links, { label: linkLabel.trim().slice(0, 32), url: linkUrl.trim() }] });
                  setLinkLabel('');
                  setLinkUrl('');
                }}
              >
                <input className={`${inputCls} !w-36 shrink-0`} placeholder="GitHub" maxLength={32} value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />
                <input className={inputCls} placeholder="https://…" maxLength={256} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
                <button type="submit" className="shrink-0 rounded-ae bg-ae-surface px-3 text-sm hover:bg-ae-hover">
                  Add
                </button>
              </form>
            )}
          </div>
        </Section>

        <section>
          <button type="button" className="flex w-full items-center gap-2 text-sm font-semibold text-ae-muted hover:text-ae-text" onClick={() => setAdvanced((v) => !v)}>
            <span className={`transition-transform ${advanced ? 'rotate-90' : ''}`}>▸</span> Advanced: audio status and profile CSS
          </button>
          {advanced && (
            <div className="ae-enter mt-3 space-y-4">
              <Field label="Audio status" hint="A short clip people can play from your card.">
                <div className="flex gap-2">
                  <input className={inputCls} value={text('audio_status_url')} placeholder="https://…/clip.mp3" onChange={(e) => setText('audio_status_url', e.target.value)} />
                  <input
                    ref={audioRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) uploadAudio.mutate({ file: f, kind: 'audio' }, { onSuccess: (u) => set({ audio_status_url: u }), onError: (err) => toast.error(err.message) });
                    }}
                  />
                  <button type="button" className="shrink-0 rounded-ae bg-ae-surface px-3 text-sm hover:bg-ae-hover" onClick={() => audioRef.current?.click()}>
                    {uploadAudio.isPending ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
              </Field>
              <Field label="Profile CSS" hint="Styles only your card. Target it with :scope. Remote URLs are blocked; use data:image.">
                <textarea
                  className={`${inputCls} min-h-28 font-mono text-xs`}
                  spellCheck={false}
                  value={text('custom_css')}
                  placeholder={':scope { border-color: #ff2fd6; }'}
                  onChange={(e) => setText('custom_css', e.target.value)}
                />
              </Field>
            </div>
          )}
        </section>
      </div>

      <aside className="hidden xl:block">
        <div className="sticky top-0 space-y-2">
          <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Preview</p>
          <ProfileCard profile={merged} />
        </div>
      </aside>

      {/* Unsaved-changes bar */}
      {dirty && (
        <div className="ae-toast fixed bottom-6 left-1/2 z-[60] flex w-[min(640px,calc(100vw-48px))] -translate-x-1/2 items-center gap-3 rounded-ae border border-ae-border bg-ae-elevated px-4 py-3 shadow-2xl">
          <span className="flex-1 text-sm font-semibold">You have unsaved changes.</span>
          <button type="button" className="rounded-ae px-3 py-1.5 text-sm text-ae-muted hover:text-ae-text" onClick={() => setDraft(toDraft(profile))}>
            Reset
          </button>
          <button type="button" disabled={update.isPending} className="ae-press rounded-ae bg-ae-success px-4 py-1.5 text-sm font-semibold text-black" onClick={save}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {picker === 'frame' && (
        <Picker
          title="Avatar decoration"
          options={AVATAR_FRAMES.map((f) => ({ id: f.id as string, label: f.label }))}
          current={draft.avatar_frame ?? 'none'}
          base={merged}
          apply={(id) => ({ avatar_frame: id === 'none' ? null : id })}
          renderTile={(p) => (
            <div className="grid h-24 place-items-center">
              <Avatar profile={p} size={60} />
            </div>
          )}
          onApply={applyPatch}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'shape' && (
        <Picker
          title="Avatar shape"
          options={SHAPES}
          current={draft.avatar_shape ?? 'circle'}
          base={merged}
          apply={(id) => ({ avatar_shape: id })}
          renderTile={(p) => (
            <div className="grid h-24 place-items-center">
              <Avatar profile={p} size={64} />
            </div>
          )}
          onApply={applyPatch}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'effect' && (
        <Picker title="Profile effect" options={EFFECTS} current={draft.profile_effect ?? 'none'} base={merged} apply={(id) => ({ profile_effect: id })} renderTile={(p) => <MiniCard profile={p} />} onApply={applyPatch} onClose={() => setPicker(null)} />
      )}
      {picker === 'card' && (
        <Picker title="Card style" options={CARDS} current={draft.card_style ?? 'solid'} base={merged} apply={(id) => ({ card_style: id })} renderTile={(p) => <MiniCard profile={p} />} onApply={applyPatch} onClose={() => setPicker(null)} />
      )}
      {picker === 'name' && <NamePicker base={merged} onApply={applyPatch} onClose={() => setPicker(null)} />}
      {picker === 'colors' && (
        <Picker
          title="Profile colours"
          options={[{ id: 'current', label: 'Current' }, ...COLOR_PRESETS.map(([a, b]) => ({ id: `${a}|${b}`, label: `${a} · ${b}` }))]}
          current="current"
          base={merged}
          apply={(id) => (id === 'current' ? {} : { primary_color: id.split('|')[0]!, accent_color: id.split('|')[1]! })}
          renderTile={(p) => (
            <div className="h-20 rounded-ae" style={{ background: `linear-gradient(135deg, ${p.primary_color ?? 'var(--ae-surface)'}, ${p.accent_color ?? 'var(--ae-accent)'})` }} />
          )}
          extra={() => (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <ColorField label="Banner colour" value={draft.primary_color} onChange={(v) => set({ primary_color: v })} />
              <ColorField label="Accent colour" value={draft.accent_color} onChange={(v) => set({ accent_color: v })} />
            </div>
          )}
          onApply={applyPatch}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** Name style has two dimensions (font and effect) plus colours, so it gets its own picker. */
function NamePicker({ base, onApply, onClose }: { base: UserProfile; onApply: (p: Partial<UserProfile>) => void; onClose: () => void }) {
  const [font, setFont] = useState<NameFont>(base.name_font ?? 'default');
  const [effect, setEffect] = useState<NameEffect>(base.name_effect ?? 'none');
  const [a, setA] = useState<string | null>(base.name_color_a);
  const [b, setB] = useState<string | null>(base.name_color_b);
  const [hoverFont, setHoverFont] = useState<NameFont | null>(null);
  const [hoverEffect, setHoverEffect] = useState<NameEffect | null>(null);
  const preview = { ...base, name_font: hoverFont ?? font, name_effect: hoverEffect ?? effect, name_color_a: a, name_color_b: b } as UserProfile;
  const tile = (active: boolean) =>
    `ae-enter rounded-ae border-2 bg-ae-sunken px-2 py-3 text-center transition-all hover:-translate-y-0.5 ${active ? 'border-ae-accent' : 'border-transparent hover:border-ae-border'}`;

  return (
    <Dialog wide title="Name style" onClose={onClose}>
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Font</p>
            <div className="grid grid-cols-3 gap-2" onMouseLeave={() => setHoverFont(null)}>
              {FONTS.map((f) => (
                <button key={f.id} type="button" className={tile(font === f.id)} onMouseEnter={() => setHoverFont(f.id)} onClick={() => setFont(f.id)}>
                  <StyledName profile={{ ...preview, name_font: f.id, name_effect: 'none' }} className="text-base font-semibold" />
                  <span className="mt-1 block text-[11px] text-ae-muted">{f.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Effect</p>
            <div className="grid grid-cols-3 gap-2" onMouseLeave={() => setHoverEffect(null)}>
              {NAME_EFFECTS.map((f) => (
                <button key={f.id} type="button" className={tile(effect === f.id)} onMouseEnter={() => setHoverEffect(f.id)} onClick={() => setEffect(f.id)}>
                  <StyledName profile={{ ...preview, name_effect: f.id }} className="text-base font-semibold" />
                  <span className="mt-1 block text-[11px] text-ae-muted">{f.label}</span>
                </button>
              ))}
            </div>
          </div>
          {effect !== 'none' && effect !== 'rainbow' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField label="Colour 1" value={a} onChange={setA} />
              {(effect === 'gradient' || effect === 'neon') && <ColorField label="Colour 2" value={b} onChange={setB} />}
            </div>
          )}
        </div>
        <div className="hidden w-[200px] flex-col items-center justify-center gap-2 rounded-ae bg-ae-sunken p-4 md:flex">
          <Avatar profile={preview} size={64} />
          <p className="text-xl font-bold">
            <StyledName profile={preview} />
          </p>
          <p className="text-xs text-ae-muted">@{base.username}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="ae-press rounded-ae bg-ae-accent px-5 py-2 text-sm font-semibold text-ae-on-accent"
          onClick={() => {
            onApply({ name_font: font, name_effect: effect, name_color_a: isHexColor(a) ? a : null, name_color_b: isHexColor(b) ? b : null });
            onClose();
          }}
        >
          Apply
        </button>
      </div>
    </Dialog>
  );
}

function ServerProfiles({ userId }: { userId: string }) {
  const sb = useSupabase();
  const { data: profile } = useProfile(userId);
  const { data: servers = [] } = useServers(userId);
  const [serverId, setServerId] = useState<string>('');
  const sid = serverId || servers[0]?.id || null;
  const { data: members = [], refetch } = useServerMembers(sid);
  const me = members.find((m) => m.user_id === userId);
  const [nick, setNick] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNick(me?.nickname ?? '');
    setAvatar(me?.avatar_url ?? null);
    setBanner(me?.banner_url ?? null);
    setBio(me?.bio ?? '');
  }, [me?.nickname, me?.avatar_url, me?.banner_url, me?.bio, sid]);

  if (!profile) return null;
  if (servers.length === 0) return <p className="text-sm text-ae-muted">Join a server to give yourself a different look there.</p>;
  const preview = {
    ...profile,
    display_name: nick || profile.display_name,
    avatar_url: avatar ?? profile.avatar_url,
    banner_url: banner ?? profile.banner_url,
    bio: bio || profile.bio,
  } as UserProfile;

  const save = async () => {
    if (!sid) return;
    setBusy(true);
    try {
      if ((nick || null) !== (me?.nickname ?? null)) {
        const { error } = await sb.rpc('set_member_nickname', { p_server_id: sid, p_user_id: userId, p_nickname: nick });
        if (error) throw new Error(error.message);
      }
      const { error } = await sb.rpc('set_server_profile', { p_server_id: sid, p_avatar_url: avatar, p_banner_url: banner, p_bio: bio });
      if (error) throw new Error(error.message);
      await refetch();
      toast.success('Server profile saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0 space-y-5">
        <Field label="Server">
          <select className={inputCls} value={sid ?? ''} onChange={(e) => setServerId(e.target.value)}>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-sm text-ae-muted">Anything you leave empty uses your main profile.</p>
        <Field label="Server nickname">
          <input className={inputCls} maxLength={32} placeholder={profile.display_name ?? profile.username} value={nick} onChange={(e) => setNick(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-3">
          <ImageSlot label="Server avatar" round url={avatar} userId={userId} kind="avatar" onChange={setAvatar} />
          <ImageSlot label="Server banner" url={banner} userId={userId} kind="banner" onChange={setBanner} />
        </div>
        <Field label="Server bio">
          <textarea className={`${inputCls} min-h-20`} maxLength={1000} value={bio} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <button type="button" disabled={busy} className="ae-press rounded-ae bg-ae-success px-4 py-2 text-sm font-semibold text-black disabled:opacity-50" onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save server profile'}
        </button>
      </div>
      <aside className="hidden xl:block">
        <div className="sticky top-0 space-y-2">
          <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Preview in {servers.find((s) => s.id === sid)?.name}</p>
          <ProfileCard profile={preview} />
        </div>
      </aside>
    </div>
  );
}

export function ProfileEditor({ userId }: { userId: string }) {
  const [tab, setTab] = useState<'main' | 'server'>('main');
  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-ae-border">
        {(
          [
            ['main', 'Main profile'],
            ['server', 'Per-server profiles'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${tab === id ? 'border-ae-accent text-ae-text' : 'border-transparent text-ae-muted hover:text-ae-text'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'main' ? <MainProfile userId={userId} /> : <ServerProfiles userId={userId} />}
    </div>
  );
}
