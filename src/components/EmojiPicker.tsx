/** Emoji picker: search, category tabs, recents. Closes on outside click or Escape. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_GROUPS, getRecentEmoji, pushRecentEmoji, searchEmoji, useEmojiData, type EmojiEntry } from '../lib/emoji';

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Positioning classes for the floating panel. */
  className?: string;
}

export function EmojiPicker({ onPick, onClose, className = 'bottom-full right-0 mb-2' }: EmojiPickerProps) {
  const data = useEmojiData();
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<EmojiEntry | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recents = useMemo(() => getRecentEmoji(), []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
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
      {e.emoji}
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
          className="w-full rounded-ae border border-ae-border bg-ae-sunken px-3 py-1.5 text-sm outline-none focus:border-ae-accent"
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
              🕘
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
            <span className="text-2xl">{hovered.emoji}</span>
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
