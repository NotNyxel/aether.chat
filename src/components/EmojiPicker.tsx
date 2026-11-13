import { ClockIcon, ReactIcon as SmilePlusIcon } from './icons';
/** Emoji picker: search, category tabs, recents. Closes on outside click or Escape. */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { isPhoneLayout } from '../lib/phone';
import { EMOJI_GROUPS, getRecentEmoji, pushRecentEmoji, searchEmoji, useEmojiData } from '../lib/emoji';
import { useEscape } from '../lib/escape';
import { useMeId } from '../hooks/useMe';
import { useServers } from '../hooks/useChatData';
import { customEmojiToken, useServerEmojis } from '../lib/customEmoji';
import { Emoji, EmojiText } from '../lib/twemoji';

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  /** Also offer custom emoji from your servers (inserts a <:name:id> token). */
  allowCustom?: boolean;
  onClose: () => void;
  /** Positioning classes for the floating panel (computers). Phones always get a bottom sheet. */
  className?: string;
}

// Category icons, drawn with the same emoji art as everything else.
const GROUP_ICON: Record<number, string> = { 0: '😀', 1: '👋', 3: '🐻', 4: '🍔', 5: '✈️', 6: '⚽', 7: '💡', 8: '💠', 9: '🏳️' };
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(38px,1fr))]';

export function EmojiPicker({ onPick, onClose, className = 'bottom-full right-0 mb-2', allowCustom = false }: EmojiPickerProps) {
  const data = useEmojiData();
  const me = useMeId();
  const { data: myServers = [] } = useServers(me);
  const { data: customAll = [] } = useServerEmojis(allowCustom ? myServers.map((x) => x.id) : []);
  const [query, setQuery] = useState('');
  const custom = query.trim() ? customAll.filter((e) => e.name.includes(query.trim().toLowerCase().replace(/:/g, ''))) : customAll;
  const [hovered, setHovered] = useState<{ emoji: string; label: string; code?: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recents = useMemo(() => getRecentEmoji(), []);
  const [phone] = useState(isPhoneLayout);

  useEscape(onClose);
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    // A beat later, so the tap that opened the picker doesn't also close it.
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onDown);
      window.addEventListener('touchstart', onDown, { passive: true });
    }, 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('touchstart', onDown);
    };
  }, [onClose]);

  const pick = (emoji: string) => {
    pushRecentEmoji(emoji);
    onPick(emoji);
  };

  const results = data && query.trim() ? searchEmoji(data, query, 160) : null;

  // One delegated handler instead of one per emoji: the grid has ~1,900 of them.
  const gridEvents = {
    onClick: (e: ReactMouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-emoji]');
      if (b) pick(b.dataset.emoji!);
    },
    onMouseOver: (e: ReactMouseEvent) => {
      if (phone) return;
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-emoji]');
      if (b && b.dataset.emoji !== hovered?.emoji) setHovered({ emoji: b.dataset.emoji!, label: b.title, code: b.dataset.code });
    },
  };
  const cells = (list: { emoji: string; label: string; shortcodes: string[] }[]) =>
    list.map((e) => (
      <button
        key={e.emoji}
        type="button"
        title={e.label}
        data-emoji={e.emoji}
        data-code={e.shortcodes[0]}
        className="grid aspect-square place-items-center rounded-md text-[24px] leading-none hover:bg-ae-hover active:scale-90"
      >
        <Emoji emoji={e.emoji} className="pointer-events-none !m-0" />
      </button>
    ));

  const panel = (
    <div
      ref={panelRef}
      className={
        phone
          ? 'ae-sheet fixed inset-x-0 bottom-0 z-[90] flex h-[min(460px,70dvh)] flex-col overflow-hidden rounded-t-2xl border-t border-ae-border bg-[var(--ae-bg-solid,var(--ae-bg-elevated))] pb-[env(safe-area-inset-bottom)] shadow-2xl'
          : `absolute z-40 flex h-[400px] w-[min(372px,calc(100vw-16px))] flex-col overflow-hidden rounded-ae border border-ae-border bg-[var(--ae-bg-solid,var(--ae-bg-elevated))] shadow-2xl ${className}`
      }
      onMouseDown={(e) => e.stopPropagation()}
    >
      {phone && <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-ae-border" />}
      <div className="border-b border-ae-border p-2">
        <input
          autoFocus={!phone}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find the perfect emoji"
          className="ae-input w-full text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results?.[0]) {
              e.preventDefault();
              pick(results[0].emoji);
            }
          }}
        />
      </div>

      {!results && (
        <nav className="flex shrink-0 items-center justify-between gap-0.5 overflow-x-auto border-b border-ae-border px-1.5 py-1 [scrollbar-width:none]">
          <button type="button" title="Recent" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ae-muted hover:bg-ae-hover hover:text-ae-text" onClick={() => scrollRef.current?.scrollTo({ top: 0 })}>
            <ClockIcon size={17} />
          </button>
          {EMOJI_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              title={g.label}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md opacity-75 hover:bg-ae-hover hover:opacity-100"
              onClick={() => {
                const box = scrollRef.current;
                const el = document.getElementById(`ae-emoji-group-${g.id}`);
                if (box && el) box.scrollTo({ top: el.offsetTop });
              }}
            >
              <Emoji emoji={GROUP_ICON[g.id] ?? g.icon} className="!m-0 !h-5 !w-5" />
            </button>
          ))}
        </nav>
      )}

      <div ref={scrollRef} className="ae-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2 pb-2" {...gridEvents}>
        {custom.length > 0 && (
          <>
            <p className="sticky top-0 z-[1] bg-[var(--ae-bg-solid,var(--ae-bg-elevated))] px-1 py-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Server emoji</p>
            <div className={`mb-2 ${GRID}`}>
              {custom.slice(0, 120).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  title={`:${e.name}:`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onPick(customEmojiToken(e));
                  }}
                  className="grid aspect-square place-items-center rounded-md hover:bg-ae-hover"
                >
                  <img src={e.url} alt={e.name} className="h-7 w-7 object-contain" draggable={false} />
                </button>
              ))}
            </div>
          </>
        )}
        {!data && <p className="p-4 text-center text-sm text-ae-muted">Loading emoji…</p>}
        {data && results && (
          <>
            {results.length === 0 && <p className="p-4 text-center text-sm text-ae-muted">No emoji match “{query}”.</p>}
            <div className={`pt-2 ${GRID}`}>{cells(results)}</div>
          </>
        )}
        {data && !results && (
          <>
            <p className="sticky top-0 z-[1] bg-[var(--ae-bg-solid,var(--ae-bg-elevated))] px-1 py-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Recent</p>
            <div className={`mb-2 ${GRID}`}>{cells(recents.map((emoji) => ({ emoji, label: emoji, shortcodes: [] })))}</div>
            {EMOJI_GROUPS.map((g) => (
              <section key={g.id} id={`ae-emoji-group-${g.id}`}>
                <p className="sticky top-0 z-[1] bg-[var(--ae-bg-solid,var(--ae-bg-elevated))] px-1 py-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{g.label}</p>
                <div className={`mb-2 ${GRID}`}>{cells(data.byGroup.get(g.id) ?? [])}</div>
              </section>
            ))}
          </>
        )}
      </div>

      {!phone && (
        <footer className="flex h-11 shrink-0 items-center gap-2 border-t border-ae-border px-3 text-sm">
          {hovered ? (
            <>
              <Emoji emoji={hovered.emoji} className="!m-0 !h-7 !w-7" />
              <span className="truncate">{hovered.code ? `:${hovered.code}:` : hovered.label}</span>
            </>
          ) : (
            <span className="text-ae-muted">Pick an emoji. Tip: type :name in chat.</span>
          )}
        </footer>
      )}
    </div>
  );

  // Phones: a bottom sheet over everything, so it also works from menus and toolbars hidden on touch.
  if (phone)
    return createPortal(
      <div className="fixed inset-0 z-[89] bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {panel}
      </div>,
      document.body,
    );
  return panel;
}

/** A button showing the chosen emoji; opens the emoji picker (used for status emoji). */
export function EmojiButton({ value, onChange, size = 'md' }: { value: string | null | undefined; onChange: (emoji: string | null) => void; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  const box = size === 'sm' ? 'h-9 w-9 text-lg' : 'h-10 w-11 text-xl';
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={value ? `Status emoji ${value}. Change it` : 'Pick a status emoji'}
        data-tip={value ? 'Change emoji (right-click to clear)' : 'Pick an emoji'}
        onClick={() => setOpen((v) => !v)}
        onContextMenu={(e) => {
          if (!value) return;
          e.preventDefault();
          e.stopPropagation();
          onChange(null);
        }}
        className={`ae-press grid place-items-center rounded-ae border border-ae-border bg-ae-sunken leading-none hover:border-ae-accent ${box}`}
      >
        {value ? <EmojiText text={value} /> : <SmilePlusIcon size={18} className="text-ae-muted" />}
      </button>
      {open && (
        <EmojiPicker
          className="top-full left-0 mt-2"
          onClose={() => setOpen(false)}
          onPick={(e) => {
            onChange(e);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
