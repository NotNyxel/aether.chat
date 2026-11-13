/**
 * Invite links. The canonical form is aether.chat/inv/CODE. Inside Aether those links turn
 * into join cards. The web link that works anywhere is the web app's /inv/CODE (older links on the
 * GitHub Pages site still work). Anything a user pastes (any of those links, the aetherchat://
 * deep link, or just the code) is accepted by parseInviteCode().
 */
import { OLD_WEB_HOSTS, WEB_APP_URL } from '../config';

export const INVITE_PREFIX = 'aether.chat/inv/';
/** Opens the invite in the web app, which also offers to open the desktop app. */
export const WEB_INVITE_BASE = `${WEB_APP_URL}/inv/`;
// The current web address and the earlier ones (their invite links still work).
const WEB_HOST = `(?:${[WEB_APP_URL.replace(/^https:\/\//, ''), ...OLD_WEB_HOSTS].map((h) => h.replace(/\./g, '\\.')).join('|')})`;

/** Matches invite links inside message text. Group 1 is the code. */
export const INVITE_LINK_RE = new RegExp(
  [
    String.raw`(?:https?:\/\/)?(?:www\.)?aether\.chat\/inv\/([A-Za-z0-9_-]{2,64})`,
    String.raw`https:\/\/notnyxel\.github\.io\/aether\.chat-releases\/inv\/#([A-Za-z0-9_-]{2,64})`,
    String.raw`aetherchat:\/\/inv\/([A-Za-z0-9_-]{2,64})`,
    String.raw`(?:https?:\/\/)?` + WEB_HOST + String.raw`\/inv\/([A-Za-z0-9_-]{2,64})`,
  ].join('|'),
  'g',
);

export function inviteLink(code: string): string {
  return `${INVITE_PREFIX}${code}`;
}

export function webInviteLink(code: string): string {
  return `${WEB_INVITE_BASE}${code}`;
}

/** Returns the invite code from a link, deep link or bare code, or null. */
export function parseInviteCode(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  INVITE_LINK_RE.lastIndex = 0;
  const m = INVITE_LINK_RE.exec(text);
  if (m) return m[1] ?? m[2] ?? m[3] ?? m[4] ?? null;
  const q = /[?&](?:c|code)=([A-Za-z0-9_-]{2,64})/.exec(text);
  if (q) return q[1]!;
  return /^[A-Za-z0-9_-]{2,64}$/.test(text) ? text : null;
}

/** Every invite code mentioned in a message (unique, in order). */
export function inviteCodesIn(text: string): string[] {
  const out: string[] = [];
  INVITE_LINK_RE.lastIndex = 0;
  for (const m of text.matchAll(INVITE_LINK_RE)) {
    const code = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (code && !out.includes(code.toLowerCase())) out.push(code.toLowerCase());
  }
  return out.slice(0, 3);
}
