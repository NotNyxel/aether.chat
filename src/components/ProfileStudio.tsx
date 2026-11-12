/**
 * Profile Studio: a full-screen "Edit Profile". Decoration tiles on the left (each opens a picker
 * with a live preview), your full profile in the center, and the profile board on the right.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useProfile, useUpdateProfile } from '../hooks/useChatData';
import { CARD_FRAMES, DEFAULT_PROFILE_ACCENT, DEFAULT_PROFILE_PRIMARY, NAMEPLATES, WIDGET_TYPES, type ProfileWidget } from '../lib/profileDecor';
import { GameArtIcon } from '../lib/activityArt';
import { useUiStore } from '../stores/uiStore';
import type { EditableProfile, UserProfile } from '../types/db';
import { ask } from './ConfirmDialog';
import { FullProfile } from './FullProfile';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  EffectIcon,
  FontIcon,
  FrameIcon,
  IdCardIcon,
  ImageIcon,
  NameplateIcon,
  PaletteIcon,
  PlusIcon,
  ShapeIcon,
  SparklesIcon,
  TrashIcon,
  WidgetIcon,
} from './icons';
import { Avatar, StyledName } from './ProfileCard';
import {
  CARDS,
  EDITABLE_KEYS,
  EFFECTS,
  ExtraPickers,
  FONTS,
  FRAME_LABELS,
  ImageSlot,
  MiniCard,
  NAME_EFFECTS,
  NameplateRow,
  SHAPES,
  toDraft,
  type PickerKind,
} from './ProfileEditor';
import { toast } from './Toaster';
import { useEscape } from '../lib/escape';
import { ALL_COSMETICS } from '../lib/cosmetics';
import { EmojiButton } from './EmojiPicker';

function Tile({ icon, label, value, onClick, children }: { icon: ReactNode; label: string; value?: string; onClick: () => void; children?: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}
      className="ae-lift group relative flex h-[132px] cursor-pointer flex-col overflow-hidden rounded-ae border border-ae-border bg-ae-surface/40 p-2.5 text-left hover:border-ae-accent"
    >
      <div className="pointer-events-none grid min-h-0 flex-1 place-items-center overflow-hidden">{children}</div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="text-ae-muted group-hover:text-ae-accent">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-bold">{label}</span>
          {value && <span className="block truncate text-[11px] text-ae-muted">{value}</span>}
        </span>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">{label}</span>
      {children}
    </label>
  );
}

function blankWidget(type: ProfileWidget['type']): ProfileWidget {
  switch (type) {
    case 'favorite_game':
      return { type, name: '', note: '' };
    case 'games':
      return { type, names: [] };
    case 'music':
      return { type, title: '', artist: '' };
    case 'about':
      return { type, title: 'About', text: '' };
    case 'quote':
      return { type, text: '' };
  }
}

function GamesEditor({ names, onChange }: { names: string[]; onChange: (n: string[]) => void }) {
  const [q, setQ] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {names.map((n) => (
          <span key={n} className="flex items-center gap-1.5 rounded-full bg-ae-surface py-0.5 pr-1.5 pl-0.5 text-xs">
            <GameArtIcon name={n} size={20} rounded="rounded-full" />
            {n}
            <button type="button" aria-label={`Remove ${n}`} className="text-ae-muted hover:text-ae-danger" onClick={() => onChange(names.filter((x) => x !== n))}>
              <CloseIcon size={12} />
            </button>
          </span>
        ))}
      </div>
      {names.length < 6 && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const v = q.trim().slice(0, 80);
            if (v && !names.includes(v)) onChange([...names, v]);
            setQ('');
          }}
        >
          <input className="ae-input w-full !py-1.5 text-sm" placeholder="Add a game…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="ae-press shrink-0 rounded-ae bg-ae-surface px-3 text-sm hover:bg-ae-hover">
            Add
          </button>
        </form>
      )}
    </div>
  );
}

function WidgetEditor({ w, onChange }: { w: ProfileWidget; onChange: (w: ProfileWidget) => void }) {
  const cls = 'ae-input w-full !py-1.5 text-sm';
  switch (w.type) {
    case 'favorite_game':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {w.name && <GameArtIcon name={w.name} size={34} />}
            <input className={cls} maxLength={80} placeholder="Game name" value={w.name} onChange={(e) => onChange({ ...w, name: e.target.value })} />
          </div>
          <input className={cls} maxLength={140} placeholder="Why you love it (optional)" value={w.note ?? ''} onChange={(e) => onChange({ ...w, note: e.target.value })} />
        </div>
      );
    case 'games':
      return <GamesEditor names={w.names} onChange={(names) => onChange({ ...w, names })} />;
    case 'music':
      return (
        <div className="grid grid-cols-2 gap-2">
          <input className={cls} maxLength={120} placeholder="Song" value={w.title} onChange={(e) => onChange({ ...w, title: e.target.value })} />
          <input className={cls} maxLength={120} placeholder="Artist" value={w.artist} onChange={(e) => onChange({ ...w, artist: e.target.value })} />
        </div>
      );
    case 'about':
      return (
        <div className="space-y-2">
          <input className={cls} maxLength={40} placeholder="Title" value={w.title} onChange={(e) => onChange({ ...w, title: e.target.value })} />
          <textarea className={`${cls} min-h-16`} maxLength={600} placeholder="Anything you like" value={w.text} onChange={(e) => onChange({ ...w, text: e.target.value })} />
        </div>
      );
    case 'quote':
      return <textarea className={`${cls} min-h-14`} maxLength={280} placeholder="A quote" value={w.text} onChange={(e) => onChange({ ...w, text: e.target.value })} />;
  }
}

/** Drops empty widgets before saving. */
function cleanWidgets(ws: ProfileWidget[]): ProfileWidget[] {
  return ws.filter((w) => {
    switch (w.type) {
      case 'favorite_game':
        return !!w.name.trim();
      case 'games':
        return w.names.length > 0;
      case 'music':
        return !!w.title.trim();
      case 'about':
      case 'quote':
        return !!w.text.trim();
    }
  });
}

function BoardEditor({ widgets, onChange }: { widgets: ProfileWidget[]; onChange: (w: ProfileWidget[]) => void }) {
  const [adding, setAdding] = useState(false);
  const move = (i: number, d: number) => {
    const next = [...widgets];
    const [w] = next.splice(i, 1);
    next.splice(i + d, 0, w!);
    onChange(next);
  };
  return (
    <div className="space-y-2.5">
      {widgets.map((w, i) => (
        <div key={i} className="ae-enter rounded-ae border border-ae-border bg-ae-surface/40 p-3">
          <div className="mb-2 flex items-center gap-1">
            <span className="flex-1 text-xs font-bold">{WIDGET_TYPES.find((t) => t.type === w.type)?.label}</span>
            <button type="button" aria-label="Move up" disabled={i === 0} className="rounded p-1 text-ae-muted hover:bg-ae-hover hover:text-ae-text disabled:opacity-30" onClick={() => move(i, -1)}>
              <ChevronUpIcon size={14} />
            </button>
            <button type="button" aria-label="Move down" disabled={i === widgets.length - 1} className="rounded p-1 text-ae-muted hover:bg-ae-hover hover:text-ae-text disabled:opacity-30" onClick={() => move(i, 1)}>
              <ChevronDownIcon size={14} />
            </button>
            <button type="button" aria-label="Remove widget" className="rounded p-1 text-ae-muted hover:bg-ae-hover hover:text-ae-danger" onClick={() => onChange(widgets.filter((_, j) => j !== i))}>
              <TrashIcon size={14} />
            </button>
          </div>
          <WidgetEditor w={w} onChange={(nw) => onChange(widgets.map((x, j) => (j === i ? nw : x)))} />
        </div>
      ))}
      {widgets.length < 6 &&
        (adding ? (
          <div className="ae-pop grid gap-1.5 rounded-ae border border-ae-border bg-ae-elevated p-2">
            {WIDGET_TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                className="rounded-ae px-3 py-2 text-left hover:bg-ae-hover"
                onClick={() => {
                  onChange([...widgets, blankWidget(t.type)]);
                  setAdding(false);
                }}
              >
                <span className="block text-sm font-semibold">{t.label}</span>
                <span className="block text-xs text-ae-muted">{t.hint}</span>
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center justify-center gap-2 rounded-ae border border-dashed border-ae-border py-3 text-sm text-ae-muted hover:border-ae-accent hover:text-ae-text"
          >
            <PlusIcon size={16} /> Add a widget
          </button>
        ))}
    </div>
  );
}

function Studio({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data: profile } = useProfile(userId);
  const update = useUpdateProfile(userId);
  const [draft, setDraft] = useState<EditableProfile | null>(null);
  const [picker, setPicker] = useState<PickerKind | null>(null);

  useEffect(() => {
    if (profile && !draft) setDraft(toDraft(profile));
  }, [profile, draft]);

  const dirty = useMemo(
    () => !!profile && !!draft && EDITABLE_KEYS.some((k) => JSON.stringify(draft[k] ?? null) !== JSON.stringify(profile[k] ?? null)),
    [profile, draft],
  );

  const close = async () => {
    if (dirty && !(await ask('You have unsaved changes to your profile.', { title: 'Discard changes?', confirmLabel: 'Discard', danger: true }))) return;
    onClose();
  };

  useEscape(() => void close());

  if (!profile || !draft) return <div className="ae-skeleton m-8 h-[60vh]" />;

  const merged = { ...profile, ...draft } as UserProfile;
  const set = (patch: Partial<EditableProfile>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const applyPatch = (patch: Partial<UserProfile>) => set(patch as Partial<EditableProfile>);
  const text = (k: keyof EditableProfile) => (draft[k] as string | null) ?? '';
  const setText = (k: keyof EditableProfile, v: string) => set({ [k]: v === '' ? null : v } as Partial<EditableProfile>);
  const widgets = (draft.profile_widgets ?? []) as ProfileWidget[];

  const save = () => {
    const patch: Partial<EditableProfile> = {};
    const next = { ...draft, profile_widgets: cleanWidgets(widgets) };
    for (const k of EDITABLE_KEYS)
      if (JSON.stringify(next[k] ?? null) !== JSON.stringify(profile[k] ?? null)) (patch as Record<string, unknown>)[k] = next[k];
    if ('custom_status' in patch || 'status_emoji' in patch) patch.custom_status_expires_at = null;
    update.mutate(patch, {
      onSuccess: (p) => {
        setDraft(toDraft(p));
        toast.success('Profile saved.');
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const label = <T extends { id: string; label: string }>(list: readonly T[], id: string | null | undefined, fallback: string) =>
    list.find((x) => x.id === (id || fallback))?.label ?? ALL_COSMETICS.get(id || fallback) ?? (id || fallback);

  return (
    <div className="ae-fade absolute inset-0 z-50 flex flex-col bg-ae-bg" role="dialog" aria-label="Edit profile">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ae-border px-4">
        <button type="button" onClick={() => void close()} className="ae-press grid h-9 w-9 place-items-center rounded-full hover:bg-ae-hover" aria-label="Back">
          <ArrowLeftIcon size={18} />
        </button>
        <h1 className="text-lg font-bold">Edit Profile</h1>
        <span className="ml-auto" />
        {dirty && (
          <button type="button" className="rounded-ae px-3 py-1.5 text-sm text-ae-muted hover:text-ae-text" onClick={() => setDraft(toDraft(profile))}>
            Reset
          </button>
        )}
        <button
          type="button"
          disabled={!dirty || update.isPending}
          onClick={save}
          className="ae-press rounded-ae bg-ae-accent px-5 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-40"
        >
          {update.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: decorations and details */}
        <aside className="ae-scroll w-[340px] shrink-0 space-y-5 overflow-y-auto border-r border-ae-border p-4">
          <section>
            <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Customize</p>
            <div className="grid grid-cols-2 gap-2">
              <Tile icon={<NameplateIcon size={14} />} label="Nameplate" value={label(NAMEPLATES, draft.nameplate, 'none')} onClick={() => setPicker('plate')}>
                <NameplateRow profile={merged} className="w-full scale-90" />
              </Tile>
              <Tile icon={<SparklesIcon size={14} />} label="Avatar decoration" value={FRAME_LABELS[draft.avatar_frame ?? 'none'] ?? ALL_COSMETICS.get(draft.avatar_frame ?? '') ?? 'None'} onClick={() => setPicker('frame')}>
                <Avatar profile={merged} size={48} />
              </Tile>
              <Tile icon={<ShapeIcon size={14} />} label="Avatar shape" value={label(SHAPES, draft.avatar_shape, 'circle')} onClick={() => setPicker('shape')}>
                <Avatar profile={merged} size={44} showFrame={false} />
              </Tile>
              <Tile icon={<PaletteIcon size={14} />} label="Banner colours" value="Banner and accent" onClick={() => setPicker('colors')}>
                <span className="h-12 w-full rounded-md" style={{ background: `linear-gradient(135deg, ${draft.primary_color ?? DEFAULT_PROFILE_PRIMARY}, ${draft.accent_color ?? DEFAULT_PROFILE_ACCENT})` }} />
              </Tile>
              <Tile icon={<EffectIcon size={14} />} label="Profile effect" value={label(EFFECTS, draft.profile_effect, 'none')} onClick={() => setPicker('effect')}>
                <MiniCard profile={merged} />
              </Tile>
              <Tile icon={<FrameIcon size={14} />} label="Profile frame" value={label(CARD_FRAMES, draft.card_frame, 'none')} onClick={() => setPicker('cardframe')}>
                <MiniCard profile={merged} />
              </Tile>
              <Tile icon={<FontIcon size={14} />} label="Display name style" value={`${label(FONTS, draft.name_font, 'default')} · ${label(NAME_EFFECTS, draft.name_effect, 'none')}`} onClick={() => setPicker('name')}>
                <StyledName profile={merged} className="text-lg font-bold" />
              </Tile>
              <Tile icon={<IdCardIcon size={14} />} label="Profile theme" value={label(CARDS, draft.card_style, 'solid')} onClick={() => setPicker('card')}>
                <MiniCard profile={merged} />
              </Tile>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Details</p>
            <Labeled label="Display name">
              <input className="ae-input w-full" maxLength={64} value={text('display_name')} onChange={(e) => setText('display_name', e.target.value)} />
            </Labeled>
            <Labeled label="Pronouns">
              <input className="ae-input w-full" maxLength={40} placeholder="they/them" value={text('pronouns')} onChange={(e) => setText('pronouns', e.target.value)} />
            </Labeled>
            <Labeled label="Status">
              <div className="flex gap-2">
                <EmojiButton value={text('status_emoji')} onChange={(e) => setText('status_emoji', e ?? '')} />
                <input className="ae-input w-full" maxLength={128} placeholder="What's up?" value={text('custom_status')} onChange={(e) => setText('custom_status', e.target.value)} />
              </div>
            </Labeled>
            <Labeled label="About me">
              <textarea className="ae-input min-h-24 w-full" maxLength={4000} value={text('bio')} onChange={(e) => setText('bio', e.target.value)} />
            </Labeled>
            <div className="space-y-2">
              <ImageSlot label="Avatar" round url={draft.avatar_url} userId={userId} kind="avatar" onChange={(u) => set({ avatar_url: u })} crop={draft.decor?.avatarCrop} onCrop={(c) => set({ decor: { ...(draft.decor ?? {}), avatarCrop: c } })} />
              <ImageSlot label="Banner" url={draft.banner_url} userId={userId} kind="banner" onChange={(u) => set({ banner_url: u })} crop={draft.decor?.bannerCrop} onCrop={(c) => set({ decor: { ...(draft.decor ?? {}), bannerCrop: c } })} />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-ae-muted">
              <ImageIcon size={12} /> Links, audio status and profile CSS are in Settings → Profiles.
            </p>
          </section>
        </aside>

        {/* Center: the live profile */}
        <main className="ae-scroll min-w-0 flex-1 overflow-y-auto bg-ae-sunken/40 p-6">
          <div className="mx-auto max-w-[760px] space-y-4">
            <FullProfile
              profile={{ ...merged, profile_widgets: widgets }}
              boardEmpty={<div className="grid h-28 place-items-center rounded-ae border border-dashed border-ae-border text-sm text-ae-muted">Add widgets on the right.</div>}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-ae border border-ae-border bg-ae-elevated p-3">
                <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Member list</p>
                <NameplateRow profile={merged} />
              </div>
              <div className="rounded-ae border border-ae-border bg-ae-elevated p-3">
                <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">In chat</p>
                <div className="flex gap-2.5">
                  <Avatar profile={merged} size={36} />
                  <div className="min-w-0">
                    <StyledName profile={merged} className="text-sm font-semibold" />
                    <p className="text-sm text-ae-text/90">Looking good!</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Right: the board */}
        <aside className="ae-scroll w-[340px] shrink-0 overflow-y-auto border-l border-ae-border p-4">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
            <WidgetIcon size={12} /> Board
          </p>
          <p className="mb-3 text-xs text-ae-muted">Up to six widgets. Games show their real artwork.</p>
          <BoardEditor widgets={widgets} onChange={(w) => set({ profile_widgets: w } as Partial<EditableProfile>)} />
        </aside>
      </div>

      <ExtraPickers picker={picker} draft={draft} merged={merged} applyPatch={applyPatch} close={() => setPicker(null)} />
    </div>
  );
}

export function ProfileStudioLayer({ userId }: { userId: string }) {
  const open = useUiStore((s) => s.studioOpen);
  const closeStudio = useUiStore((s) => s.closeStudio);
  if (!open) return null;
  return <Studio userId={userId} onClose={closeStudio} />;
}
