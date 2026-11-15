/**
 * End-to-end encryption for DMs and groups, built on the browser's WebCrypto (no home-made crypto):
 *   - identity: an ECDH P-256 key pair per person. Public half in e2e_public_keys. Private half
 *     stays on your devices; a backup encrypted with your passphrase (PBKDF2-SHA256, 310,000
 *     rounds → AES-256-GCM) lets another device unlock it. The passphrase never leaves the device.
 *   - chat key: random AES-256-GCM per chat, wrapped for each member with an ECDH-derived key.
 *   - messages: "aether-e2e:v1:<iv>:<ciphertext>" (base64). Attachments are not encrypted.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const E2E_PREFIX = 'aether-e2e:v1:';
export const isEncrypted = (content: string | null | undefined) => !!content && content.startsWith('aether-e2e:');
/** Longest message that still fits once encrypted (messages are capped at 4,000 characters). */
export const E2E_MAX_CHARS = 2600;

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const localKey = (userId: string) => `aether.e2e.${userId}`;

// ── Identity ──────────────────────────────────────────────────────────────────────────────

async function passphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export type E2eStatus = 'none' | 'locked' | 'ready';

/** none = never set up; locked = set up, but not unlocked on this device; ready = usable here. */
export async function e2eStatus(sb: SupabaseClient, userId: string): Promise<E2eStatus> {
  if (localStorage.getItem(localKey(userId))) return 'ready';
  const { data } = await sb.from('e2e_public_keys').select('user_id').eq('user_id', userId).maybeSingle();
  return data ? 'locked' : 'none';
}

/** First-time setup: makes your key pair and stores the passphrase-protected backup. */
export async function setUpIdentity(sb: SupabaseClient, userId: string, passphrase: string): Promise<void> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const salt = rand(16);
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await passphraseKey(passphrase, salt), enc.encode(JSON.stringify(priv)));
  const { error: e1 } = await sb.from('e2e_key_backups').upsert({ user_id: userId, ciphertext: b64(ct), salt: b64(salt), iv: b64(iv) });
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await sb.from('e2e_public_keys').upsert({ user_id: userId, public_key: pub });
  if (e2) throw new Error(e2.message);
  localStorage.setItem(localKey(userId), JSON.stringify(priv));
}

/** Another device: unlock with your passphrase. */
export async function unlockIdentity(sb: SupabaseClient, userId: string, passphrase: string): Promise<void> {
  const { data, error } = await sb.from('e2e_key_backups').select('ciphertext, salt, iv').eq('user_id', userId).maybeSingle();
  if (error || !data) throw new Error('No encryption backup was found for your account.');
  const row = data as { ciphertext: string; salt: string; iv: string };
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv) }, await passphraseKey(passphrase, unb64(row.salt)), unb64(row.ciphertext));
  } catch {
    throw new Error('That passphrase is not right.');
  }
  localStorage.setItem(localKey(userId), dec.decode(plain));
}

export function forgetOnThisDevice(userId: string) {
  localStorage.removeItem(localKey(userId));
  chatKeys.clear();
}

async function myPrivateKey(userId: string): Promise<CryptoKey | null> {
  const raw = localStorage.getItem(localKey(userId));
  if (!raw) return null;
  return crypto.subtle.importKey('jwk', JSON.parse(raw) as JsonWebKey, ECDH, false, ['deriveKey']);
}

const pubCache = new Map<string, Promise<CryptoKey | null>>();
function publicKeyOf(sb: SupabaseClient, userId: string): Promise<CryptoKey | null> {
  let p = pubCache.get(userId);
  if (!p) {
    p = (async () => {
      const { data } = await sb.from('e2e_public_keys').select('public_key').eq('user_id', userId).maybeSingle();
      if (!data) return null;
      return crypto.subtle.importKey('jwk', (data as { public_key: JsonWebKey }).public_key, ECDH, false, []);
    })();
    pubCache.set(userId, p);
  }
  return p;
}

/** The key two people share (only they can derive it). */
async function pairKey(priv: CryptoKey, pub: CryptoKey) {
  return crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// ── Chat keys ─────────────────────────────────────────────────────────────────────────────

/** Per account and chat (several accounts can be signed in on one device). */
const chatKeys = new Map<string, CryptoKey>();

async function wrapFor(sb: SupabaseClient, me: string, member: string, raw: ArrayBuffer) {
  const priv = await myPrivateKey(me);
  const pub = await publicKeyOf(sb, member);
  if (!priv || !pub) throw new Error('missing key');
  const iv = rand(12);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pairKey(priv, pub), raw);
  return { user_id: member, wrapped_key: b64(wrapped), iv: b64(iv) };
}

/** Turns encryption on for a chat: a new key, shared with every member. Throws if someone hasn't set up encryption. */
export async function enableChatEncryption(sb: SupabaseClient, me: string, conversationId: string, memberIds: string[]): Promise<void> {
  const missing: string[] = [];
  for (const id of memberIds) if (!(await publicKeyOf(sb, id))) missing.push(id);
  if (missing.length) throw Object.assign(new Error('Some people haven’t set up encrypted messages yet.'), { missing });
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  const rows = [];
  for (const id of new Set([me, ...memberIds])) rows.push({ conversation_id: conversationId, ...(await wrapFor(sb, me, id, raw)) });
  const { error } = await sb.from('conversation_keys').insert(rows);
  if (error) throw new Error(error.message);
  const { error: e2 } = await sb.rpc('set_conversation_e2e', { p_conversation_id: conversationId, p_on: true });
  if (e2) throw new Error(e2.message);
  chatKeys.set(`${me}|${conversationId}`, key);
}

/** The chat's key for you, or null if you can't read this chat (yet) on this device. */
export async function chatKey(sb: SupabaseClient, me: string, conversationId: string): Promise<CryptoKey | null> {
  const cached = chatKeys.get(`${me}|${conversationId}`);
  if (cached) return cached;
  const priv = await myPrivateKey(me);
  if (!priv) return null;
  const { data } = await sb.from('conversation_keys').select('wrapped_key, iv, wrapped_by').eq('conversation_id', conversationId).eq('user_id', me).maybeSingle();
  if (!data) return null;
  const row = data as { wrapped_key: string; iv: string; wrapped_by: string };
  const pub = await publicKeyOf(sb, row.wrapped_by);
  if (!pub) return null;
  try {
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv) }, await pairKey(priv, pub), unb64(row.wrapped_key));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    chatKeys.set(`${me}|${conversationId}`, key);
    return key;
  } catch {
    return null;
  }
}

/** Groups: give the chat key to members who joined after encryption was turned on. */
export async function shareWithNewMembers(sb: SupabaseClient, me: string, conversationId: string): Promise<void> {
  const key = await chatKey(sb, me, conversationId);
  if (!key) return;
  const { data } = await sb.rpc('e2e_missing_members', { p_conversation_id: conversationId });
  const missing = ((data ?? []) as { user_id: string; has_identity: boolean }[]).filter((m) => m.has_identity);
  if (!missing.length) return;
  const raw = await crypto.subtle.exportKey('raw', key);
  const rows = [];
  for (const m of missing) rows.push({ conversation_id: conversationId, ...(await wrapFor(sb, me, m.user_id, raw)) });
  await sb.from('conversation_keys').insert(rows);
}

// ── Messages ──────────────────────────────────────────────────────────────────────────────

export async function encryptText(key: CryptoKey, text: string): Promise<string> {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return `${E2E_PREFIX}${b64(iv)}:${b64(ct)}`;
}

export async function decryptText(key: CryptoKey, content: string): Promise<string | null> {
  if (!content.startsWith(E2E_PREFIX)) return content;
  const [iv, ct] = content.slice(E2E_PREFIX.length).split(':');
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv!) }, key, unb64(ct!)));
  } catch {
    return null;
  }
}
