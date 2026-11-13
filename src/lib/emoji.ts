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

// ── Frequently used (per device) ─────────────────────────────────────────────────────────────
// Like Discord: emoji you use often *and* recently come first. Each use adds a point; points fade
// with a half-life of a few days, so a new favourite rises quickly and old ones drift down.

const USAGE_KEY = 'aether.emoji.usage';
const RECENT_KEY = 'aether.emoji.recent';
const HALF_LIFE_MS = 4 * 24 * 3600_000;
const KEEP = 60;
const DEFAULT_RECENTS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀', '✅', '💯', '🙏', '😎'];

type Usage = Record<string, { n: number; at: number }>;

function readUsage(): Usage {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (raw) return JSON.parse(raw) as Usage;
    // First run after the update: seed from the old "recent" list so nothing is lost.
    const old = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
    const now = Date.now();
    return Object.fromEntries(old.map((e, i) => [e, { n: Math.max(1, 5 - i * 0.2), at: now - i * 60_000 }]));
  } catch {
    return {};
  }
}

const score = (u: { n: number; at: number }, now: number) => u.n * Math.pow(0.5, (now - u.at) / HALF_LIFE_MS);

/** Emoji ordered by how often and how recently you used them (reactions and the picker). */
export function getRecentEmoji(): string[] {
  const usage = readUsage();
  const now = Date.now();
  const ranked = Object.entries(usage)
    .sort((a, b) => score(b[1], now) - score(a[1], now))
    .map(([e]) => e);
  return ranked.length ? [...ranked, ...DEFAULT_RECENTS.filter((e) => !ranked.includes(e))].slice(0, 24) : DEFAULT_RECENTS;
}

/** The emoji for the quick-reaction buttons: your most used ones. */
export function quickReactions(count: number): string[] {
  return getRecentEmoji().slice(0, count);
}

export function pushRecentEmoji(emoji: string): void {
  try {
    const usage = readUsage();
    const now = Date.now();
    const cur = usage[emoji];
    usage[emoji] = { n: (cur ? score(cur, now) : 0) + 1, at: now };
    const kept = Object.entries(usage)
      .sort((a, b) => score(b[1], now) - score(a[1], now))
      .slice(0, KEEP);
    localStorage.setItem(USAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
    window.dispatchEvent(new Event('aether-emoji-usage'));
  } catch {
    // Storage unavailable: the order just doesn't adapt.
  }
}
