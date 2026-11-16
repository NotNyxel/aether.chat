/**
 * Offline sending (2.0): messages sent without a connection wait here, on this device, and go out
 * in order as soon as Aether is back online (or next time it opens). Each keeps the id it was
 * given when you pressed send, so a retry can never post the same message twice (the server
 * refuses a duplicate id). Encrypted chats queue the already-encrypted text.
 */
import type { Attachment, MessageScope } from '../types/db';

export interface QueuedMessage {
  id: string;
  scope: MessageScope;
  content: string;
  replyToId: string | null;
  attachments: Attachment[];
  createdAt: string;
  authorId: string;
}

const storeKey = (userId: string) => `aether.outbox.${userId}`;
const listeners = new Set<() => void>();

export function readOutbox(userId: string): QueuedMessage[] {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(userId)) ?? '[]') as QueuedMessage[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(userId: string, items: QueuedMessage[]) {
  try {
    if (items.length) localStorage.setItem(storeKey(userId), JSON.stringify(items));
    else localStorage.removeItem(storeKey(userId));
  } catch {
    /* storage full or blocked: the message stays only in memory until it sends */
  }
  listeners.forEach((l) => l());
}

export function enqueue(m: QueuedMessage) {
  const items = readOutbox(m.authorId).filter((x) => x.id !== m.id);
  write(m.authorId, [...items, m].slice(-200));
}

export function dequeue(userId: string, id: string) {
  write(userId, readOutbox(userId).filter((x) => x.id !== id));
}

export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function clearOutbox(userId: string | null) {
  if (!userId) return;
  try {
    localStorage.removeItem(storeKey(userId));
  } catch {
    /* nothing stored */
  }
}

/** True for "couldn't reach the server" (as opposed to the server saying no). */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = err instanceof Error ? err.message : String((err as { message?: string } | null)?.message ?? err ?? '');
  return /failed to fetch|networkerror|load failed|network request failed|the network connection was lost|timed? ?out|ERR_INTERNET_DISCONNECTED|fetch failed/i.test(msg);
}
