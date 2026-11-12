/**
 * Invite links. The canonical form is aether.chat/inv/CODE. Inside aether.chat those links turn
 * into join cards. A web link that works anywhere (it opens the app through aetherchat://) lives on
 * the project's GitHub Pages site. Anything a user pastes (either link, the deep link, or just the
 * code) is accepted by parseInviteCode().
 */
export const INVITE_PREFIX = 'aether.chat/inv/';
export const WEB_INVITE_BASE = 'https://notnyxel.github.io/aether.chat-releases/inv/#';

/** Matches invite links inside message text. Group 1 is the code. */
export const INVITE_LINK_RE = /(?:https?:\/\/)?(?:www\.)?aether\.chat\/inv\/([A-Za-z0-9_-]{2,64})|https:\/\/notnyxel\.github\.io\/aether\.chat-releases\/inv\/#([A-Za-z0-9_-]{2,64})|aetherchat:\/\/inv\/([A-Za-z0-9_-]{2,64})/g;

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
  if (m) return m[1] ?? m[2] ?? m[3] ?? null;
  const q = /[?&](?:c|code)=([A-Za-z0-9_-]{2,64})/.exec(text);
  if (q) return q[1]!;
  return /^[A-Za-z0-9_-]{2,64}$/.test(text) ? text : null;
}

/** Every invite code mentioned in a message (unique, in order). */
export function inviteCodesIn(text: string): string[] {
  const out: string[] = [];
  INVITE_LINK_RE.lastIndex = 0;
  for (const m of text.matchAll(INVITE_LINK_RE)) {
    const code = m[1] ?? m[2] ?? m[3];
    if (code && !out.includes(code.toLowerCase())) out.push(code.toLowerCase());
  }
  return out.slice(0, 3);
}
