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
import { CheckIcon, ChevronRightIcon, CloseIcon, FrameIcon, IdCardIcon, LinkIcon, NameplateIcon, PaletteIcon, SearchIcon, ShapeIcon, SparklesIcon } from './icons';
import { CARD_FRAMES, DEFAULT_PROFILE_ACCENT, DEFAULT_PROFILE_PRIMARY, NAMEPLATES } from '../lib/profileDecor';
import { useUiStore } from '../stores/uiStore';
import { Avatar, ProfileCard, StyledName } from './ProfileCard';
import { ColorField, Field, inputCls, Section, Slider } from './SettingsPanel';
import { toast } from './Toaster';
import { useEscape } from '../lib/escape';
import { CropDialog } from './CropDialog';
import { AVATAR_DECOS, CARD_ARTS } from '../lib/decoArt';
import { cropStyle } from './ProfileCard';
import { type Crop, BANNER_PRESETS, EFFECT_MOTIONS, NAME_FILLS, NAME_FINISHES, nameEffectAttrs, NAME_FONTS, GEN_AVATAR_FRAMES, GEN_CARD_FRAMES, GEN_EFFECTS, GEN_NAMEPLATES, GEN_SHAPES, GEN_THEMES, plateProps, type Decor } from '../lib/cosmetics';
import { EmojiButton } from './EmojiPicker';

export const EDITABLE_KEYS: (keyof EditableProfile)[] = [
  'username', 'display_name', 'custom_status', 'status_emoji', 'bio', 'avatar_url', 'avatar_frame', 'banner_url', 'primary_color',
  'accent_color', 'custom_css', 'audio_status_url', 'theme_preset', 'pronouns', 'name_font', 'name_effect', 'name_color_a', 'name_color_b',
  'profile_effect', 'card_style', 'avatar_shape', 'profile_links', 'nameplate', 'card_frame', 'profile_widgets', 'decor',
];

export function toDraft(p: UserProfile): EditableProfile {
  return Object.fromEntries(EDITABLE_KEYS.map((k) => [k, p[k]])) as EditableProfile;
}

export const FRAME_LABELS = Object.fromEntries(AVATAR_FRAMES.map((f) => [f.id, f.label]));
export const SHAPES: { id: AvatarShape; label: string }[] = [
  { id: 'circle', label: 'Circle' },
  { id: 'squircle', label: 'Squircle' },
  { id: 'hexagon', label: 'Hexagon' },
];
export const EFFECTS: { id: ProfileEffect; label: string }[] = [
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
  { id: 'embers', label: 'Embers' },
  { id: 'leaves', label: 'Autumn' },
  { id: 'music', label: 'Music' },
  { id: 'lightning', label: 'Lightning' },
];
export const CARDS: { id: CardStyle; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'glass', label: 'Glass' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'holo', label: 'Holographic' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'ocean', label: 'Deep Sea' },
  { id: 'noir', label: 'Noir' },
];
export const FONTS: { id: NameFont; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' },
  { id: 'handwritten', label: 'Script' },
  { id: 'mono', label: 'Mono' },
  { id: 'pixel', label: 'Pixel' },
];
export const NAME_EFFECTS: { id: NameEffect; label: string }[] = [
  { id: 'none', label: 'Plain' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'glow', label: 'Glow' },
  { id: 'neon', label: 'Neon' },
  { id: 'fire', label: 'Fire' },
  { id: 'ice', label: 'Ice' },
  { id: 'chrome', label: 'Chrome' },
  { id: 'pastel', label: 'Pastel' },
  { id: 'toxic', label: 'Toxic' },
  { id: 'glitch', label: 'Glitch' },
];
export const COLOR_PRESETS: [string, string][] = [
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
export function MiniCard({ profile }: { profile: UserProfile }) {
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
  options: { id: T; label: string; group?: string }[];
  current: T;
  base: UserProfile;
  apply: (id: T) => Partial<UserProfile>;
  renderTile: (preview: UserProfile, id: T) => ReactNode;
  extra?: (hovered: T) => ReactNode;
  /** Replaces the profile card in the preview column. */
  aside?: (preview: UserProfile) => ReactNode;
  onApply: (patch: Partial<UserProfile>) => void;
  onClose: () => void;
}

/** Grid of options on the left, your live card on the right. Hover to try, click to select, Apply to keep. */
export function Picker<T extends string>({ title, options, current, base, apply, renderTile, extra, aside, onApply, onClose }: PickerProps<T>) {
  const [selected, setSelected] = useState<T>(current);
  const [hovered, setHovered] = useState<T | null>(null);
  const groups = [...new Set(options.map((o) => o.group).filter(Boolean))] as string[];
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(36);
  const q = query.trim().toLowerCase();
  const filtered = options.filter((o) => (!group || o.group === group) && (!q || o.label.toLowerCase().includes(q)));
  const shown = hovered ?? selected;
  const preview = { ...base, ...apply(shown) } as UserProfile;

  useEscape(() => onClose(), true);

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
            {options.length > 20 && (
              <div className="mb-3 space-y-2">
                <div className="ae-field">
                  <SearchIcon size={15} />
                  <input className="ae-input" placeholder={`Search ${options.length} options`} value={query} onChange={(e) => (setQuery(e.target.value), setLimit(36))} />
                </div>
                {groups.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {[null, ...groups].map((g) => (
                      <button
                        key={g ?? 'all'}
                        type="button"
                        onClick={() => (setGroup(g), setLimit(36))}
                        className={`rounded-full border px-2.5 py-0.5 text-xs ${group === g ? 'border-ae-accent bg-ae-accent/15 font-semibold' : 'border-ae-border text-ae-muted hover:text-ae-text'}`}
                      >
                        {g ?? 'All'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2.5 lg:grid-cols-4" onMouseLeave={() => setHovered(null)}>
              {filtered.slice(0, limit).map((o) => (
                <div
                  key={o.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected === o.id}
                  onMouseEnter={() => setHovered(o.id)}
                  onFocus={() => setHovered(o.id)}
                  onClick={() => setSelected(o.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSelected(o.id))}
                  className={`ae-enter group relative cursor-pointer overflow-hidden rounded-ae border-2 bg-ae-sunken p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                    selected === o.id ? 'border-ae-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--ae-accent)_25%,transparent)]' : 'border-transparent hover:border-ae-border'
                  }`}
                >
                  {renderTile({ ...base, ...apply(o.id) } as UserProfile, o.id)}
                  <p className="mt-1.5 truncate text-center text-xs font-semibold">{o.label}</p>
                  {current === o.id && <span className="absolute top-1.5 left-1.5 rounded bg-ae-surface px-1.5 text-[9px] font-bold text-ae-muted uppercase">current</span>}
                  {selected === o.id && <span className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-ae-accent text-[11px] text-ae-on-accent"><CheckIcon size={13} /></span>}
                </div>
              ))}
            </div>
            {filtered.length > limit && (
              <button type="button" className="mt-3 w-full rounded-ae border border-ae-border py-2 text-sm text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={() => setLimit((l) => l + 48)}>
                Show more ({filtered.length - limit} left)
              </button>
            )}
            {filtered.length === 0 && <p className="py-8 text-center text-sm text-ae-muted">Nothing matches.</p>}
            {extra?.(shown)}
          </div>
          <aside className="hidden w-[380px] shrink-0 flex-col items-center gap-3 border-l border-ae-border bg-ae-sunken/50 p-5 md:flex">
            <p className="self-start text-[11px] font-bold tracking-wide text-ae-muted uppercase">Preview</p>
            {aside ? aside(preview) : <ProfileCard profile={preview} />}
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

export function CustomizeRow({ icon, title, value, onChange, children }: { icon: ReactNode; title: string; value: ReactNode; onChange: () => void; children?: ReactNode }) {
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

export function ImageSlot({ label, url, round, userId, kind, onChange, crop, onCrop }: {
  label: string;
  url: string | null;
  round?: boolean;
  userId: string;
  kind: 'avatar' | 'banner';
  onChange: (url: string | null) => void;
  /** When given, offers crop & zoom (right after uploading, and with "Adjust"). */
  crop?: Crop;
  onCrop?: (c: Crop | undefined) => void;
}) {
  const upload = useUploadProfileMedia(userId);
  const [cropping, setCropping] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-ae border border-ae-border bg-ae-surface/30 p-2.5">
      <div className={`grid shrink-0 place-items-center overflow-hidden bg-ae-sunken ${round ? 'h-14 w-14 rounded-full' : 'h-14 w-24 rounded-ae'}`}>
        {url ? <img src={url} alt="" className="h-full w-full object-cover" style={cropStyle(crop)} /> : <span className="text-xs text-ae-muted">none</span>}
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
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file)
                  upload.mutate(
                    { file, kind },
                    {
                      onSuccess: (u) => {
                        onChange(u);
                        if (onCrop) {
                          onCrop(undefined); // new picture: start centred
                          setCropping(u);
                        }
                      },
                      onError: (err) => toast.error(err.message),
                    },
                  );
              }}
            />
            <button type="button" className="ae-press rounded bg-ae-accent px-2.5 py-1 font-semibold text-ae-on-accent" onClick={() => ref.current?.click()}>
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </button>
            <button type="button" className="rounded px-2 py-1 text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={() => setLinking(true)}>
              Link
            </button>
            {url && onCrop && (
              <button type="button" className="rounded px-2 py-1 text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={() => setCropping(url)}>
                Adjust
              </button>
            )}
            {url && (
              <button type="button" className="rounded px-2 py-1 text-ae-danger hover:bg-ae-hover" onClick={() => onChange(null)}>
                Remove
              </button>
            )}
          </div>
        )}
      </div>
      {cropping && onCrop && <CropDialog url={cropping} kind={kind} value={crop} onSave={onCrop} onClose={() => setCropping(null)} />}
    </div>
  );
}

export type PickerKind = 'frame' | 'shape' | 'effect' | 'card' | 'name' | 'colors' | 'plate' | 'cardframe';

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
  const openStudio = useUiStore((s) => s.openStudio);

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
        <button
          type="button"
          onClick={() => openStudio()}
          className="ae-lift group flex w-full items-center gap-4 overflow-hidden rounded-ae border border-ae-border p-4 text-left"
          style={{ background: 'linear-gradient(120deg, color-mix(in srgb, var(--ae-accent) 30%, transparent), transparent 70%)' }}
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-ae bg-ae-accent text-ae-on-accent">
            <SparklesIcon size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">Open Profile Studio</span>
            <span className="block text-sm text-ae-muted">Nameplates, frames, effects and your profile board, with a full-size live preview.</span>
          </span>
          <ChevronRightIcon size={18} className="text-ae-muted transition-transform group-hover:translate-x-1" />
        </button>
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
                <EmojiButton value={text('status_emoji')} onChange={(e) => setText('status_emoji', e ?? '')} />
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
            <ImageSlot label="Avatar" round url={draft.avatar_url} userId={userId} kind="avatar" onChange={(u) => set({ avatar_url: u })} crop={draft.decor?.avatarCrop} onCrop={(c) => set({ decor: { ...(draft.decor ?? {}), avatarCrop: c } })} />
            <ImageSlot label="Banner" url={draft.banner_url} userId={userId} kind="banner" onChange={(u) => set({ banner_url: u })} crop={draft.decor?.bannerCrop} onCrop={(c) => set({ decor: { ...(draft.decor ?? {}), bannerCrop: c } })} />
          </div>
        </Section>

        <Section title="Customize" description="Click Change to browse every option. Hover one to try it on your card.">
          <div className="space-y-2">
            <CustomizeRow icon={<SparklesIcon size={18} />} title="Avatar decoration" value={FRAME_LABELS[draft.avatar_frame ?? 'none'] ?? 'None'} onChange={() => setPicker('frame')} />
            <CustomizeRow icon={<ShapeIcon size={18} />} title="Avatar shape" value={SHAPES.find((s) => s.id === (draft.avatar_shape ?? 'circle'))?.label} onChange={() => setPicker('shape')} />
            <CustomizeRow icon={<SparklesIcon size={18} />} title="Profile effect" value={EFFECTS.find((e) => e.id === (draft.profile_effect ?? 'none'))?.label} onChange={() => setPicker('effect')} />
            <CustomizeRow icon={<NameplateIcon size={18} />} title="Nameplate" value={NAMEPLATES.find((n) => n.id === (draft.nameplate || 'none'))?.label} onChange={() => setPicker('plate')} />
            <CustomizeRow icon={<FrameIcon size={18} />} title="Profile frame" value={CARD_FRAMES.find((n) => n.id === (draft.card_frame || 'none'))?.label} onChange={() => setPicker('cardframe')} />
            <CustomizeRow icon={<IdCardIcon size={18} />} title="Card style" value={CARDS.find((c) => c.id === (draft.card_style ?? 'solid'))?.label} onChange={() => setPicker('card')} />
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
            <CustomizeRow icon={<PaletteIcon size={18} />} title="Profile colours" value="Banner and accent colours" onChange={() => setPicker('colors')}>
              <span className="flex">
                <span className="h-6 w-6 rounded-full border-2 border-ae-elevated" style={{ background: draft.primary_color ?? DEFAULT_PROFILE_PRIMARY }} />
                <span className="-ml-2 h-6 w-6 rounded-full border-2 border-ae-elevated" style={{ background: draft.accent_color ?? DEFAULT_PROFILE_ACCENT }} />
              </span>
            </CustomizeRow>
          </div>
        </Section>

        <Section title="Links" description="Up to 5 https links, shown as buttons on your card.">
          <div className="space-y-1.5">
            {links.map((l: ProfileLink, i: number) => (
              <div key={`${l.url}-${i}`} className="ae-enter flex items-center gap-2 rounded-ae bg-ae-surface px-3 py-1.5 text-sm">
                <span className="font-semibold"><LinkIcon size={15} className="ae-ico" /> {l.label}</span>
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
            <ChevronRightIcon size={14} className={`transition-transform ${advanced ? 'rotate-90' : ''}`} /> Advanced: audio status and profile CSS
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

      <ExtraPickers picker={picker} draft={draft} merged={merged} applyPatch={applyPatch} close={() => setPicker(null)} />
    </div>
  );
}

/** Name style has two dimensions (font and effect) plus colours, so it gets its own picker. */
export function NamePicker({ base, onApply, onClose }: { base: UserProfile; onApply: (p: Partial<UserProfile>) => void; onClose: () => void }) {
  const [font, setFont] = useState<NameFont>(base.name_font ?? 'default');
  const [effect, setEffect] = useState<NameEffect>(base.name_effect ?? 'none');
  const [a, setA] = useState<string | null>(base.name_color_a);
  const [b, setB] = useState<string | null>(base.name_color_b);
  const [hover, setHover] = useState<{ font?: NameFont; effect?: NameEffect } | null>(null);
  const [tab, setTab] = useState<'font' | 'effect'>('font');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [limit, setLimit] = useState(48);
  const preview = { ...base, name_font: hover?.font ?? font, name_effect: hover?.effect ?? effect, name_color_a: a, name_color_b: b } as UserProfile;

  const fonts = [...FONTS.map((f) => ({ id: f.id as string, label: f.label, group: 'Classic' })), ...NAME_FONTS.map((f) => ({ id: f.id, label: f.label, group: f.group }))];
  const finish = nameEffectAttrs(effect).tr ?? 'plain';
  const effects = [...NAME_EFFECTS.map((f) => ({ id: f.id as string, label: f.label, group: 'Classic' })), ...NAME_FILLS.map(([f, label]) => ({ id: `fx-${f}-${finish}`, label, group: 'Fills' }))];
  const list = tab === 'font' ? fonts : effects;
  const groups = [...new Set(list.map((o) => o.group))];
  const q = query.trim().toLowerCase();
  const shown = list.filter((o) => (!group || o.group === group) && (!q || o.label.toLowerCase().includes(q)));
  const switchTab = (t: 'font' | 'effect') => {
    setTab(t);
    setGroup(null);
    setQuery('');
    setLimit(48);
  };
  const tile = (active: boolean) =>
    `rounded-ae border-2 bg-ae-sunken px-2 py-3 text-center transition-all hover:-translate-y-0.5 ${active ? 'border-ae-accent' : 'border-transparent hover:border-ae-border'}`;

  return (
    <Dialog wide title="Name style" onClose={onClose}>
      <div className="rounded-ae border border-ae-border bg-ae-sunken/60 px-4 py-3 text-center">
        <p className="text-2xl font-bold">
          <StyledName profile={preview} />
        </p>
        <p className="text-xs text-ae-muted">@{base.username}</p>
      </div>
      <div className="flex gap-1 rounded-ae bg-ae-sunken/50 p-1">
        {(['font', 'effect'] as const).map((t) => (
          <button key={t} type="button" onClick={() => switchTab(t)} className={`flex-1 rounded-ae py-1.5 text-sm ${tab === t ? 'bg-ae-surface font-semibold' : 'text-ae-muted hover:text-ae-text'}`}>
            {t === 'font' ? `Fonts (${fonts.length})` : `Effects (${effects.length})`}
          </button>
        ))}
      </div>
      <div className="ae-field">
        <SearchIcon size={15} />
        <input className="ae-input" placeholder={tab === 'font' ? 'Search fonts' : 'Search effects'} value={query} onChange={(e) => (setQuery(e.target.value), setLimit(48))} />
      </div>
      <div className="flex flex-wrap gap-1">
        {[null, ...groups].map((g) => (
          <button key={g ?? 'all'} type="button" onClick={() => (setGroup(g), setLimit(48))} className={`rounded-full border px-2.5 py-0.5 text-xs ${group === g ? 'border-ae-accent bg-ae-accent/15 font-semibold' : 'border-ae-border text-ae-muted hover:text-ae-text'}`}>
            {g ?? 'All'}
          </button>
        ))}
      </div>
      <div className="ae-scroll grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3" onMouseLeave={() => setHover(null)}>
        {shown.slice(0, limit).map((o) =>
          tab === 'font' ? (
            <button key={o.id} type="button" className={tile(font === o.id)} onMouseEnter={() => setHover({ font: o.id })} onClick={() => setFont(o.id)}>
              <StyledName profile={{ ...preview, name_font: o.id, name_effect: 'none' }} className="block truncate text-base font-semibold" />
              <span className="mt-1 block truncate text-[11px] text-ae-muted">{o.label}</span>
            </button>
          ) : (
            <button key={o.id} type="button" className={tile(effect === o.id)} onMouseEnter={() => setHover({ effect: o.id })} onClick={() => setEffect(o.id)}>
              <StyledName profile={{ ...preview, name_effect: o.id }} className="block truncate text-base font-semibold" />
              <span className="mt-1 block truncate text-[11px] text-ae-muted">{o.label}</span>
            </button>
          ),
        )}
        {shown.length > limit && (
          <button type="button" className="col-span-full rounded-ae border border-ae-border py-2 text-sm text-ae-muted hover:bg-ae-hover" onClick={() => setLimit((l) => l + 48)}>
            Show more ({shown.length - limit} left)
          </button>
        )}
      </div>
      {tab === 'effect' && nameEffectAttrs(effect).fill && (
        <div>
          <p className="mb-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Finish</p>
          <div className="flex flex-wrap gap-1.5">
            {NAME_FINISHES.map(([t, label]) => (
              <button key={t} type="button" onClick={() => setEffect(`fx-${nameEffectAttrs(effect).fill}-${t}`)} className={`rounded-full border px-3 py-1 text-xs ${finish === t ? 'border-ae-accent bg-ae-accent/15 font-semibold' : 'border-ae-border text-ae-muted hover:text-ae-text'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {effect !== 'none' && effect !== 'rainbow' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorField label="Colour 1" value={a} onChange={setA} />
          <ColorField label="Colour 2" value={b} onChange={setB} />
        </div>
      )}
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

/** A member-list row with a nameplate behind it, for picker tiles and previews. */
export function NameplateRow({ profile, className = '' }: { profile: UserProfile; className?: string }) {
  return (
    <div className={`ae-plate flex items-center gap-2 overflow-hidden rounded-ae px-2 py-1.5 ${className}`} {...plateProps(profile.nameplate, profile.decor)}>
      <Avatar profile={profile} size={32} showFrame={false} />
      <span className="min-w-0">
        <StyledName profile={profile} className="block truncate text-sm font-semibold" />
        <span className="block truncate text-[11px] text-ae-muted">{profile.custom_status || 'Online'}</span>
      </span>
    </div>
  );
}

/** Pickers for nameplates and profile frames (shared by the settings page and Profile Studio). */
export function ExtraPickers({ picker, draft, merged, applyPatch, close }: { picker: PickerKind | null; draft: EditableProfile; merged: UserProfile; applyPatch: (p: Partial<UserProfile>) => void; close: () => void }) {
  const decor = (draft.decor ?? {}) as Decor;
  const setDecor = (patch: Partial<Decor>) => applyPatch({ decor: { ...decor, ...patch } } as Partial<UserProfile>);
  const colorRow = (label: string, value: string | undefined, onChange: (v: string | null) => void) => <ColorField label={label} value={value ?? null} onChange={onChange} />;
  const custom = (title: string, children: ReactNode) => (
    <div className="mt-4 space-y-3 rounded-ae border border-ae-border bg-ae-sunken/40 p-3">
      <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">{title}</p>
      {children}
    </div>
  );
  const tileAvatar = (size: number) => (p: UserProfile) => (
    <div className="grid h-24 place-items-center">
      <Avatar profile={p} size={size} />
    </div>
  );

  if (picker === 'frame')
    return (
      <Picker
        title="Avatar decoration"
        options={[...AVATAR_DECOS.map((d) => ({ id: d.id, label: d.label, group: d.group })), ...GEN_AVATAR_FRAMES, ...AVATAR_FRAMES.map((f) => ({ id: f.id as string, label: f.label, group: 'Classic' }))]}
        current={draft.avatar_frame ?? 'none'}
        base={merged}
        apply={(id) => ({ avatar_frame: id === 'none' ? null : id })}
        renderTile={tileAvatar(60)}
        extra={() =>
          custom(
            'Colours (decorations and rings; leave empty for the defaults)',
            <div className="grid gap-3 sm:grid-cols-2">
              {colorRow('Main colour', decor.deco?.[0] ?? decor.frame?.[0], (v) =>
                setDecor(v ? { deco: [v, decor.deco?.[1] ?? v], frame: [v, decor.frame?.[1] ?? v] } : { deco: undefined, frame: undefined }),
              )}
              {colorRow('Second colour', decor.deco?.[1] ?? decor.frame?.[1], (v) => {
                const a = decor.deco?.[0] ?? decor.frame?.[0] ?? v ?? '#7c5cff';
                setDecor({ deco: [a, v ?? a], frame: [a, v ?? a] });
              })}
            </div>,
          )
        }
        onApply={applyPatch}
        onClose={close}
      />
    );
  if (picker === 'shape')
    return (
      <Picker
        title="Avatar shape"
        options={[...SHAPES.map((x) => ({ id: x.id as string, label: x.label, group: 'Classic' })), ...GEN_SHAPES.map((x) => ({ id: x.id, label: x.label, group: x.group }))]}
        current={draft.avatar_shape ?? 'circle'}
        base={merged}
        apply={(id) => ({ avatar_shape: id })}
        renderTile={tileAvatar(64)}
        onApply={applyPatch}
        onClose={close}
      />
    );
  if (picker === 'effect')
    return (
      <Picker
        title="Profile effect"
        options={[...EFFECTS.map((x) => ({ id: x.id as string, label: x.label, group: 'Classic' })), ...GEN_EFFECTS]}
        current={draft.profile_effect ?? 'none'}
        base={merged}
        apply={(id) => ({ profile_effect: id })}
        renderTile={(p) => <MiniCard profile={p} />}
        extra={() =>
          custom(
            'Colour and direction',
            <>
              <div>
                <p className="mb-1.5 text-xs font-semibold">Motion</p>
                <div className="flex flex-wrap gap-1.5">
                  {EFFECT_MOTIONS.map(([m, label]) => (
                    <button key={m} type="button" onClick={() => setDecor({ effectMotion: m })} className={`rounded-full border px-3 py-1 text-xs ${(decor.effectMotion ?? '') === m ? 'border-ae-accent bg-ae-accent/15 font-semibold' : 'border-ae-border text-ae-muted hover:text-ae-text'}`}>
                      {label}
                    </button>
                  ))}
                  <button type="button" onClick={() => setDecor({ effectMotion: undefined })} className={`rounded-full border px-3 py-1 text-xs ${!decor.effectMotion ? 'border-ae-accent bg-ae-accent/15 font-semibold' : 'border-ae-border text-ae-muted hover:text-ae-text'}`}>
                    Default
                  </button>
                </div>
              </div>
              {colorRow('Particle colour (leave empty for the effect’s own)', decor.effect, (v) => setDecor({ effect: v ?? undefined }))}
              <Slider label="Falling angle" value={decor.effectAngle ?? 12} min={-45} max={45} step={1} format={(v) => `${v}°`} onChange={(v) => setDecor({ effectAngle: v })} />
            </>,
          )
        }
        onApply={applyPatch}
        onClose={close}
      />
    );
  if (picker === 'card')
    return (
      <Picker
        title="Profile theme"
        options={[...CARDS.map((x) => ({ id: x.id as string, label: x.label, group: 'Classic' })), ...GEN_THEMES]}
        current={draft.card_style ?? 'solid'}
        base={merged}
        apply={(id) => ({ card_style: id })}
        renderTile={(p) => <MiniCard profile={p} />}
        extra={() =>
          custom(
            'Theme colours and intensity',
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {colorRow('Colour 1', draft.primary_color ?? undefined, (v) => applyPatch({ primary_color: v }))}
                {colorRow('Colour 2', draft.accent_color ?? undefined, (v) => applyPatch({ accent_color: v }))}
              </div>
              <Slider label="Intensity" value={decor.themeV ?? 3} min={1} max={5} step={1} format={(v) => ['Subtle', 'Soft', 'Balanced', 'Strong', 'Bold'][v - 1]!} onChange={(v) => setDecor({ themeV: v })} />
            </>,
          )
        }
        onApply={applyPatch}
        onClose={close}
      />
    );
  if (picker === 'colors')
    return (
      <Picker
        title="Banner colours"
        options={[{ id: 'current', label: 'Current', group: 'Yours' }, ...BANNER_PRESETS.map((b) => ({ id: `${b.primary}|${b.accent}`, label: b.label, group: b.label.split(' ')[0]! }))]}
        current="current"
        base={merged}
        apply={(id) => (id === 'current' ? {} : { primary_color: id.split('|')[0]!, accent_color: id.split('|')[1]! })}
        renderTile={(p) => <div className="h-20 rounded-ae" style={{ background: `linear-gradient(135deg, ${p.primary_color ?? DEFAULT_PROFILE_PRIMARY}, ${p.accent_color ?? DEFAULT_PROFILE_ACCENT})` }} />}
        extra={() =>
          custom(
            'Custom',
            <div className="grid gap-3 sm:grid-cols-2">
              {colorRow('Banner colour', draft.primary_color ?? undefined, (v) => applyPatch({ primary_color: v }))}
              {colorRow('Accent colour', draft.accent_color ?? undefined, (v) => applyPatch({ accent_color: v }))}
            </div>,
          )
        }
        onApply={applyPatch}
        onClose={close}
      />
    );
  if (picker === 'name') return <NamePicker base={merged} onApply={applyPatch} onClose={close} />;
  if (picker === 'plate')
    return (
      <Picker
        title="Nameplate"
        options={[...NAMEPLATES.map((n) => ({ id: n.id as string, label: n.label, group: 'Classic' })), ...GEN_NAMEPLATES]}
        current={draft.nameplate || 'none'}
        base={merged}
        apply={(id) => ({ nameplate: id })}
        renderTile={(p) => {
          const pp = plateProps(p.nameplate, p.decor);
          return (
            <div className={`ae-plate ae-plate-swatch grid h-20 place-items-center rounded-md bg-ae-bg/60`} data-plate={pp['data-plate']} data-ps={pp['data-ps']} style={pp.style}>
              {(p.nameplate || 'none') === 'none' && <span className="text-xs text-ae-muted">No nameplate</span>}
            </div>
          );
        }}
        aside={(p) => <MemberListMock profile={p} />}
        extra={() =>
          custom(
            'Your colours (for the styles after Classic)',
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) =>
                colorRow(`Colour ${i + 1}`, decor.plate?.[i], (v) => {
                  const next = [...(decor.plate ?? ['#7c5cff', '#c77dff', '#00d4ff'])];
                  next[i] = v ?? next[i]!;
                  setDecor({ plate: v === null && i === 0 ? undefined : next });
                }),
              )}
            </div>,
          )
        }
        onApply={applyPatch}
        onClose={close}
      />
    );
  if (picker === 'cardframe')
    return (
      <Picker
        title="Profile frame"
        options={[...CARD_ARTS.map((a) => ({ id: a.id, label: a.label, group: a.group })), ...CARD_FRAMES.filter((n) => n.id !== 'crimson-roses').map((n) => ({ id: n.id as string, label: n.id === 'roses' ? 'Roses (any colour)' : n.label, group: 'Classic' })), ...GEN_CARD_FRAMES]}
        current={draft.card_frame === 'crimson-roses' ? 'roses' : draft.card_frame || 'none'}
        base={merged}
        apply={(id) => ({ card_frame: id })}
        renderTile={(p) => <MiniCard profile={p} />}
        extra={() =>
          custom(
            'Frame colours (leave empty for the defaults)',
            <div className="grid gap-3 sm:grid-cols-2">
              {colorRow('Main colour', decor.cardFrame, (v) => setDecor({ cardFrame: v ?? undefined }))}
              {colorRow('Second colour', decor.cardFrame2, (v) => setDecor({ cardFrame2: v ?? undefined }))}
            </div>,
          )
        }
        onApply={applyPatch}
        onClose={close}
      />
    );
  return null;
}

/** A fake member list with you in it, for previewing nameplates. */
function MemberListMock({ profile }: { profile: UserProfile }) {
  const others = ['Aria', 'Kai', 'Juniper'];
  return (
    <div className="w-full space-y-0.5 rounded-ae border border-ae-border bg-ae-bg p-2">
      <p className="px-2 pb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Online — 4</p>
      <div className="px-0.5">
        <NameplateRow profile={profile} />
      </div>
      {others.map((n, i) => (
        <div key={n} className="flex items-center gap-2 px-2.5 py-1.5 opacity-70">
          <span className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white" style={{ background: ['#5865f2', '#eb459e', '#3ba55d'][i] }}>
            {n[0]}
          </span>
          <span className="text-sm">{n}</span>
        </div>
      ))}
    </div>
  );
}
