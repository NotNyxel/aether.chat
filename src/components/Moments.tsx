/**
 * Moments UI (2.1): the ring around avatars, the "Your moment" + friends strip, the full-screen
 * viewer (tap or arrow keys to move, reply, see who viewed yours) and the composer.
 */
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { useProfile } from '../hooks/useChatData';
import { useMeId } from '../hooks/useMe';
import {
  ringBackground,
  useDeleteMoment,
  useMarkMomentSeen,
  useMomentFeed,
  useMomentMedia,
  useMomentViewers,
  type Moment,
  type PersonMoments,
} from '../hooks/useMoments';
import { useConversationActions } from '../hooks/useSocialData';
import { useEscape } from '../lib/escape';
import { t } from '../lib/i18n';
import { useUiStore } from '../stores/uiStore';
import { CloseIcon, PlusIcon, TrashIcon, UsersIcon } from './icons';
import { Avatar } from './ProfileCard';
import { prefillDraft } from './ScheduledMessages';

const useViewer = create<{ start: string | null; open: (userId: string) => void; close: () => void }>()((set) => ({
  start: null,
  open: (start) => set({ start }),
  close: () => set({ start: null }),
}));
// The studio (2.3) and its fonts load only when you make a moment.
const MomentStudio = lazy(() => import('./MomentStudio'));
const useComposer = create<{ open: boolean; set: (open: boolean) => void }>()((set) => ({ open: false, set: (open) => set({ open }) }));
export const openMoments = (userId: string) => useViewer.getState().open(userId);
export const openMomentComposer = () => useComposer.getState().set(true);

const ago = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

/** An avatar with its moment ring: their colour while there's something new, grey once seen. */
export function MomentRing({ userId, size, children }: { userId: string; size: number; children: ReactNode }) {
  const feed = useMomentFeed();
  const person = feed.byUser.get(userId);
  const { data: p } = useProfile(person ? userId : null);
  if (!person) return <>{children}</>;
  const bg = person.seen ? 'var(--ae-border)' : ringBackground(p?.moment_ring, p?.accent_color);
  return (
    <button
      type="button"
      aria-label={t('View {name}’s moment', { name: p?.display_name || p?.username || '' })}
      onClick={(e) => {
        e.stopPropagation();
        openMoments(userId);
      }}
      className="ae-press relative grid shrink-0 place-items-center rounded-full"
      style={{ width: size + 8, height: size + 8, background: bg }}
    >
      <span className="grid place-items-center rounded-full bg-ae-bg p-[2px]">{children}</span>
    </button>
  );
}

/** "Your moment" + everyone with moments, for the top of chat lists. */
export function MomentsStrip({ size = 52, className = '', children }: { size?: number; className?: string; children?: ReactNode }) {
  const me = useMeId();
  const feed = useMomentFeed();
  const { data: mine } = useProfile(me);
  const others = feed.people.filter((p) => p.userId !== me);
  const hasMine = feed.byUser.has(me);
  return (
    <div className={`ae-scroll flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] ${className}`} aria-label={t('Moments')}>
      <div className="flex min-w-[68px] shrink-0 flex-col items-center gap-1.5">
        <span className="relative">
          {hasMine ? (
            <MomentRing userId={me} size={size}>
              <Avatar profile={mine} size={size} showFrame={false} />
            </MomentRing>
          ) : (
            // Same footprint as a ring, so it lines up with the people next to it.
            <button type="button" onClick={openMomentComposer} aria-label={t('Add a moment')} className="ae-press block rounded-full border-2 border-dashed border-ae-border p-[2px]">
              <Avatar profile={mine} size={size} showFrame={false} />
            </button>
          )}
          {/* On the ring's edge, clear of the face. */}
          <button
            type="button"
            aria-label={t('Add a moment')}
            onClick={openMomentComposer}
            className="absolute -right-1 -bottom-1 z-[5] grid h-6 w-6 place-items-center rounded-full bg-ae-accent text-ae-on-accent ring-[3px] ring-ae-bg"
          >
            <PlusIcon size={13} />
          </button>
        </span>
        <span className="text-center text-[11px] whitespace-nowrap text-ae-muted">{t('Your moment')}</span>
      </div>
      {others.map((p) => (
        <PersonBubble key={p.userId} person={p} size={size} />
      ))}
      {children}
    </div>
  );
}

function PersonBubble({ person, size }: { person: PersonMoments; size: number }) {
  const { data: p } = useProfile(person.userId);
  return (
    <div className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
      <MomentRing userId={person.userId} size={size}>
        <Avatar profile={p} size={size} showFrame={false} />
      </MomentRing>
      <span className={`w-full truncate text-center text-[11px] ${person.seen ? 'text-ae-muted' : 'font-semibold'}`}>{p?.display_name || p?.username}</span>
    </div>
  );
}

function MomentBody({ m, onVideoEnd, paused, onReady }: { m: Moment; onVideoEnd: () => void; paused: boolean; onReady: () => void }) {
  const { data: url } = useMomentMedia(m.media_path);
  const { data: overlay } = useMomentMedia(m.overlay_path ?? null);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!video.current) return;
    if (paused) video.current.pause();
    else void video.current.play().catch(() => undefined);
  }, [paused, url]);
  if (m.kind === 'text')
    return (
      <div className="grid h-full w-full place-items-center p-8 text-center" style={{ background: m.background ?? '#7658fb' }}>
        <p className="ae-selectable text-2xl leading-snug font-bold whitespace-pre-wrap text-white drop-shadow">{m.body}</p>
      </div>
    );
  if (!url) return <div className="ae-skeleton h-full w-full" />;
  return (
    <div className="relative grid h-full w-full place-items-center bg-black">
      {m.kind === 'video' && m.overlay_path ? (
        // Made in the studio: the video fills a 9:16 frame and its additions sit on top, as composed.
        <div className="relative aspect-[9/16] max-h-full w-full max-w-full">
          <video ref={video} src={url} className="absolute inset-0 h-full w-full object-cover" playsInline autoPlay onEnded={onVideoEnd} onLoadedData={onReady} onError={onReady} />
          {overlay && <img src={overlay} alt="" className="pointer-events-none absolute inset-0 h-full w-full" draggable={false} />}
        </div>
      ) : m.kind === 'video' ? (
        <video ref={video} src={url} className="max-h-full max-w-full" playsInline autoPlay onEnded={onVideoEnd} onLoadedData={onReady} onError={onReady} />
      ) : (
        <img src={url} alt="" className="max-h-full max-w-full object-contain" draggable={false} onLoad={onReady} onError={onReady} />
      )}
      {m.body && <p className="absolute inset-x-6 bottom-20 rounded-xl bg-black/55 px-4 py-2 text-center text-[15px] text-white">{m.body}</p>}
    </div>
  );
}

function Viewers({ id }: { id: string }) {
  const { data = [] } = useMomentViewers(id);
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute inset-x-0 bottom-0 p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-sm text-white">
        <UsersIcon size={15} /> {t('Seen by {n}', { n: data.length })}
      </button>
      {open && data.length > 0 && (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-black/70 p-2 text-sm text-white">
          {data.map((v) => (
            <ViewerRow key={v.viewer_id} id={v.viewer_id} at={v.viewed_at} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ViewerRow({ id, at }: { id: string; at: string }) {
  const { data: p } = useProfile(id);
  return (
    <li className="flex items-center gap-2">
      <Avatar profile={p} size={24} showFrame={false} />
      <span className="flex-1 truncate">{p?.display_name || p?.username}</span>
      <span className="text-xs opacity-70">{ago(at)}</span>
    </li>
  );
}

/** The last moment was deleted or expired: close once this render is done. */
function CloseWhenEmpty({ onClose }: { onClose: () => void }) {
  useEffect(() => onClose(), [onClose]);
  return null;
}

/** Full-screen viewer, from one person onward through everyone with moments. */
function Viewer({ start, onClose }: { start: string; onClose: () => void }) {
  const me = useMeId();
  const feed = useMomentFeed();
  const seen = useMarkMomentSeen();
  const del = useDeleteMoment();
  const convo = useConversationActions();
  const openHome = useUiStore((s) => s.openHome);
  const order = feed.people.map((p) => p.userId);
  const [person, setPerson] = useState(start);
  const list = feed.byUser.get(person)?.moments ?? [];
  // Start at the first unseen one.
  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((m) => !feed.viewed.has(m.id))));
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const m = list[index];
  const { data: owner } = useProfile(person);
  useEscape(onClose);

  const next = () => {
    if (index < list.length - 1) return setIndex(index + 1);
    const i = order.indexOf(person);
    const after = order.slice(i + 1).find((id) => id !== me);
    if (after) {
      setPerson(after);
      setIndex(0);
    } else onClose();
  };
  const prev = () => {
    if (index > 0) return setIndex(index - 1);
    const i = order.indexOf(person);
    if (i > 0) {
      const before = order[i - 1]!;
      setPerson(before);
      setIndex(Math.max(0, (feed.byUser.get(before)?.moments.length ?? 1) - 1));
    }
  };

  // The countdown starts only once the photo or video has loaded, so nobody misses it.
  const [ready, setReady] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setReady(m?.kind === 'text');
    setConfirmDelete(false);
  }, [m?.id, m?.kind]);
  useEffect(() => {
    if (!m) return;
    if (m.user_id !== me) seen(m.id);
    setProgress(0);
    if (m.kind === 'video' || !ready) return; // videos advance when they end
    const total = 6000;
    const started = Date.now();
    let elapsed = 0;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      elapsed = Date.now() - started - pausedFor.current;
      setProgress(Math.min(1, elapsed / total));
      if (elapsed >= total) next();
    }, 50);
    return () => clearInterval(id);
  }, [m?.id, ready]);
  // Track pause time so a held moment doesn't skip ahead.
  const pausedRef = useRef(false);
  const pausedFor = useRef(0);
  const pausedAt = useRef(0);
  useEffect(() => {
    pausedRef.current = paused;
    if (paused) pausedAt.current = Date.now();
    else if (pausedAt.current) pausedFor.current += Date.now() - pausedAt.current;
  }, [paused]);
  useEffect(() => {
    pausedFor.current = 0;
  }, [m?.id]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === ' ') {
        e.preventDefault();
        setPaused((v) => !v);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!m) return <CloseWhenEmpty onClose={onClose} />;
  const mine = m.user_id === me;
  const name = owner?.display_name || owner?.username || '';
  const sendReply = () => {
    const text = reply.trim();
    if (!text) return;
    convo.openDm.mutate(person, {
      onSuccess: (convId) => {
        prefillDraft(convId, `${t('Replying to your moment:')} ${text}`);
        onClose();
        openHome(convId);
      },
    });
  };

  return (
    <div className="fixed inset-0 z-[98] grid place-items-center bg-black/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('{name}’s moment', { name })}>
      <div className="relative h-[min(92vh,820px)] w-[min(92vw,460px)] overflow-hidden rounded-2xl bg-black shadow-2xl">
        <MomentBody m={m} paused={paused || confirmDelete} onVideoEnd={next} onReady={() => setReady(true)} />
        {!ready && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status" aria-label={t('Loading…')}>
            <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
          </div>
        )}
        {/* Progress, who, when. */}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-3">
          <div className="flex gap-1">
            {list.map((x, i) => (
              <span key={x.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                <span className="block h-full bg-white" style={{ width: i < index ? '100%' : i === index ? `${m.kind === 'video' ? 100 : progress * 100}%` : '0%' }} />
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-white">
            <Avatar profile={owner} size={32} showFrame={false} />
            <span className="text-sm font-semibold">{mine ? t('Your moment') : name}</span>
            <span className="text-xs opacity-70">{ago(m.created_at)}</span>
            {mine && <span className="rounded-full bg-white/20 px-2 text-[11px]">{m.audience === 'close' ? t('Close friends') : m.audience === 'friends' ? t('Friends') : t('Everyone')}</span>}
            <span className="flex-1" />
            {mine && (
              <button
                type="button"
                aria-label={t('Delete this moment')}
                className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/15"
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon size={16} />
              </button>
            )}
            <button type="button" aria-label={t('Close')} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/15" onClick={onClose}>
              <CloseIcon size={18} />
            </button>
          </div>
        </div>
        {confirmDelete && (
          // Inside the viewer, so it isn't hidden behind it.
          <div className="absolute inset-0 z-20 grid place-items-center bg-black/65 p-6" role="alertdialog" aria-label={t('Delete this moment?')}>
            <div className="w-full max-w-xs rounded-2xl bg-ae-elevated p-4 text-ae-text shadow-2xl">
              <p className="font-bold">{t('Delete this moment?')}</p>
              <p className="mt-1 text-sm text-ae-muted">{t('It disappears for everyone right away.')}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="rounded-ae px-3 py-1.5 text-sm hover:bg-ae-hover" onClick={() => setConfirmDelete(false)}>
                  {t('Cancel')}
                </button>
                <button
                  type="button"
                  className="rounded-ae bg-ae-danger px-3 py-1.5 text-sm font-bold text-white"
                  onClick={() => {
                    setConfirmDelete(false);
                    del.mutate(m, { onSuccess: () => (list.length > 1 ? setIndex(Math.max(0, index - 1)) : onClose()) });
                  }}
                >
                  {t('Delete')}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Tap left / right; hold to pause. */}
        <button type="button" aria-label={t('Previous')} className="absolute top-20 bottom-24 left-0 w-1/3" onClick={prev} onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)} />
        <button type="button" aria-label={t('Next')} className="absolute top-20 right-0 bottom-24 w-2/3" onClick={next} onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)} />
        {mine ? (
          <Viewers id={m.id} />
        ) : (
          <form
            className="absolute inset-x-0 bottom-0 flex gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              sendReply();
            }}
          >
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              placeholder={t('Reply to {name}…', { name })}
              aria-label={t('Reply to {name}…', { name })}
              className="min-w-0 flex-1 rounded-full border border-white/30 bg-black/40 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/60 focus:border-white/70"
            />
          </form>
        )}
      </div>
    </div>
  );
}

export function MomentsLayer() {
  const start = useViewer((s) => s.start);
  const close = useViewer((s) => s.close);
  const composing = useComposer((s) => s.open);
  const setComposing = useComposer((s) => s.set);
  return (
    <>
      {start && <Viewer start={start} onClose={close} />}
      {composing && (
        <Suspense fallback={<div className="fixed inset-0 z-[98] bg-black" />}>
          <MomentStudio onClose={() => setComposing(false)} />
        </Suspense>
      )}
    </>
  );
}
