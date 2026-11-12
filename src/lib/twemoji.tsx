/**
 * Emoji drawn as images (Twemoji artwork), so every emoji looks the same on every device and
 * multi-part emoji (families, flags, skin tones, "person + laptop") never show up in pieces the
 * way they can with the system font. If an image can't load, the plain character is shown.
 */
import { useState, type CSSProperties } from 'react';

const BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/svg/';

const ONE = String.raw`(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)\p{Emoji_Modifier}?`;
const SEQ = String.raw`\p{Regional_Indicator}{2}|[#*0-9]️?⃣|${ONE}(?:‍(?:${ONE}|\p{Extended_Pictographic}️?))*[\u{E0020}-\u{E007F}]*`;

/** Matches one emoji (with its modifiers and joined parts). Not global: use for "find the next one". */
export const EMOJI_RE = new RegExp(SEQ, 'u');
const EMOJI_ALL = new RegExp(SEQ, 'gu');
const CUSTOM_ALL = /<a?:[a-z0-9_]{2,32}:[0-9a-f-]{36}>/gi;

/** The Twemoji file for an emoji: code points in hex, without the FE0F selector unless it's a ZWJ sequence. */
export function emojiUrl(emoji: string): string {
  const cps = [...emoji].map((c) => c.codePointAt(0)!);
  const keep = cps.includes(0x200d) ? cps : cps.filter((c) => c !== 0xfe0f);
  return `${BASE}${keep.map((c) => c.toString(16)).join('-')}.svg`;
}

/**
 * How big emoji in a message should be drawn: a message that is only emoji gets large ones (up to 3)
 * or medium ones (4 or more). Anything with text in it keeps them at text size.
 */
export function emojiSize(content: string | null | undefined): 'l' | 'm' | undefined {
  if (!content) return undefined;
  const custom = content.match(CUSTOM_ALL)?.length ?? 0;
  const rest = content.replace(CUSTOM_ALL, '');
  const unicode = rest.match(EMOJI_ALL)?.length ?? 0;
  const count = custom + unicode;
  if (!count || rest.replace(EMOJI_ALL, '').replace(/[\s️‍]/g, '') !== '') return undefined;
  return count <= 3 ? 'l' : 'm';
}

/** One emoji as an image, sized by the surrounding text (CSS class .ae-emoji). */
export function Emoji({ emoji, className = '', style }: { emoji: string; className?: string; style?: CSSProperties }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className={`ae-emoji-text ${className}`}>{emoji}</span>;
  return (
    <img
      src={emojiUrl(emoji)}
      alt={emoji}
      aria-label={emoji}
      draggable={false}
      loading="lazy"
      decoding="async"
      className={`ae-emoji ${className}`}
      style={style}
      onError={() => setBroken(true)}
    />
  );
}

/** Text with every emoji in it swapped for the image version. */
export function EmojiText({ text, className }: { text: string; className?: string }) {
  const parts: (string | { e: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(EMOJI_ALL)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push({ e: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string' ? p : <Emoji key={i} emoji={p.e} className={className} />))}
    </>
  );
}
