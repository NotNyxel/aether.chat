import { ClockIcon, ReactIcon as SmilePlusIcon } from './icons';
/** Emoji picker: search, category tabs, recents. Closes on outside click or Escape. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_GROUPS, getRecentEmoji, pushRecentEmoji, searchEmoji, useEmojiData, type EmojiEntry } from '../lib/emoji';
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
  /** Positioning classes for the floating panel. */
  className?: string;
}

export function EmojiPicker({ onPick, onClose, className = 'bottom-full right-0 mb-2', allowCustom = false }: EmojiPickerProps) {
  const data = useEmojiData();
  const me = useMeId();
  const { data: myServers = [] } = useServers(me);
  const { data: customAll = [] } = useServerEmojis(allowCustom ? myServers.map((x) => x.id) : []);
  const [query, setQuery] = useState('');
  const custom = query.trim() ? customAll.filter((e) => e.name.includes(query.trim().toLowerCase().replace(/:/g, ''))) : customAll;
  const [hovered, setHovered] = useState<EmojiEntry | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recents = useMemo(() => getRecentEmoji(), []);

  useEscape(onClose);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const pick = (emoji: string) => {
    pushRecentEmoji(emoji);
    onPick(emoji);
  };

  const results = data && query.trim() ? searchEmoji(data, query, 120) : null;

  const Cell = ({ e }: { e: EmojiEntry | { emoji: string; label: string; shortcodes: string[] } }) => (
    <button
      type="button"
      title={e.label}
      onMouseEnter={() => setHovered('group' in e ? e : null)}
      onClick={() => pick(e.emoji)}
      className="grid h-9 w-9 place-items-center rounded text-[22px] leading-none hover:bg-ae-hover"
    >
      <Emoji emoji={e.emoji} className="!m-0" />
    </button>
  );

  return (
    <div
      ref={panelRef}
      className={`absolute z-40 flex h-[380px] w-[352px] flex-col overflow-hidden rounded-ae border border-ae-border bg-ae-elevated shadow-2xl ${className}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="border-b border-ae-border p-2">
        <input
          autoFocus
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

      <div className="flex min-h-0 flex-1">
        {!results && (
          <nav className="flex w-10 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-ae-border py-2">
            <button type="button" title="Recent" className="text-lg opacity-70 hover:opacity-100" onClick={() => scrollRef.current?.scrollTo({ top: 0 })}>
              <ClockIcon size={18} />
            </button>
            {EMOJI_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                title={g.label}
                className="text-lg opacity-70 hover:opacity-100"
                onClick={() => document.getElementById(`ae-emoji-group-${g.id}`)?.scrollIntoView({ block: 'start' })}
              >
                {g.icon}
              </button>
            ))}
          </nav>
        )}

        <div ref={scrollRef} className="ae-scroll min-w-0 flex-1 overflow-y-auto p-2">
          {custom.length > 0 && (
            <>
              <p className="px-1 pb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Server emoji</p>
              <div className="mb-2 grid grid-cols-8">
                {custom.slice(0, 80).map((e) => (
                  <button key={e.id} type="button" title={`:${e.name}:`} onClick={() => onPick(customEmojiToken(e))} className="grid h-9 w-9 place-items-center rounded hover:bg-ae-hover">
                    <img src={e.url} alt={e.name} className="h-7 w-7 object-contain" draggable={false} />
                  </button>
                ))}
              </div>
            </>
          )}
          {!data && <p className="p-4 text-center text-sm text-ae-muted">Loading emoji…</p>}
          {data && results && (
            <>
              {results.length === 0 && <p className="p-4 text-center text-sm text-ae-muted">No emoji match "{query}".</p>}
              <div className="grid grid-cols-8">
                {results.map((e) => (
                  <Cell key={e.emoji} e={e} />
                ))}
              </div>
            </>
          )}
          {data && !results && (
            <>
              <p className="px-1 pb-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Recent</p>
              <div className="mb-2 grid grid-cols-8">
                {recents.map((emoji) => (
                  <Cell key={emoji} e={{ emoji, label: emoji, shortcodes: [] }} />
                ))}
              </div>
              {EMOJI_GROUPS.map((g) => (
                <section key={g.id} id={`ae-emoji-group-${g.id}`}>
                  <p className="sticky top-0 bg-ae-elevated px-1 py-1 text-[11px] font-bold tracking-wide text-ae-muted uppercase">{g.label}</p>
                  <div className="mb-2 grid grid-cols-8">
                    {(data.byGroup.get(g.id) ?? []).map((e) => (
                      <Cell key={e.emoji} e={e} />
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </div>
      </div>

      <footer className="flex h-11 items-center gap-2 border-t border-ae-border px-3 text-sm">
        {hovered ? (
          <>
            <span className="text-2xl"><Emoji emoji={hovered.emoji} className="!m-0" /></span>
            <span className="truncate">
              {hovered.shortcodes[0] ? `:${hovered.shortcodes[0]}:` : hovered.label}
            </span>
          </>
        ) : (
          <span className="text-ae-muted">Pick an emoji. Tip: type :name in chat.</span>
        )}
      </footer>
    </div>
  );
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
