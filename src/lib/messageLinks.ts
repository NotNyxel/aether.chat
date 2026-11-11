/**
 * Message links, Discord-style:
 *   https://aether.chat/channels/<serverId>/<channelId>/<messageId>   server channel
 *   https://aether.chat/channels/@me/<conversationId>/<messageId>     DM / group DM
 * Clicking one inside the app navigates instead of opening a browser.
 */
import type { Message } from '../types/db';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LINK_RE = new RegExp(`^https://aether\\.chat/channels/(@me|${UUID})/(${UUID})(?:/(${UUID}))?/?$`, 'i');

export interface ParsedMessageLink {
  serverId: string | null;
  scopeId: string;
  messageId?: string;
}

export function parseMessageLink(href: string): ParsedMessageLink | null {
  const m = LINK_RE.exec(href.trim());
  if (!m) return null;
  return { serverId: m[1] === '@me' ? null : m[1], scopeId: m[2], messageId: m[3] };
}

export function buildMessageLink(message: Pick<Message, 'id' | 'channel_id' | 'conversation_id'>, serverId: string | null): string {
  const scope = message.channel_id ?? message.conversation_id;
  return `https://aether.chat/channels/${serverId ?? '@me'}/${scope}/${message.id}`;
}

/** Up to 3 http(s) URLs worth previewing: skips code, `<suppressed>` links and message links. */
export function extractEmbedUrls(content: string): string[] {
  const stripped = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<https?:\/\/[^>\s]+>/g, ' ')
    .replace(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, ' $1 ');
  const found: string[] = [];
  for (const m of stripped.matchAll(/https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g)) {
    const url = m[0];
    if (parseMessageLink(url) || found.includes(url)) continue;
    found.push(url);
    if (found.length === 3) break;
  }
  return found;
}

/** YouTube video id for watch, short, embed and youtu.be URLs. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = /^\/(shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname);
      if (m) return m[2];
    }
  } catch {
    // not a URL
  }
  return null;
}
