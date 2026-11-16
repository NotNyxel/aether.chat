/**
 * End-to-end encryption for DMs and groups, built on the browser's WebCrypto (no home-made crypto):
 *   - identity: an ECDH P-256 key pair per person. Public half in e2e_public_keys. Private half
 *     stays on your devices; a backup encrypted with a recovery code (or, before 1.9, a passphrase
 *     you picked) using PBKDF2-SHA256, 310,000 rounds → AES-256-GCM. The code never leaves devices.
 *   - chat key: random AES-256-GCM per chat, wrapped for each member with an ECDH-derived key.
 *   - messages: "aether-e2e:v1:<iv>:<ciphertext>" (base64). Attachments are not encrypted.
 *
 * Since 1.9.0 it sets itself up: the first device makes the key pair and a random recovery code.
 * Other devices get the key by being approved from a device that already has it (device linking),
 * or with the recovery code.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const E2E_PREFIX = 'aether-e2e:v1:';
export const isEncrypted = (content: string | null | undefined) => !!content && content.startsWith('aether-e2e:');
/** Encrypted messages can be as long as normal ones; the server allows the longer ciphertext. */
export const E2E_MAX_CHARS = 4000;
/** The server's cap on encrypted text (emoji-heavy messages take more room once encrypted). */
export const E2E_MAX_CIPHERTEXT = 6000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const localKey = (userId: string) => `aether.e2e.${userId}`;
const localCode = (userId: string) => `aether.e2e.${userId}.rc`;
/** The public half of a private JWK. */
const publicJwk = (priv: JsonWebKey): JsonWebKey => ({ kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y, ext: true });

// ── Identity ──────────────────────────────────────────────────────────────────────────────

async function passphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export type E2eStatus = 'none' | 'locked' | 'ready';

/** none = never set up; locked = set up, but not on this device; ready = usable here. */
export async function e2eStatus(sb: SupabaseClient, userId: string): Promise<E2eStatus> {
  if (localStorage.getItem(localKey(userId))) return 'ready';
  const { data } = await sb.from('e2e_public_keys').select('user_id').eq('user_id', userId).maybeSingle();
  return data ? 'locked' : 'none';
}

/** Saves the backup of your private key, encrypted with a recovery code or passphrase. */
async function writeBackup(sb: SupabaseClient, userId: string, privJson: string, secret: string) {
  const salt = rand(16);
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await passphraseKey(secret, salt), enc.encode(privJson));
  const { error } = await sb.from('e2e_key_backups').upsert({ user_id: userId, ciphertext: b64(ct), salt: b64(salt), iv: b64(iv), updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 24 random characters (120 bits). */
function makeRecoveryCode(): string {
  return Array.from(rand(24), (b) => CODE_ALPHABET[b % 32]).join('');
}
const normaliseCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** XXXX-XXXX-XXXX-XXXX-XXXX-XXXX */
export const formatRecoveryCode = (code: string) => code.match(/.{1,4}/g)?.join('-') ?? code;

/** The recovery code made on this device (null if this device didn't make the current one). */
export const recoveryCode = (userId: string) => localStorage.getItem(localCode(userId));

/**
 * Makes your key pair. Returns false if another device already has one (this device then needs
 * linking). Without a passphrase, a recovery code is made and kept on this device to show you.
 */
export async function setUpIdentity(sb: SupabaseClient, userId: string, passphrase?: string): Promise<boolean> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privJson = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
  const { error } = await sb.from('e2e_public_keys').insert({ user_id: userId, public_key: pub });
  if (error) {
    if (error.code === '23505') return false;
    throw new Error(error.message);
  }
  localStorage.setItem(localKey(userId), privJson);
  const code = passphrase ?? makeRecoveryCode();
  await writeBackup(sb, userId, privJson, code);
  if (!passphrase) localStorage.setItem(localCode(userId), code);
  return true;
}

/** Sets it up quietly if you've never had it. Safe to call on every start. */
export async function autoSetUp(sb: SupabaseClient, userId: string): Promise<E2eStatus> {
  const status = await e2eStatus(sb, userId);
  if (status !== 'none') return status;
  return (await setUpIdentity(sb, userId)) ? 'ready' : 'locked';
}

/** A new recovery code for the backup (the old code or passphrase stops working). */
export async function newRecoveryCode(sb: SupabaseClient, userId: string): Promise<string> {
  const privJson = localStorage.getItem(localKey(userId));
  if (!privJson) throw new Error('Unlock encrypted messages on this device first.');
  const code = makeRecoveryCode();
  await writeBackup(sb, userId, privJson, code);
  localStorage.setItem(localCode(userId), code);
  return code;
}

/**
 * Starts over with a new key pair (when every device and the recovery code are lost). Encrypted
 * chats come back once someone else in each chat opens it, since their app hands you the chat key again.
 */
export async function resetIdentity(sb: SupabaseClient, userId: string): Promise<string> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privJson = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
  const { error } = await sb.from('e2e_public_keys').upsert({ user_id: userId, public_key: pub });
  if (error) throw new Error(error.message);
  localStorage.setItem(localKey(userId), privJson);
  const code = makeRecoveryCode();
  await writeBackup(sb, userId, privJson, code);
  localStorage.setItem(localCode(userId), code);
  await sb.from('conversation_keys').delete().eq('user_id', userId);
  for (const k of [...chatKeys.keys()]) if (k.startsWith(`${userId}|`)) chatKeys.delete(k);
  pubCache.delete(userId);
  return code;
}

/** Another device: unlock with your recovery code (or the passphrase picked before 1.9). */
export async function unlockIdentity(sb: SupabaseClient, userId: string, secret: string): Promise<void> {
  const { data, error } = await sb.from('e2e_key_backups').select('ciphertext, salt, iv').eq('user_id', userId).maybeSingle();
  if (error || !data) throw new Error('No encryption backup was found for your account.');
  const row = data as { ciphertext: string; salt: string; iv: string };
  let plain: ArrayBuffer | null = null;
  for (const s of new Set([secret, normaliseCode(secret)])) {
    if (!s) continue;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv) }, await passphraseKey(s, unb64(row.salt)), unb64(row.ciphertext));
      break;
    } catch {
      /* try the other form */
    }
  }
  if (!plain) throw new Error('That recovery code is not right.');
  localStorage.setItem(localKey(userId), dec.decode(plain));
}

export function forgetOnThisDevice(userId: string) {
  localStorage.removeItem(localKey(userId));
  localStorage.removeItem(localCode(userId));
  for (const k of [...chatKeys.keys()]) if (k.startsWith(`${userId}|`)) chatKeys.delete(k);
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
      if (!data) {
        pubCache.delete(userId); // they may set it up later
        return null;
      }
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
  const wrapper_pub = publicJwk(JSON.parse(localStorage.getItem(localKey(me))!) as JsonWebKey);
  return { user_id: member, wrapped_key: b64(wrapped), iv: b64(iv), wrapper_pub };
}

/** Does everyone listed have encryption set up? */
export async function allHaveKeys(sb: SupabaseClient, userIds: string[]): Promise<boolean> {
  for (const id of userIds) if (!(await publicKeyOf(sb, id))) return false;
  return true;
}

/** Turns encryption on for a chat: a new key, shared with every member. Throws if someone hasn't set up encryption. */
export async function enableChatEncryption(sb: SupabaseClient, me: string, conversationId: string, memberIds: string[]): Promise<void> {
  const missing: string[] = [];
  for (const id of memberIds) if (!(await publicKeyOf(sb, id))) missing.push(id);
  if (missing.length) throw Object.assign(new Error('Some people in this chat are on an older version of Aether that can’t encrypt yet.'), { missing });
  const existing = await chatKey(sb, me, conversationId);
  const key = existing ?? (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));
  if (!existing) {
    const raw = await crypto.subtle.exportKey('raw', key);
    const rows = [];
    for (const id of new Set([me, ...memberIds])) rows.push({ conversation_id: conversationId, ...(await wrapFor(sb, me, id, raw)) });
    const { error } = await sb.from('conversation_keys').insert(rows);
    if (error) throw new Error(error.message);
  }
  const { error: e2 } = await sb.rpc('set_conversation_e2e', { p_conversation_id: conversationId, p_on: true });
  if (e2) throw new Error(e2.message);
  chatKeys.set(`${me}|${conversationId}`, key);
}

export async function disableChatEncryption(sb: SupabaseClient, conversationId: string): Promise<void> {
  const { error } = await sb.rpc('set_conversation_e2e', { p_conversation_id: conversationId, p_on: false });
  if (error) throw new Error(error.message);
}

/** The chat's key for you, or null if you can't read this chat (yet) on this device. */
export async function chatKey(sb: SupabaseClient, me: string, conversationId: string): Promise<CryptoKey | null> {
  const cached = chatKeys.get(`${me}|${conversationId}`);
  if (cached) return cached;
  const priv = await myPrivateKey(me);
  if (!priv) return null;
  const { data } = await sb.from('conversation_keys').select('wrapped_key, iv, wrapped_by, wrapper_pub').eq('conversation_id', conversationId).eq('user_id', me).maybeSingle();
  if (!data) return null;
  const row = data as { wrapped_key: string; iv: string; wrapped_by: string; wrapper_pub: JsonWebKey | null };
  const pub = row.wrapper_pub ? await crypto.subtle.importKey('jwk', row.wrapper_pub, ECDH, false, []).catch(() => null) : await publicKeyOf(sb, row.wrapped_by);
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

/** Give the chat key to members who don't have it (joined later, or reset their encryption). */
export async function shareWithNewMembers(sb: SupabaseClient, me: string, conversationId: string): Promise<void> {
  const key = await chatKey(sb, me, conversationId);
  if (!key) return;
  const { data } = await sb.rpc('e2e_missing_members', { p_conversation_id: conversationId });
  const missing = ((data ?? []) as { user_id: string; has_identity: boolean }[]).filter((m) => m.has_identity);
  if (!missing.length) return;
  const raw = await crypto.subtle.exportKey('raw', key);
  const rows = [];
  for (const m of missing) {
    pubCache.delete(m.user_id); // they may have a new key since we last looked
    rows.push({ conversation_id: conversationId, ...(await wrapFor(sb, me, m.user_id, raw)) });
  }
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

// ── Files (2.0) ───────────────────────────────────────────────────────────────────────────
// Attachments in an encrypted chat are encrypted with the chat key before upload: the server only
// ever stores scrambled bytes. The real name, type and size go in `meta`, encrypted the same way.

export interface EncryptedFile {
  blob: Blob;
  iv: string;
}

export async function encryptBytes(key: CryptoKey, data: ArrayBuffer): Promise<EncryptedFile> {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { blob: new Blob([ct], { type: 'application/octet-stream' }), iv: b64(iv) };
}

export async function decryptBytes(key: CryptoKey, iv: string, data: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, data);
  } catch {
    return null;
  }
}

// ── Device linking ────────────────────────────────────────────────────────────────────────
// The new device posts a one-time public key. One of your devices that has the identity key
// approves: it encrypts the identity key with a key only the new device can derive. Both devices
// show the same 6-digit code (from the one-time key), so you can check nobody swapped it on the way.

export interface LinkRequest {
  id: string;
  device_name: string;
  request_pub: JsonWebKey;
  approver_pub: JsonWebKey | null;
  ciphertext: string | null;
  iv: string | null;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
}

/** The code both devices show for a request, like "482 913". */
export async function linkCode(requestPub: JsonWebKey): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${requestPub.x}.${requestPub.y}`)));
  const n = ((d[0]! << 24) | (d[1]! << 16) | (d[2]! << 8) | d[3]!) >>> 0;
  const s = String(n % 1_000_000).padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone or iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'a device';
  const app = '__TAURI_INTERNALS__' in window ? 'Aether app' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${app} on ${os}`;
}

export interface PendingLink {
  id: string;
  code: string;
  done: Promise<void>;
  cancel: () => void;
}

/** New device: ask to be let in. `done` resolves once another device approves (rejects if denied). */
export async function requestLink(sb: SupabaseClient, userId: string): Promise<PendingLink> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  const request_pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const { data, error } = await sb.from('e2e_link_requests').insert({ device_name: deviceName(), request_pub }).select('id').single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  let stop = () => {};
  const done = new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      stop();
      if (err) reject(err);
      else resolve();
    };
    const check = async () => {
      if (finished) return;
      const { data: row } = await sb.from('e2e_link_requests').select('*').eq('id', id).maybeSingle();
      const r = row as LinkRequest | null;
      if (!r) return finish(new Error('The request expired. Try again.'));
      if (r.status === 'denied') return finish(new Error('The request was denied on your other device.'));
      if (r.status !== 'approved' || !r.approver_pub || !r.ciphertext || !r.iv) return;
      try {
        const approver = await crypto.subtle.importKey('jwk', r.approver_pub, ECDH, false, []);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(r.iv) }, await pairKey(pair.privateKey, approver), unb64(r.ciphertext));
        const privJson = dec.decode(plain);
        // Only accept the key if it matches the public key everyone else uses for you.
        const { data: pubRow } = await sb.from('e2e_public_keys').select('public_key').eq('user_id', userId).maybeSingle();
        const theirs = (pubRow as { public_key: JsonWebKey } | null)?.public_key;
        const mine = publicJwk(JSON.parse(privJson) as JsonWebKey);
        if (!theirs || theirs.x !== mine.x || theirs.y !== mine.y) return finish(new Error('The key that came back doesn’t match your account. Nothing was changed.'));
        localStorage.setItem(localKey(userId), privJson);
        await Promise.resolve(sb.from('e2e_link_requests').delete().eq('id', id)).catch(() => {});
        finish();
      } catch {
        finish(new Error('Could not read the key from your other device.'));
      }
    };
    const channel = sb
      .channel(`e2e-link-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'e2e_link_requests', filter: `id=eq.${id}` }, () => void check())
      .subscribe();
    const timer = setInterval(() => void check(), 4000);
    stop = () => {
      clearInterval(timer);
      void sb.removeChannel(channel);
    };
  });
  return {
    id,
    code: await linkCode(request_pub),
    done,
    cancel: () => {
      stop();
      void Promise.resolve(sb.from('e2e_link_requests').delete().eq('id', id)).catch(() => {});
    },
  };
}

/** A device that has the key: let the new device in. */
export async function approveLink(sb: SupabaseClient, me: string, req: LinkRequest): Promise<void> {
  const privJson = localStorage.getItem(localKey(me));
  if (!privJson) throw new Error('This device doesn’t have your encryption key.');
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  const requester = await crypto.subtle.importKey('jwk', req.request_pub, ECDH, false, []);
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pairKey(pair.privateKey, requester), enc.encode(privJson));
  const approver_pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const { error } = await sb.from('e2e_link_requests').update({ approver_pub, ciphertext: b64(ct), iv: b64(iv), status: 'approved' }).eq('id', req.id);
  if (error) throw new Error(error.message);
}

export async function denyLink(sb: SupabaseClient, id: string): Promise<void> {
  await sb.from('e2e_link_requests').update({ status: 'denied' }).eq('id', id);
}

// ── Calls ─────────────────────────────────────────────────────────────────────────────────
// Calls are peer-to-peer WebRTC, so audio and video are already encrypted between the two devices
// (DTLS-SRTP). What a server in the middle could do is swap the connection fingerprints while the
// call is being set up. Each side proves its fingerprint with a key only the two people can derive
// (from their encryption keys), so a swapped fingerprint is caught and the connection dropped.

async function callKey(sb: SupabaseClient, me: string, other: string): Promise<CryptoKey | null> {
  const raw = localStorage.getItem(localKey(me));
  const pub = await publicKeyOf(sb, other);
  if (!raw || !pub) return null;
  // The stored key says it's only for deriveKey; this use needs deriveBits, so drop that note.
  const { key_ops: _ops, ...jwk } = JSON.parse(raw) as JsonWebKey;
  const priv = await crypto.subtle.importKey('jwk', jwk, ECDH, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(new ArrayBuffer(32)), info: enc.encode('aether-call-fingerprint-v1') },
    hkdf,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

/** Proof that `fingerprint` is mine, for `other` (null if either of us has no encryption key). */
export async function callProof(sb: SupabaseClient, me: string, other: string, context: string, fingerprint: string): Promise<string | null> {
  const key = await callKey(sb, me, other).catch(() => null);
  if (!key) return null;
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(`${context}|${fingerprint.toUpperCase()}`)));
}

/** true = proven, false = the proof is wrong, null = can't check here (no key on this device). */
export async function checkCallProof(sb: SupabaseClient, me: string, other: string, context: string, fingerprint: string, proof: string): Promise<boolean | null> {
  const verify = async () => {
    const key = await callKey(sb, me, other).catch(() => null);
    if (!key) return null;
    try {
      return await crypto.subtle.verify('HMAC', key, unb64(proof), enc.encode(`${context}|${fingerprint.toUpperCase()}`));
    } catch {
      return false;
    }
  };
  const first = await verify();
  if (first !== false) return first;
  pubCache.delete(other); // they may have reset their encryption since we cached their key
  return verify();
}

/** The sha-256 DTLS fingerprint in an SDP ("AB:CD:…"), if there is one. */
export const sdpFingerprint = (sdp: string | undefined | null) => /a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/.exec(sdp ?? '')?.[1]?.toUpperCase() ?? null;
