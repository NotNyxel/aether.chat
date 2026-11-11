/**
 * Emoji data (Emojibase, ~1,900 emoji), loaded lazily into its own chunk on first use.
 * Provides category groups, search, `:shortcode:` lookup and a per-device recents list.
 */
import { useEffect, useState } from 'react';

export interface EmojiEntry {
  emoji: string;
  label: string;
  group: number;
  order: number;
  shortcodes: string[];
  tags: string[];
}

export interface EmojiData {
  list: EmojiEntry[];
  byGroup: Map<number, EmojiEntry[]>;
  byShortcode: Map<string, EmojiEntry>;
}

export const EMOJI_GROUPS: { id: number; label: string; icon: string }[] = [
  { id: 0, label: 'Smileys & Emotion', icon: '😀' },
  { id: 1, label: 'People & Body', icon: '👋' },
  { id: 3, label: 'Animals & Nature', icon: '🐻' },
  { id: 4, label: 'Food & Drink', icon: '🍔' },
  { id: 5, label: 'Travel & Places', icon: '✈️' },
  { id: 6, label: 'Activities', icon: '⚽' },
  { id: 7, label: 'Objects', icon: '💡' },
  { id: 8, label: 'Symbols', icon: '💠' },
  { id: 9, label: 'Flags', icon: '🏳️' },
];

interface CompactEmoji {
  hexcode: string;
  label: string;
  unicode: string;
  group?: number;
  order?: number;
  tags?: string[];
}

let loading: Promise<EmojiData> | null = null;
let loaded: EmojiData | null = null;

export function loadEmoji(): Promise<EmojiData> {
  loading ??= Promise.all([
    import('emojibase-data/en/compact.json'),
    import('emojibase-data/en/shortcodes/github.json'),
  ]).then(([compactMod, codesMod]) => {
    const compact = (compactMod as unknown as { default: CompactEmoji[] }).default;
    const codes = (codesMod as unknown as { default: Record<string, string | string[]> }).default;
    const list: EmojiEntry[] = [];
    for (const e of compact) {
      if (e.group === undefined || e.group === 2) continue; // skip regional indicators and skin-tone components
      const sc = codes[e.hexcode];
      list.push({
        emoji: e.unicode,
        label: e.label,
        group: e.group,
        order: e.order ?? 0,
        shortcodes: sc ? (Array.isArray(sc) ? sc : [sc]) : [],
        tags: e.tags ?? [],
      });
    }
    list.sort((a, b) => a.order - b.order);
    const byGroup = new Map<number, EmojiEntry[]>();
    const byShortcode = new Map<string, EmojiEntry>();
    for (const e of list) {
      byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
      for (const code of e.shortcodes) byShortcode.set(code, e);
    }
    loaded = { list, byGroup, byShortcode };
    return loaded;
  });
  return loading;
}

/** React hook: the emoji data once loaded (triggers the lazy load). */
export function useEmojiData(): EmojiData | null {
  const [data, setData] = useState<EmojiData | null>(loaded);
  useEffect(() => {
    if (!data) void loadEmoji().then(setData);
  }, [data]);
  return data;
}

/** Ranked search: shortcode prefix > label word prefix > tag > substring. */
export function searchEmoji(data: EmojiData, query: string, limit = 60): EmojiEntry[] {
  const q = query.toLowerCase().replace(/^:|:$/g, '').trim();
  if (!q) return [];
  const scored: { e: EmojiEntry; s: number }[] = [];
  for (const e of data.list) {
    let s = 0;
    if (e.shortcodes.some((c) => c === q)) s = 100;
    else if (e.shortcodes.some((c) => c.startsWith(q))) s = 80;
    else if (e.label.toLowerCase().split(/[\s:-]+/).some((w) => w.startsWith(q))) s = 60;
    else if (e.tags.some((t) => t.startsWith(q))) s = 40;
    else if (e.label.toLowerCase().includes(q) || e.shortcodes.some((c) => c.includes(q))) s = 20;
    if (s) scored.push({ e, s: s - e.order / 100_000 });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.e);
}

// ── Recents (per device) ─────────────────────────────────────────────────────────────────────

const RECENT_KEY = 'aether.emoji.recent';
const RECENT_MAX = 24;
const DEFAULT_RECENTS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀', '✅', '💯', '🙏', '😎'];

export function getRecentEmoji(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return list.length ? list : DEFAULT_RECENTS;
  } catch {
    return DEFAULT_RECENTS;
  }
}

export function pushRecentEmoji(emoji: string): void {
  try {
    const next = [emoji, ...getRecentEmoji().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: recents just don't persist.
  }
}
