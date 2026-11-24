/**
 * Clips (2.4): the gallery (your clips and clips shared with you), the editor (trim, audio tracks,
 * rename, keep), sharing into any chat, the card shown in chats, and the settings.
 */
import { comboHasModifier, formatCombo } from '../lib/keybinds';
import { useSettingsStore } from '../stores/settingsStore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { useServers } from '../hooks/useChatData';
import { clipNow, getClip, useClipLibrary, useClipShare, useRecorderStatus, useStoredClips } from '../hooks/useClips';
import { useMeId } from '../hooks/useMe';
import { useConversations } from '../hooks/useSocialData';
import { shareClip, syncClip, useTransfers, type ClipShare } from '../lib/clipShare';
import {
  canRecord,
  defaultFolder,
  deleteClip,
  exportClip,
  ffmpegReady,
  fileUrl,
  fmtDuration,
  fmtSize,
  forgetLocal,
  installFfmpeg,
  localCopies,
  pickFolder,
  removeStored,
  setClipMeta,
  storedFile,
  updateStored,
  useClipSettings,
  type ClipInfo,
  type StoredClip,
} from '../lib/clips';
import { chatKey, encryptText } from '../lib/e2e';
import { t } from '../lib/i18n';
import { useSupabase } from '../lib/supabase';
import type { Channel, Conversation, MessageScope } from '../types/db';
import { ConversationAvatar, useConversationTitle } from './ConversationBits';
import { Dialog } from './Dialog';
import { useE2e } from './E2eChat';
import { CloseIcon, DownloadIcon, FolderIcon, GameIcon, HashIcon, PlayIcon, RecordIcon, SearchIcon, SendIcon, StarIcon, TrashIcon } from './icons';
import { inputCls, Section, Toggle } from './SettingsPanel';
import { toast } from './Toaster';

// ── Open/close from anywhere ────────────────────────────────────────────────────────────────

const useClipsUi = create<{ open: boolean; pickFor: { scope: MessageScope } | null; set: (o: Partial<{ open: boolean; pickFor: { scope: MessageScope } | null }>) => void }>()((set) => ({
  open: false,
  pickFor: null,
  set: (o) => set(o),
}));
export const openClips = () => useClipsUi.getState().set({ open: true, pickFor: null });
/** From a chat's "+" menu: pick a clip to share there. */
export const pickClipFor = (scope: MessageScope) => useClipsUi.getState().set({ open: true, pickFor: { scope } });

// ── One list for clips on a PC and clips kept in the browser ────────────────────────────────

interface Item {
  key: string;
  title: string;
  game: string | null;
  detail: string | null;
  duration: number;
  size: number;
  width: number;
  height: number;
  fps: number;
  created: number;
  received: boolean;
  from: string | null;
  expires: number | null;
  favorite: boolean;
  thumb: string | null;
  pc?: ClipInfo;
  stored?: StoredClip;
}

function useItems(): { items: Item[]; loading: boolean } {
  const pc = useClipLibrary();
  const web = useStoredClips();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let gone = false;
    void (async () => {
      const out: Record<string, string> = {};
      for (const c of pc.data ?? []) if (c.thumb) out[c.path] = await fileUrl(c.thumb);
      for (const s of web.data ?? []) if (s.thumb) out[s.shareId] = URL.createObjectURL(s.thumb);
      if (!gone) setThumbs(out);
    })();
    return () => {
      gone = true;
    };
  }, [pc.data, web.data]);
  const items = useMemo<Item[]>(() => {
    const a: Item[] = (pc.data ?? []).map((c) => ({
      key: c.path,
      title: c.title,
      game: c.meta.game ?? null,
      detail: c.meta.detail ?? null,
      duration: c.duration,
      size: c.size,
      width: c.width,
      height: c.height,
      fps: c.fps,
      created: c.meta.created ?? c.modified,
      received: c.received,
      from: c.meta.from ?? null,
      expires: c.meta.expires ?? null,
      favorite: !!c.meta.favorite,
      thumb: thumbs[c.path] ?? null,
      pc: c,
    }));
    const b: Item[] = (web.data ?? []).map((s) => ({
      key: s.shareId,
      title: s.title,
      game: s.game,
      detail: s.detail,
      duration: s.duration,
      size: s.size,
      width: s.width,
      height: s.height,
      fps: 0,
      created: s.created,
      received: true,
      from: s.from,
      expires: s.expires,
      favorite: false,
      thumb: thumbs[s.shareId] ?? null,
      stored: s,
    }));
    return [...a, ...b].sort((x, y) => y.created - x.created);
  }, [pc.data, web.data, thumbs]);
  return { items, loading: pc.isLoading || web.isLoading };
}

const gameLabel = (i: Pick<Item, 'game' | 'detail'>) => (i.detail && i.game ? `${i.detail} · ${i.game}` : (i.detail ?? i.game ?? t('Desktop')));
const when = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const daysLeft = (ms: number) => Math.max(0, Math.ceil((ms - Date.now()) / 86_400_000));

// ── Gallery ─────────────────────────────────────────────────────────────────────────────────

export function ClipsLayer() {
  const { open, pickFor, set } = useClipsUi();
  if (!open) return null;
  return <Gallery pickFor={pickFor} onClose={() => set({ open: false, pickFor: null })} />;
}

type Tab = 'all' | 'mine' | 'received' | 'favorites';

function Gallery({ pickFor, onClose }: { pickFor: { scope: MessageScope } | null; onClose: () => void }) {
  const { items, loading } = useItems();
  const [tab, setTab] = useState<Tab>(pickFor ? 'mine' : 'all');
  const [game, setGame] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Item | null>(null);
  const [share, setShare] = useState<Item | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !open && !share && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, share, onClose]);

  const games = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) {
      const g = i.detail ?? i.game ?? t('Desktop');
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);
  const shown = items.filter(
    (i) =>
      (tab === 'all' || (tab === 'mine' && !i.received) || (tab === 'received' && i.received) || (tab === 'favorites' && i.favorite)) &&
      (!game || (i.detail ?? i.game ?? t('Desktop')) === game) &&
      (!q.trim() || `${i.title} ${i.game ?? ''} ${i.detail ?? ''} ${i.from ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) &&
      (!pickFor || !!i.pc),
  );
  const totalSize = items.reduce((a, i) => a + i.size, 0);

  return (
    <div className="ae-view-in fixed inset-0 z-[80] flex flex-col bg-ae-bg text-ae-text" role="dialog" aria-modal="true" aria-label={t('Clips')}>
      <header className="flex flex-wrap items-center gap-3 border-b border-ae-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#ff4d6d] to-[#7658fb] text-white">
            <PlayIcon size={16} />
          </span>
          <h1 className="text-xl font-extrabold tracking-tight">{pickFor ? t('Share a clip') : t('Clips')}</h1>
        </div>
        {canRecord && !pickFor && <RecorderPill />}
        <div className="relative ml-auto w-full max-w-xs sm:w-64">
          <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ae-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search clips')} aria-label={t('Search clips')} className="ae-input w-full !pl-9" />
        </div>
        <button type="button" aria-label={t('Close')} onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-ae-hover">
          <CloseIcon size={18} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        {/* Filters: a column on wide screens, chips on narrow ones */}
        <aside className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-ae-border p-3 md:flex">
          {(['all', 'mine', 'received', 'favorites'] as Tab[]).map((k) => (
            <FilterRow key={k} active={tab === k && !game} onClick={() => (setTab(k), setGame(null))} label={k === 'all' ? t('All clips') : k === 'mine' ? t('My clips') : k === 'received' ? t('Shared with me') : t('Favourites')} count={items.filter((i) => k === 'all' || (k === 'mine' && !i.received) || (k === 'received' && i.received) || (k === 'favorites' && i.favorite)).length} />
          ))}
          {games.length > 0 && <p className="mt-4 mb-1 px-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{t('Games')}</p>}
          {games.map(([g, n]) => (
            <FilterRow key={g} active={game === g} onClick={() => setGame(game === g ? null : g)} label={g} count={n} icon={<GameIcon size={14} />} />
          ))}
          <p className="mt-auto px-2 pt-4 text-[11px] text-ae-muted">
            {items.length} {t('clips')} · {fmtSize(totalSize)}
          </p>
        </aside>
        <main className="ae-scroll min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mb-4 flex gap-1.5 overflow-x-auto [scrollbar-width:none] md:hidden">
            {(['all', 'mine', 'received', 'favorites'] as Tab[]).map((k) => (
              <Chip key={k} active={tab === k} onClick={() => setTab(k)}>
                {k === 'all' ? t('All') : k === 'mine' ? t('Mine') : k === 'received' ? t('Shared with me') : t('Favourites')}
              </Chip>
            ))}
            {games.map(([g]) => (
              <Chip key={g} active={game === g} onClick={() => setGame(game === g ? null : g)}>
                {g}
              </Chip>
            ))}
          </div>
          {loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="ae-skeleton aspect-video rounded-2xl" />
              ))}
            </div>
          ) : null}
          {!pickFor && <OtherDevices />}
          {loading ? null : shown.length === 0 ? (
            <Empty pickFor={!!pickFor} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {shown.map((i) => (
                <ClipTile key={i.key} item={i} onOpen={() => (pickFor ? setShare(i) : setOpen(i))} />
              ))}
            </div>
          )}
        </main>
      </div>
      {open && <Editor item={open} onClose={() => setOpen(null)} onShare={() => (setShare(open), setOpen(null))} />}
      {share?.pc && <ShareDialog clip={share.pc} fixedScope={pickFor?.scope ?? null} onClose={() => setShare(null)} onShared={() => (setShare(null), pickFor && onClose())} />}
    </div>
  );
}

function FilterRow({ active, onClick, label, count, icon }: { active: boolean; onClick: () => void; label: string; count: number; icon?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-2 rounded-ae px-2.5 py-2 text-left text-sm ${active ? 'bg-ae-surface font-semibold' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs tabular-nums opacity-70">{count}</span>
    </button>
  );
}
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${active ? 'bg-ae-accent text-ae-on-accent' : 'bg-ae-surface text-ae-muted'}`}>
      {children}
    </button>
  );
}

function Empty({ pickFor }: { pickFor: boolean }) {
  const hotkey = formatCombo(useSettingsStore((x) => x.keybinds.saveClip ?? null)) || t('the clip key');
  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-ae-surface text-ae-muted">
        <RecordIcon size={26} />
      </span>
      <p className="mt-4 text-lg font-bold">{pickFor ? t('No clips to share yet') : t('No clips yet')}</p>
      <p className="mt-1 text-sm text-ae-muted">
        {canRecord ? t('Turn on clipping in Settings → Clips, then press {key} in a game to save the last moments.', { key: hotkey }) : t('Clips your friends share with you show up here. Recording needs the Aether app for Windows.')}
      </p>
    </div>
  );
}

function ClipTile({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => {
        if (!item.pc) return;
        hover.current = setTimeout(() => void fileUrl(item.pc!.path).then(setPreview), 350);
      }}
      onMouseLeave={() => {
        clearTimeout(hover.current);
        setPreview(null);
      }}
      className="group ae-press overflow-hidden rounded-2xl bg-ae-surface text-left ring-1 ring-ae-border transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-xl hover:ring-ae-accent/60"
    >
      <div className="relative aspect-video overflow-hidden bg-black">
        {item.thumb ? <img src={item.thumb} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" loading="lazy" draggable={false} /> : <span className="grid h-full place-items-center text-ae-muted"><PlayIcon size={28} /></span>}
        {preview && <video src={preview} className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline />}
        <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-white tabular-nums">{fmtDuration(item.duration)}</span>
        {item.height > 0 && <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-white">{item.height >= 2160 ? '4K' : `${item.height}p`}{item.fps ? ` · ${Math.round(item.fps)}` : ''}</span>}
        {item.favorite && <span className="absolute top-2 right-2 text-yellow-300"><StarIcon size={16} /></span>}
        {item.received && (
          <span className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${item.expires ? 'bg-black/70 text-white' : 'bg-ae-accent text-ae-on-accent'}`}>
            {item.expires ? t('Deletes in {n}d', { n: daysLeft(item.expires) }) : t('Kept')}
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="truncate font-semibold">{item.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ae-muted">
          <GameIcon size={12} /> <span className="truncate">{gameLabel(item)}</span>
        </p>
        <p className="mt-1 text-[11px] text-ae-muted">
          {item.from ? `${t('From {name}', { name: item.from })} · ` : ''}
          {when(item.created)} · {fmtSize(item.size)}
        </p>
      </div>
    </button>
  );
}

function RecorderPill() {
  const st = useRecorderStatus();
  const enabled = useClipSettings((x) => x.s.enabled);
  const qc = useQueryClient();
  if (!enabled) return <span className="rounded-full bg-ae-surface px-3 py-1 text-xs text-ae-muted">{t('Clipping is off · Settings → Clips')}</span>;
  return (
    <div className="flex items-center gap-2">
      <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${st?.running ? 'bg-red-500/15 text-red-400' : 'bg-ae-surface text-ae-muted'}`}>
        <span className={`h-2 w-2 rounded-full ${st?.running ? 'animate-pulse bg-red-500' : 'bg-ae-muted'}`} />
        {st?.running ? t('Recording the last {n}s', { n: st.seconds }) : t('Waiting for a game')}
      </span>
      {st?.running && (
        <button type="button" onClick={() => void clipNow(qc)} className="rounded-full bg-ae-accent px-3 py-1 text-xs font-bold text-ae-on-accent">
          {t('Clip it')}
        </button>
      )}
    </div>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────────────────────

/** Clips synced from your other devices that aren't on this one yet (2.5). */
function OtherDevices() {
  const sb = useSupabase();
  const me = useMeId();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const { data = [] } = useQuery({
    queryKey: ['clips', 'synced', me],
    enabled: !!me,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await sb.from('clip_shares').select('*').eq('sender_id', me!).eq('scope_id', me!).neq('status', 'gone').order('created_at', { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return data as ClipShare[];
    },
  });
  const have = localCopies();
  const missing = data.filter((c) => !have[c.id]);
  if (!missing.length) return null;
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-xs font-bold tracking-wide text-ae-muted uppercase">{t('On your other devices')}</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {missing.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-xl border border-ae-border bg-ae-surface px-3 py-2">
            <PlayIcon size={15} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{c.title}</span>
              <span className="text-xs text-ae-muted">{[c.detail ?? c.game, fmtDuration(c.duration), fmtSize(c.size_bytes)].filter(Boolean).join(' · ')}</span>
            </span>
            <button
              type="button"
              disabled={busy === c.id}
              className="flex items-center gap-1.5 rounded-full bg-ae-accent px-3 py-1.5 text-xs font-bold text-ae-on-accent disabled:opacity-60"
              onClick={() => {
                setBusy(c.id);
                getClip(sb, me!, c)
                  .then(() => void qc.invalidateQueries({ queryKey: ['clips'] }))
                  .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(null));
              }}
            >
              <DownloadIcon size={13} /> {busy === c.id ? t('Downloading…') : t('Download')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Editor({ item, onClose, onShare }: { item: Item; onClose: () => void; onShare: () => void }) {
  const qc = useQueryClient();
  const sbE = useSupabase();
  const meE = useMeId();
  const [src, setSrc] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number]>([0, item.duration]);
  const [gameAudio, setGameAudio] = useState(true);
  const [mic, setMic] = useState(true);
  const [title, setTitle] = useState(item.title);
  const [busy, setBusy] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hasMic = !!item.pc && (item.pc.audio_tracks.includes('Microphone') || item.pc.audio_tracks.length === 2);

  useEffect(() => {
    let url: string | null = null;
    void (async () => {
      if (item.pc) setSrc(await fileUrl(item.pc.path));
      else if (item.stored) {
        const blob = await storedFile(item.stored.shareId);
        if (blob) setSrc((url = URL.createObjectURL(blob)));
      }
    })();
    return () => void (url && URL.revokeObjectURL(url));
  }, [item]);
  // Keep playback inside the trim range.
  const onTime = () => {
    const v = video.current;
    if (v && (v.currentTime > range[1] || v.currentTime < range[0] - 0.2)) v.currentTime = range[0];
  };
  const refresh = () => void qc.invalidateQueries({ queryKey: ['clips'] });
  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    try {
      await fn();
      if (done) toast.success(done);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const changed = range[0] > 0.05 || range[1] < item.duration - 0.05 || !gameAudio || (hasMic && !mic) || title !== item.title;
  const save = (out: 'replace' | 'copy') =>
    run(
      out === 'replace' ? 'save' : 'copy',
      () => exportClip({ path: item.pc!.path, start: range[0], end: range[1], gameAudio, mic, title, quality: 'original', out }),
      out === 'replace' ? t('Saved') : t('Saved as a new clip'),
    ).then(() => out === 'copy' || onClose());
  const remove = () =>
    run('delete', async () => {
      if (item.pc) await deleteClip(item.pc.path);
      if (item.stored) await removeStored(item.stored.shareId);
      const share = item.pc?.meta.shareId ?? item.stored?.shareId;
      if (share) forgetLocal(share);
    }).then(onClose);
  const keep = () =>
    run('keep', async () => {
      if (item.pc) await setClipMeta(item.pc.path, { expires: null });
      if (item.stored) await updateStored(item.stored.shareId, { expires: null });
    }, t('Kept on this device')).then(onClose);
  const favorite = () => run('fav', () => setClipMeta(item.pc!.path, { favorite: !item.favorite })).then(onClose);
  const reveal = async () => {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(item.pc!.path).catch(() => undefined);
  };
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/80 p-0 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label={item.title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ae-zoom-in flex max-h-full w-full max-w-5xl flex-col overflow-hidden bg-ae-elevated sm:rounded-2xl">
        <div className="relative bg-black">
          {src ? <video ref={video} src={src} controls autoPlay playsInline onTimeUpdate={onTime} className="max-h-[60vh] w-full" /> : <div className="ae-skeleton aspect-video" />}
          <button type="button" aria-label={t('Close')} onClick={onClose} className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80">
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="ae-scroll space-y-4 overflow-y-auto p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              {item.pc && !item.received ? (
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label={t('Title')} className="w-full bg-transparent text-lg font-bold outline-none focus:underline" />
              ) : (
                <p className="text-lg font-bold">{item.title}</p>
              )}
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ae-muted">
                <span className="flex items-center gap-1">
                  <GameIcon size={13} /> {gameLabel(item)}
                </span>
                <span>· {when(item.created)}</span>
                {item.height > 0 && <span>· {item.width}×{item.height}{item.fps ? ` · ${Math.round(item.fps)} fps` : ''}</span>}
                <span>· {fmtSize(item.size)}</span>
                {item.from && <span>· {t('From {name}', { name: item.from })}</span>}
              </p>
            </div>
            {item.received && item.expires && (
              <button type="button" disabled={!!busy} onClick={() => void keep()} className="rounded-full bg-ae-accent px-4 py-1.5 text-sm font-bold text-ae-on-accent">
                {t('Keep')} <span className="font-normal opacity-80">· {t('deletes in {n}d', { n: daysLeft(item.expires) })}</span>
              </button>
            )}
          </div>

          {item.pc && (
            <>
              {/* Trim */}
              <div>
                <div className="mb-1 flex justify-between text-xs text-ae-muted tabular-nums">
                  <span>{t('Start')} {fmtDuration(range[0])}</span>
                  <span className="font-semibold text-ae-text">{fmtDuration(range[1] - range[0])}</span>
                  <span>{t('End')} {fmtDuration(range[1])}</span>
                </div>
                <div className="relative h-10">
                  <div className="absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 overflow-hidden rounded-lg bg-ae-surface">
                    {item.thumb && <img src={item.thumb} alt="" className="h-full w-full object-cover opacity-40" />}
                  </div>
                  <div className="pointer-events-none absolute top-1/2 h-8 -translate-y-1/2 rounded-lg border-2 border-ae-accent bg-ae-accent/15" style={{ left: `${(range[0] / item.duration) * 100}%`, right: `${100 - (range[1] / item.duration) * 100}%` }} />
                  <input type="range" aria-label={t('Start')} min={0} max={item.duration} step={0.05} value={range[0]} onChange={(e) => { const v = Math.min(Number(e.target.value), range[1] - 1); setRange([v, range[1]]); if (video.current) video.current.currentTime = v; }} className="ae-trim absolute inset-0 w-full" />
                  <input type="range" aria-label={t('End')} min={0} max={item.duration} step={0.05} value={range[1]} onChange={(e) => { const v = Math.max(Number(e.target.value), range[0] + 1); setRange([range[0], v]); if (video.current) video.current.currentTime = Math.max(range[0], v - 2); }} className="ae-trim absolute inset-0 w-full" />
                </div>
              </div>
              {/* Audio tracks */}
              <div className="flex flex-wrap gap-2">
                <TrackToggle on={gameAudio} onChange={setGameAudio} label={t('Game audio')} />
                {hasMic && <TrackToggle on={mic} onChange={setMic} label={t('Microphone')} />}
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-ae-border pt-4">
            {item.pc && (
              <button type="button" disabled={!!busy} onClick={onShare} className="flex items-center gap-2 rounded-full bg-ae-accent px-4 py-2 text-sm font-bold text-ae-on-accent">
                <SendIcon size={15} /> {t('Share')}
              </button>
            )}
            {item.pc && !item.received && meE && (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  toast(t('Sending to your other devices…'));
                  syncClip(sbE, meE, item.pc!).then(
                    () => toast.success(t('On your other devices now. Open Clips there to download it.')),
                    (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
                  );
                }}
                className="flex items-center gap-2 rounded-full border border-ae-border px-4 py-2 text-sm font-semibold hover:bg-ae-hover"
              >
                <DownloadIcon size={15} /> {t('Send to my devices')}
              </button>
            )}
            {item.pc && !item.received && changed && (
              <>
                <button type="button" disabled={!!busy} onClick={() => void save('replace')} className="rounded-full bg-ae-surface px-4 py-2 text-sm font-semibold hover:bg-ae-hover">
                  {busy === 'save' ? t('Saving…') : t('Save')}
                </button>
                <button type="button" disabled={!!busy} onClick={() => void save('copy')} className="rounded-full bg-ae-surface px-4 py-2 text-sm font-semibold hover:bg-ae-hover">
                  {busy === 'copy' ? t('Saving…') : t('Save as new clip')}
                </button>
              </>
            )}
            {item.pc && (
              <button type="button" disabled={!!busy} onClick={() => void favorite()} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-ae-muted hover:bg-ae-hover hover:text-ae-text">
                <StarIcon size={15} /> {item.favorite ? t('Unfavourite') : t('Favourite')}
              </button>
            )}
            {item.pc && (
              <button type="button" onClick={() => void reveal()} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-ae-muted hover:bg-ae-hover hover:text-ae-text">
                <FolderIcon size={15} /> {t('Show in folder')}
              </button>
            )}
            <span className="flex-1" />
            {confirmDel ? (
              <span className="flex items-center gap-2 text-sm">
                {t('Delete this clip?')}
                <button type="button" onClick={() => void remove()} className="rounded-full bg-ae-danger px-3 py-1.5 font-bold text-white">
                  {t('Delete')}
                </button>
                <button type="button" onClick={() => setConfirmDel(false)} className="rounded-full px-3 py-1.5 hover:bg-ae-hover">
                  {t('Cancel')}
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDel(true)} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-ae-danger hover:bg-ae-danger/10">
                <TrashIcon size={15} /> {t('Delete')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackToggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${on ? 'bg-ae-accent/20 text-ae-text ring-1 ring-ae-accent' : 'bg-ae-surface text-ae-muted line-through'}`}>
      {label}
    </button>
  );
}

// ── Share ───────────────────────────────────────────────────────────────────────────────────

function ShareDialog({ clip, fixedScope, onClose, onShared }: { clip: ClipInfo; fixedScope: MessageScope | null; onClose: () => void; onShared: () => void }) {
  const sb = useSupabase();
  const me = useMeId();
  const { data: conversations = [] } = useConversations();
  const { data: servers = [] } = useServers(me);
  const { data: channels = [] } = useQuery({
    queryKey: ['all-text-channels'],
    queryFn: async () => ((await sb.from('channels').select('*').eq('type', 'text').order('position')).data ?? []) as Channel[],
  });
  const [scope, setScope] = useState<MessageScope | null>(fixedScope);
  const [quality, setQuality] = useState<'original' | 'high' | 'saver'>('high');
  const [title, setTitle] = useState(clip.title);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const progress = useTransfers((s) => s.t);
  const estimate = quality === 'original' ? clip.size : quality === 'high' ? Math.min(clip.size, clip.duration * 1.6e6) : Math.min(clip.size, clip.duration * 0.55e6);
  const go = async () => {
    if (!scope) return;
    setBusy(true);
    try {
      const conv = scope.kind === 'channel' ? null : (conversations.find((c) => c.id === scope.id) as (Conversation & { e2e?: boolean }) | undefined);
      const key = conv?.e2e ? await chatKey(sb, me, conv.id) : null;
      if (conv?.e2e && !key) throw new Error(t('Unlock encrypted messages on this device to share here.'));
      await shareClip(sb, me, clip, scope, { quality, start: 0, end: clip.duration, gameAudio: true, mic: true, title }, key, key ? (text) => encryptText(key, text) : null);
      toast.success(t('Clip shared'));
      onShared();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const uploading = Object.entries(progress).find(([k]) => k === `share:${clip.path}`);
  const query = q.trim().toLowerCase();
  return (
    <Dialog title={t('Share clip')} onClose={onClose} z="z-[90]">
      <div className="space-y-4">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label={t('Title')} className={inputCls} />
        {!fixedScope && (
          <div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search chats and channels')} className={`${inputCls} mb-2`} />
            <ul className="ae-scroll max-h-56 space-y-0.5 overflow-y-auto">
              {conversations
                .filter((c) => !c.conversation_members.find((m) => m.user_id === me)?.hidden)
                .map((c) => (
                  <ConvRow key={c.id} conv={c} me={me} query={query} active={scope?.id === c.id} onPick={() => setScope({ kind: 'conversation', id: c.id } as MessageScope)} />
                ))}
              {channels
                .filter((ch) => !query || ch.name.toLowerCase().includes(query))
                .map((ch) => (
                  <li key={ch.id}>
                    <button type="button" onClick={() => setScope({ kind: 'channel', id: ch.id } as MessageScope)} className={`flex w-full items-center gap-2 rounded-ae px-2 py-1.5 text-left text-sm ${scope?.id === ch.id ? 'bg-ae-accent/15' : 'hover:bg-ae-hover'}`}>
                      <HashIcon size={15} className="text-ae-muted" /> {ch.name}
                      <span className="ml-auto truncate text-xs text-ae-muted">{servers.find((s) => s.id === ch.server_id)?.name}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-xs font-bold tracking-wide text-ae-muted uppercase">{t('Quality')}</p>
          <div className="grid grid-cols-3 gap-2">
            {(['original', 'high', 'saver'] as const).map((qq) => (
              <button key={qq} type="button" aria-pressed={quality === qq} onClick={() => setQuality(qq)} className={`rounded-ae border px-2 py-2 text-left text-xs ${quality === qq ? 'border-ae-accent bg-ae-accent/10' : 'border-ae-border hover:border-ae-muted'}`}>
                <b className="block text-sm">{qq === 'original' ? t('Original') : qq === 'high' ? t('High') : t('Data saver')}</b>
                {qq === 'original' ? `${clip.height}p · ${Math.round(clip.fps)} fps` : qq === 'high' ? '1080p' : '720p · 30 fps'}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ae-muted">
            {t('About {size}. Friends who are online get it straight from your PC; a temporary copy covers everyone else for up to 72 hours.', { size: fmtSize(estimate) })}
          </p>
        </div>
        {uploading && <p className="text-xs text-ae-muted">{t('Preparing…')}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover">
            {t('Cancel')}
          </button>
          <button type="button" disabled={!scope || busy} onClick={() => void go()} className="flex items-center gap-2 rounded-ae bg-ae-accent px-4 py-2 text-sm font-bold text-ae-on-accent disabled:opacity-50">
            <SendIcon size={15} /> {busy ? t('Sharing…') : t('Share')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function ConvRow({ conv, me, query, active, onPick }: { conv: Conversation; me: string; query: string; active: boolean; onPick: () => void }) {
  const title = useConversationTitle(conv, me);
  if (query && !title.toLowerCase().includes(query)) return null;
  return (
    <li>
      <button type="button" onClick={onPick} className={`flex w-full items-center gap-2 rounded-ae px-2 py-1.5 text-left text-sm ${active ? 'bg-ae-accent/15' : 'hover:bg-ae-hover'}`}>
        <ConversationAvatar conv={conv} me={me} size={22} /> <span className="truncate">{title}</span>
      </button>
    </li>
  );
}

// ── The card in a chat ──────────────────────────────────────────────────────────────────────

export function ClipCard({ clipId }: { clipId: string }) {
  const sb = useSupabase();
  const me = useMeId();
  const { key } = useE2e();
  const { data: share, isLoading } = useClipShare(clipId);
  const transfer = useTransfers((s) => s.t[clipId]);
  const [thumb, setThumb] = useState<string | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const qc = useQueryClient();

  // Full-resolution thumbnail (decrypted in encrypted chats).
  useEffect(() => {
    if (!share?.thumb_path) return;
    let url: string | null = null;
    let gone = false;
    void (async () => {
      const { data } = await sb.storage.from('clips').download(share.thumb_path!);
      if (!data || gone) return;
      let blob: Blob = data;
      if (share.e2e) {
        if (!key) return;
        const { decryptBytes } = await import('../lib/e2e');
        const buf = await data.arrayBuffer();
        const iv = btoa(String.fromCharCode(...new Uint8Array(buf, 0, 12)));
        const plain = await decryptBytes(key, iv, buf.slice(12));
        if (!plain) return;
        blob = new Blob([plain], { type: 'image/jpeg' });
      }
      if (!gone) setThumb((url = URL.createObjectURL(blob)));
    })();
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [sb, share?.thumb_path, share?.e2e, key]);

  // Is it on this device already?
  useEffect(() => {
    const where = localCopies()[clipId];
    if (!where) return setLocal(null);
    let url: string | null = null;
    void (async () => {
      if (where === 'idb') {
        const blob = await storedFile(clipId);
        if (blob) setLocal((url = URL.createObjectURL(blob)));
      } else setLocal(await fileUrl(where));
    })();
    return () => void (url && URL.revokeObjectURL(url));
  }, [clipId, transfer?.phase]);

  if (isLoading) return <div className="ae-skeleton mt-1 aspect-video w-full max-w-md rounded-xl" />;
  if (!share) return null;
  const mine = share.sender_id === me;
  const busy = transfer && transfer.phase !== 'done' && transfer.phase !== 'error';
  const download = async () => {
    try {
      await getClip(sb, me, share);
      void qc.invalidateQueries({ queryKey: ['clips'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const expired = share.status === 'gone' && !local;
  return (
    <div className="mt-1 w-full max-w-md overflow-hidden rounded-xl bg-ae-surface ring-1 ring-ae-border">
      <div className="relative aspect-video bg-black">
        {playing && local ? (
          <video src={local} controls autoPlay playsInline className="h-full w-full" />
        ) : (
          <>
            {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} /> : <span className="grid h-full place-items-center text-ae-muted"><PlayIcon size={28} /></span>}
            <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-white tabular-nums">{fmtDuration(share.duration)}</span>
            {local ? (
              <button type="button" aria-label={t('Play')} onClick={() => setPlaying(true)} className="absolute inset-0 grid place-items-center bg-black/20 transition-colors hover:bg-black/35">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 text-black shadow-xl">
                  <PlayIcon size={22} />
                </span>
              </button>
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-black/35">
                {busy ? (
                  <div className="w-2/3 text-center text-xs font-semibold text-white">
                    {transfer!.phase === 'uploading' ? t('Uploading…') : transfer!.phase === 'direct' ? t('Getting it straight from their PC…') : t('Downloading…')}
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/25">
                      <div className="h-full bg-white transition-[width]" style={{ width: `${Math.round(transfer!.progress * 100)}%` }} />
                    </div>
                  </div>
                ) : expired ? (
                  <span className="rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white">{t('Expired: ask them to share it again')}</span>
                ) : mine ? (
                  <span className="rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white">{share.status === 'uploading' ? t('Uploading…') : t('Shared')}</span>
                ) : (
                  <button type="button" onClick={() => void download()} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-black shadow-xl">
                    <DownloadIcon size={15} /> {t('Get clip')} · {fmtSize(share.size_bytes)}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{share.title}</p>
          <p className="truncate text-xs text-ae-muted">
            {gameLabel(share)} · {share.height ? `${share.height}p` : ''}{share.fps ? ` ${Math.round(share.fps)} fps` : ''}
          </p>
        </div>
        {transfer?.phase === 'error' && (
          <button type="button" onClick={() => void download()} className="text-xs font-semibold text-ae-accent hover:underline" title={transfer.error}>
            {t('Retry')}
          </button>
        )}
        {local && (
          <button type="button" onClick={openClips} className="text-xs font-semibold text-ae-muted hover:text-ae-text">
            {t('In Clips')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────────────────────

const FPS = [30, 60, 120, 144];

export function ClipsSettings() {
  const { s, set } = useClipSettings();
  const clipKey = useSettingsStore((x) => x.keybinds.saveClip ?? null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ loaded: number; total: number } | null>(null);
  const [folder, setFolder] = useState(s.folder);
  const customFps = !FPS.includes(s.fps);
  useEffect(() => {
    void ffmpegReady().then(setReady);
    if (!s.folder && canRecord) void defaultFolder().then(setFolder);
  }, [s.folder]);
  const install = async () => {
    setSetup({ loaded: 0, total: 1 });
    const { listen } = await import('@tauri-apps/api/event');
    const un = await listen<{ loaded: number; total: number }>('clips-setup', (e) => setSetup(e.payload));
    try {
      await installFfmpeg();
      setReady(true);
      set({ enabled: true });
      toast.success(t('Clipping is ready'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      un();
      setSetup(null);
    }
  };
  const seg = (on: boolean) => `rounded-ae border px-3 py-1.5 text-sm ${on ? 'border-ae-accent bg-ae-accent/10 font-semibold' : 'border-ae-border hover:border-ae-muted'}`;
  return (
    <div className="space-y-6">
      {canRecord ? (
        <>
          <Section title={t('Recording')} description={t('Aether keeps the last moments of your game in memory, and saves them when you press the clip key. Nothing is kept until you clip.')}>
            {ready === false ? (
              <div className="space-y-2">
                <p className="text-sm text-ae-muted">{t('Clipping needs FFmpeg, a free video tool (about 115 MB, downloaded once from its official release and checked before use).')}</p>
                {setup ? (
                  <div className="h-2 overflow-hidden rounded-full bg-ae-surface">
                    <div className="h-full bg-ae-accent" style={{ width: `${Math.round((setup.loaded / Math.max(1, setup.total)) * 100)}%` }} />
                  </div>
                ) : (
                  <button type="button" onClick={() => void install()} className="rounded-ae bg-ae-accent px-4 py-2 text-sm font-bold text-ae-on-accent">
                    {t('Set up clipping')}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
              <Toggle label={t('Clip my games')} hint={t('Press {key} (change it in Keybinds) to save the last moments.', { key: formatCombo(clipKey) || t('the clip key') })} checked={s.enabled} onChange={(v) => set({ enabled: v })} />
              {clipKey && !comboHasModifier(clipKey) && /^(Key|Digit)|^(Space|Enter|Tab|Backspace)$/.test(clipKey) && <p className="text-xs text-ae-warning">{t('{key} also saves a clip whenever you type it, in any app. A key with Ctrl, Alt or Shift, or an F-key, is safer.', { key: formatCombo(clipKey) })}</p>}
              </div>
            )}
          </Section>
          {ready && (
            <Section title={t('Clip settings')}>
              <div className="space-y-4">
                <Field label={t('Record')}>
                  <button type="button" className={seg(s.mode === 'games')} onClick={() => set({ mode: 'games' })}>{t('While playing games')}</button>
                  <button type="button" className={seg(s.mode === 'always')} onClick={() => set({ mode: 'always' })}>{t('All the time')}</button>
                </Field>
                <Field label={t('Clip length')}>
                  {[15, 30, 60, 120, 300].map((n) => (
                    <button key={n} type="button" className={seg(s.seconds === n)} onClick={() => set({ seconds: n })}>
                      {n < 60 ? `${n}s` : `${n / 60} min`}
                    </button>
                  ))}
                </Field>
                <Field label={t('Frame rate')}>
                  {FPS.map((n) => (
                    <button key={n} type="button" className={seg(s.fps === n)} onClick={() => set({ fps: n })}>
                      {n}
                    </button>
                  ))}
                  <label className={`${seg(customFps)} flex items-center gap-1.5`}>
                    {t('Custom')}
                    <input type="number" min={10} max={240} value={customFps ? s.fps : ''} placeholder="90" onChange={(e) => e.target.value && set({ fps: Math.min(240, Math.max(10, Number(e.target.value))) })} className="w-14 rounded bg-ae-sunken px-1 text-center" aria-label={t('Custom frame rate')} />
                  </label>
                </Field>
                <Field label={t('Capture')}>
                  <button type="button" className={seg(s.capture === 'game')} onClick={() => set({ capture: 'game' })}>
                    {t('Game only')}
                  </button>
                  <button type="button" className={seg(s.capture === 'screen')} onClick={() => set({ capture: 'screen' })}>
                    {t('Full screen')}
                  </button>
                </Field>
                <p className="text-xs text-ae-muted">
                  {s.capture === 'game'
                    ? t('Records just the game’s window, so notifications and other apps never end up in a clip. With no game open, the whole screen is recorded.')
                    : t('Records everything on the screen below.')}
                </p>
                <Field label={t('Resolution')}>
                  {(['native', '2160', '1440', '1080', '720'] as const).map((r) => (
                    <button key={r} type="button" className={seg(s.resolution === r)} onClick={() => set({ resolution: r })}>
                      {r === 'native' ? t('Native') : r === '2160' ? '4K' : `${r}p`}
                    </button>
                  ))}
                </Field>
                <Field label={t('Quality')}>
                  {(['high', 'medium', 'low'] as const).map((qq) => (
                    <button key={qq} type="button" className={seg(s.quality === qq)} onClick={() => set({ quality: qq })}>
                      {qq === 'high' ? t('High') : qq === 'medium' ? t('Balanced') : t('Small files')}
                    </button>
                  ))}
                </Field>
                <p className="text-xs text-ae-muted">
                  {t('Recording runs on your graphics card, so it barely touches your CPU. A lower resolution than your screen is applied when a clip saves. Uses about {mb} MB of disk while recording.', { mb: Math.round(s.seconds * (s.quality === 'high' ? 4 : s.quality === 'medium' ? 2.5 : 1.4) * (s.fps / 60)) })}
                </p>
                <Toggle label={t('Record my microphone')} hint={t('Levelled like in calls, and saved as its own track too, so you can mute it later in the editor.')} checked={s.mic} onChange={(v) => set({ mic: v })} />
                {s.mic && (
                  <label className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 text-ae-muted">{t('Mic volume')}</span>
                    <input type="range" min={25} max={400} step={25} value={s.micVolume} onChange={(e) => set({ micVolume: Number(e.target.value) })} className="flex-1" aria-label={t('Mic volume')} />
                    <span className="w-12 text-right tabular-nums">{s.micVolume}%</span>
                  </label>
                )}
                <Toggle label={t('Include Aether calls')} hint={t('Off: only your game and other apps. On: friends’ voices from Aether calls too.')} checked={s.includeCalls} onChange={(v) => set({ includeCalls: v })} />
                <Toggle label={t('Show the mouse cursor')} checked={s.cursor} onChange={(v) => set({ cursor: v })} />
                <Toggle label={t('Play a sound when a clip saves')} checked={s.sound} onChange={(v) => set({ sound: v })} />
                <Toggle label={t('Sync new clips to my devices')} hint={t('Every new clip goes to your phone and other computers too (kept online for 3 days, or sent straight from this PC).')} checked={s.syncDevices} onChange={(v) => set({ syncDevices: v })} />
                <Field label={t('Screen')}>
                  {[0, 1, 2].map((m) => (
                    <button key={m} type="button" className={seg(s.monitor === m)} onClick={() => set({ monitor: m })}>
                      {m === 0 ? t('Main screen') : t('Screen {n}', { n: m + 1 })}
                    </button>
                  ))}
                </Field>
                <div>
                  <p className="mb-1.5 text-sm font-semibold">{t('Save clips to')}</p>
                  <div className="flex gap-2">
                    <input readOnly value={folder} className={`${inputCls} min-w-0 flex-1 text-xs`} aria-label={t('Clips folder')} />
                    <button
                      type="button"
                      onClick={() => void pickFolder().then((p) => p && (set({ folder: p }), setFolder(p)))}
                      className="rounded-ae bg-ae-surface px-3 text-sm font-semibold hover:bg-ae-hover"
                    >
                      {t('Change')}
                    </button>
                  </div>
                </div>
              </div>
            </Section>
          )}
        </>
      ) : (
        <Section title={t('Recording')} description={t('Recording clips needs the Aether app for Windows. Clips friends share with you still arrive here.')}>
          <span />
        </Section>
      )}
      <Section title={t('Clips shared with me')}>
        <div className="space-y-4">
          <Field label={t('Download')}>
            {(['smart', 'always', 'tap'] as const).map((m) => (
              <button key={m} type="button" className={seg(s.autoDownload === m)} onClick={() => set({ autoDownload: m })}>
                {m === 'smart' ? t('Automatically (not on mobile data)') : m === 'always' ? t('Always') : t('When I tap')}
              </button>
            ))}
          </Field>
          <Field label={t('Delete received clips after')}>
            {[1, 7, 30, 0].map((d) => (
              <button key={d} type="button" className={seg(s.keepDays === d)} onClick={() => set({ keepDays: d })}>
                {d === 0 ? t('Never') : d === 1 ? t('1 day') : t('{n} days', { n: d })}
              </button>
            ))}
          </Field>
          <p className="text-xs text-ae-muted">{t('Tap Keep on any clip to keep it for good.')}</p>
        </div>
      </Section>
      <button type="button" onClick={openClips} className="rounded-ae bg-ae-surface px-4 py-2 text-sm font-semibold hover:bg-ae-hover">
        {t('Open Clips')}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export type { ClipShare };
