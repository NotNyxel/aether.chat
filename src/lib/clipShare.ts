/**
 * Clip sharing (2.4). The sender's PC keeps the clip; sharing posts a card and uploads a temporary
 * relay copy in ≤45 MB parts (encrypted in encrypted chats). Recipients' apps get it straight from
 * the sender over WebRTC when they can, from the relay otherwise, and keep it locally: temporary
 * (deleted after N days) or kept. Each receipt is recorded; the relay copy is deleted as soon as
 * everyone has it, or after 72 hours (supabase/functions/clip-cleanup).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { iceServersFor } from '../hooks/useVoiceEngine';
import { useSettingsStore } from '../stores/settingsStore';
import type { MessageScope } from '../types/db';
import {
  canRecord,
  deleteClip,
  exportClip,
  fileSize,
  forgetLocal,
  hashFile,
  localCopies,
  readChunk,
  receivedPath,
  rememberLocal,
  setClipMeta,
  storeClip,
  useClipSettings,
  writeChunk,
  type ClipInfo,
} from './clips';
import { decryptBytes, encryptBytes } from './e2e';
import { isTauri } from './platform';

export const RELAY_CHUNK = 45 * 1024 * 1024;
const PIECE = 64 * 1024;

export interface ClipShare {
  id: string;
  scope_id: string;
  sender_id: string;
  title: string;
  game: string | null;
  detail: string | null;
  duration: number;
  size_bytes: number;
  width: number;
  height: number;
  fps: number;
  chunk_size: number;
  chunks: number;
  sha256: string | null;
  e2e: boolean;
  thumb_path: string | null;
  status: 'uploading' | 'ready' | 'gone';
  created_at: string;
  relay_expires_at: string;
}

// ── Progress, shown on cards and in the gallery ─────────────────────────────────────────────

export interface Transfer {
  phase: 'preparing' | 'uploading' | 'direct' | 'relay' | 'done' | 'error';
  progress: number;
  error?: string;
}
export const useTransfers = create<{ t: Record<string, Transfer>; set: (id: string, v: Transfer | null) => void }>()((set) => ({
  t: {},
  set: (id, v) =>
    set((s) => {
      const t = { ...s.t };
      if (v) t[id] = v;
      else delete t[id];
      return { t };
    }),
}));
const progress = (id: string, v: Transfer | null) => useTransfers.getState().set(id, v);

// ── Encryption of relay parts: 12-byte IV, then AES-GCM ciphertext ───────────────────────────

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function seal(key: CryptoKey | null, data: Uint8Array): Promise<Blob> {
  if (!key) return new Blob([data as BlobPart], { type: 'application/octet-stream' });
  const { blob, iv } = await encryptBytes(key, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  return new Blob([unb64(iv) as BlobPart, blob], { type: 'application/octet-stream' });
}
async function open(key: CryptoKey | null, data: ArrayBuffer): Promise<Uint8Array> {
  if (!key) return new Uint8Array(data);
  const plain = await decryptBytes(key, b64(new Uint8Array(data, 0, 12)), data.slice(12));
  if (!plain) throw new Error('This clip couldn’t be decrypted on this device.');
  return new Uint8Array(plain);
}

// ── Seeding: which shares this PC can send directly (until the relay window ends) ─────────────

const SEEDS = 'aether.clips.seeding';
type Seeds = Record<string, { path: string; until: number; temp: boolean }>;
function seeds(): Seeds {
  try {
    return JSON.parse(localStorage.getItem(SEEDS) ?? '{}') as Seeds;
  } catch {
    return {};
  }
}
function saveSeeds(s: Seeds) {
  try {
    localStorage.setItem(SEEDS, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
/** Forget expired seeds and delete compressed copies made just for sharing. */
export async function pruneSeeds() {
  const all = seeds();
  const now = Date.now();
  for (const [id, s] of Object.entries(all)) {
    if (s.until > now) continue;
    if (s.temp) await deleteClip(s.path).catch(() => undefined);
    delete all[id];
  }
  saveSeeds(all);
}

// ── Sharing ─────────────────────────────────────────────────────────────────────────────────

export interface ShareOptions {
  quality: 'original' | 'high' | 'saver';
  start: number;
  end: number;
  gameAudio: boolean;
  mic: boolean;
  title: string;
}

const part = (n: number) => `part-${String(n).padStart(4, '0')}`;

export async function shareClip(
  sb: SupabaseClient,
  me: string,
  clip: ClipInfo,
  scope: MessageScope,
  opts: ShareOptions,
  key: CryptoKey | null,
  encrypt: ((text: string) => Promise<string>) | null,
): Promise<string> {
  const tmpId = `share:${clip.path}`;
  progress(tmpId, { phase: 'preparing', progress: 0 });
  try {
    const untouched = opts.quality === 'original' && opts.start <= 0.05 && opts.end >= clip.duration - 0.05 && opts.gameAudio && (opts.mic || !(clip.audio_tracks.includes('Microphone') || clip.audio_tracks.length === 2));
    const path = untouched
      ? clip.path
      : await exportClip({ path: clip.path, start: opts.start, end: opts.end, gameAudio: opts.gameAudio, mic: opts.mic, title: opts.title, quality: opts.quality, out: 'temp' });
    const size = await fileSize(path);
    const sha = await hashFile(path);
    const chunks = Math.max(1, Math.ceil(size / RELAY_CHUNK));
    const { data: share, error } = await sb
      .from('clip_shares')
      .insert({
        scope_id: scope.id,
        title: opts.title.slice(0, 120) || 'Clip',
        game: clip.meta.game ?? null,
        detail: clip.meta.detail ?? null,
        duration: opts.end - opts.start,
        size_bytes: size,
        width: clip.width,
        height: clip.height,
        fps: Math.round(clip.fps),
        chunk_size: RELAY_CHUNK,
        chunks,
        sha256: sha,
        e2e: !!key,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    const id = (share as ClipShare).id;
    progress(tmpId, null);
    progress(id, { phase: 'uploading', progress: 0 });
    saveSeeds({ ...seeds(), [id]: { path, until: Date.now() + 72 * 3600_000, temp: path !== clip.path } });
    rememberLocal(id, clip.path);

    // Full-resolution thumbnail for the card.
    if (clip.thumb) {
      const bytes = await readChunk(clip.thumb, 0, 20 * 1024 * 1024);
      const up = await sb.storage.from('clips').upload(`${me}/${id}/thumb.jpg`, await seal(key, bytes), { contentType: key ? 'application/octet-stream' : 'image/jpeg' });
      if (!up.error) await sb.from('clip_shares').update({ thumb_path: `${me}/${id}/thumb.jpg` }).eq('id', id);
    }

    // The card in the chat (old app versions just see the text).
    const text = `🎬 ${opts.title || 'Clip'}`;
    const content = encrypt ? await encrypt(text) : text;
    const msg = await sb.from('messages').insert({ [scope.kind === 'channel' ? 'channel_id' : 'conversation_id']: scope.id, content, clip_id: id });
    if (msg.error) throw new Error(msg.error.message);

    // The relay copy, for anyone who can't get it directly.
    for (let i = 0; i < chunks; i++) {
      const bytes = await readChunk(path, i * RELAY_CHUNK, RELAY_CHUNK);
      const up = await sb.storage.from('clips').upload(`${me}/${id}/${part(i)}`, await seal(key, bytes), { contentType: 'application/octet-stream', upsert: true });
      if (up.error) throw new Error(up.error.message);
      progress(id, { phase: 'uploading', progress: (i + 1) / chunks });
    }
    await sb.from('clip_shares').update({ status: 'ready' }).eq('id', id);
    progress(id, { phase: 'done', progress: 1 });
    setTimeout(() => progress(id, null), 4000);
    return id;
  } catch (e) {
    progress(tmpId, null);
    throw e;
  }
}

// ── Receiving ───────────────────────────────────────────────────────────────────────────────

/** Writes chunks in order, to a file (PC) or into memory for browser storage. Small pieces are
 * batched into ~2 MB writes so a big clip isn't thousands of tiny disk writes. */
function makeSink(path: string | null) {
  let chain = Promise.resolve();
  let offset = 0;
  let written = 0;
  const parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingSize = 0;
  const flush = () => {
    if (!pendingSize) return chain;
    const buf = new Uint8Array(pendingSize);
    let o = 0;
    for (const p of pending) {
      buf.set(p, o);
      o += p.byteLength;
    }
    pending = [];
    pendingSize = 0;
    const at = written;
    written += buf.byteLength;
    chain = chain.then(() => (path ? writeChunk(path, at, buf) : void parts.push(new Blob([buf as BlobPart]))));
    return chain;
  };
  return {
    write(bytes: Uint8Array) {
      offset += bytes.byteLength;
      pending.push(bytes.slice());
      pendingSize += bytes.byteLength;
      return pendingSize >= 2 * 1024 * 1024 ? flush() : chain;
    },
    done: () => flush(),
    blob: () => new Blob(parts, { type: 'video/mp4' }),
    get size() {
      return offset;
    },
    reset() {
      offset = 0;
      written = 0;
      parts.length = 0;
      pending = [];
      pendingSize = 0;
      chain = Promise.resolve();
    },
  };
}
type Sink = ReturnType<typeof makeSink>;

const waitIce = (pc: RTCPeerConnection, ms = 3000) =>
  new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    });
  });
const iceServers = () => iceServersFor(useSettingsStore.getState().audio);

/** Try to get the clip straight from the sender's PC. Resolves false if that doesn't work out. */
async function fetchDirect(sb: SupabaseClient, me: string, share: ClipShare, sink: Sink): Promise<boolean> {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const req = await sb.from('clip_p2p_requests').insert({ share_id: share.id, nonce });
  if (req.error) return false;
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  const dc = pc.createDataChannel('clip', { ordered: true });
  dc.binaryType = 'arraybuffer';
  const reply = sb.channel(`clipp2p:${me}:${nonce}`);
  const ask = sb.channel(`clipp2p:${share.sender_id}`);
  const cleanup = () => {
    try {
      dc.close();
      pc.close();
    } catch {
      /* ignore */
    }
    void sb.removeChannel(reply);
    void sb.removeChannel(ask);
  };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    const answered = new Promise<RTCSessionDescriptionInit>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no answer')), 9000);
      reply.on('broadcast', { event: 'answer' }, ({ payload }) => {
        clearTimeout(t);
        resolve(payload.sdp as RTCSessionDescriptionInit);
      });
    });
    await new Promise<void>((resolve, reject) => reply.subscribe((s) => (s === 'SUBSCRIBED' ? resolve() : s === 'CHANNEL_ERROR' && reject(new Error(s)))));
    await new Promise<void>((resolve, reject) => ask.subscribe((s) => (s === 'SUBSCRIBED' ? resolve() : s === 'CHANNEL_ERROR' && reject(new Error(s)))));
    await ask.send({ type: 'broadcast', event: 'want', payload: { shareId: share.id, nonce, from: me, sdp: pc.localDescription } });
    await pc.setRemoteDescription(await answered);
    progress(share.id, { phase: 'direct', progress: 0 });
    await new Promise<void>((resolve, reject) => {
      let total = share.size_bytes;
      let stall = setTimeout(() => reject(new Error('stalled')), 15000);
      const bump = () => {
        clearTimeout(stall);
        stall = setTimeout(() => reject(new Error('stalled')), 15000);
      };
      dc.onmessage = (ev) => {
        bump();
        if (typeof ev.data === 'string') {
          const h = JSON.parse(ev.data) as { size?: number; error?: string };
          if (h.error) return reject(new Error(h.error));
          if (h.size) total = h.size;
          return;
        }
        void sink.write(new Uint8Array(ev.data as ArrayBuffer));
        progress(share.id, { phase: 'direct', progress: sink.size / total });
        if (sink.size >= total) {
          clearTimeout(stall);
          resolve();
        }
      };
      dc.onclose = () => sink.size < total && reject(new Error('closed'));
    });
    await sink.done();
    cleanup();
    return true;
  } catch {
    cleanup();
    sink.reset();
    return false;
  }
}

async function fetchRelay(sb: SupabaseClient, share: ClipShare, key: CryptoKey | null, sink: Sink) {
  for (let i = 0; i < share.chunks; i++) {
    const { data, error } = await sb.storage.from('clips').download(`${share.sender_id}/${share.id}/${part(i)}`);
    if (error || !data) throw new Error(share.status === 'gone' ? 'This clip has expired.' : 'The clip isn’t ready yet. Try again in a moment.');
    await sink.write(await open(key, await data.arrayBuffer()));
    progress(share.id, { phase: 'relay', progress: (i + 1) / share.chunks });
  }
  await sink.done();
}

const busy = new Set<string>();

/** Get a shared clip onto this device. */
export async function receiveClip(sb: SupabaseClient, me: string, share: ClipShare, key: CryptoKey | null, senderName: string): Promise<void> {
  if (busy.has(share.id) || localCopies()[share.id]) return;
  if (share.e2e && !key) throw new Error('Unlock encrypted messages on this device to get this clip.');
  busy.add(share.id);
  const keepDays = useClipSettings.getState().s.keepDays;
  const expires = keepDays > 0 ? Date.now() + keepDays * 86_400_000 : null;
  try {
    const path = isTauri ? await receivedPath(share.title, senderName) : null;
    const sink = makeSink(path);
    let via: 'p2p' | 'relay' = 'p2p';
    if (!(await fetchDirect(sb, me, share, sink))) {
      via = 'relay';
      await fetchRelay(sb, share, share.e2e ? key : null, sink);
    }
    if (path) {
      if (share.sha256 && (await hashFile(path)) !== share.sha256) {
        await deleteClip(path).catch(() => undefined);
        throw new Error('The clip arrived damaged. Try again.');
      }
      await setClipMeta(path, { received: true, from: senderName, shareId: share.id, expires, game: share.game, detail: share.detail }, share.title).catch(() => undefined);
      rememberLocal(share.id, path);
    } else {
      let thumb: Blob | undefined;
      if (share.thumb_path) {
        const t = await sb.storage.from('clips').download(share.thumb_path);
        if (t.data) thumb = new Blob([await open(share.e2e ? key : null, await t.data.arrayBuffer())] as BlobPart[], { type: 'image/jpeg' });
      }
      await storeClip(
        { shareId: share.id, title: share.title, game: share.game, detail: share.detail, from: senderName, duration: share.duration, size: share.size_bytes, width: share.width, height: share.height, created: Date.parse(share.created_at), expires, thumb },
        sink.blob(),
      );
      rememberLocal(share.id, 'idb');
    }
    await sb.from('clip_receipts').insert({ share_id: share.id, via });
    // Free the relay as soon as possible (the function only deletes what everyone has).
    void sb.functions.invoke('clip-cleanup', { body: {} }).catch(() => undefined);
    progress(share.id, { phase: 'done', progress: 1 });
    setTimeout(() => progress(share.id, null), 3000);
  } catch (e) {
    progress(share.id, { phase: 'error', progress: 0, error: e instanceof Error ? e.message : String(e) });
    forgetLocal(share.id);
    throw e;
  } finally {
    busy.delete(share.id);
  }
}

/** Should this device download clips in the background? */
export function autoDownloadAllowed(): boolean {
  const mode = useClipSettings.getState().s.autoDownload;
  if (mode === 'always') return true;
  if (mode === 'tap') return false;
  if (isTauri) return true;
  const c = (navigator as unknown as { connection?: { type?: string; saveData?: boolean } }).connection;
  return !!c && !c.saveData && (c.type === 'wifi' || c.type === 'ethernet');
}

// ── Seeding: answer direct requests for clips this PC shared ─────────────────────────────────

export function startSeeding(sb: SupabaseClient, me: string): () => void {
  if (!canRecord) return () => undefined;
  let active = 0;
  const ch = sb.channel(`clipp2p:${me}`);
  ch.on('broadcast', { event: 'want' }, ({ payload }) => {
    const p = payload as { shareId: string; nonce: string; from: string; sdp: RTCSessionDescriptionInit };
    const seed = seeds()[p.shareId];
    if (!seed || seed.until < Date.now() || active >= 3) return;
    void (async () => {
      // Only people the database says asked for this clip (and may see it) get it.
      const { data } = await sb.from('clip_p2p_requests').select('id').eq('share_id', p.shareId).eq('nonce', p.nonce).eq('requester', p.from).maybeSingle();
      if (!data) return;
      active++;
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      const reply = sb.channel(`clipp2p:${p.from}:${p.nonce}`);
      const done = () => {
        active--;
        try {
          pc.close();
        } catch {
          /* ignore */
        }
        void sb.removeChannel(reply);
      };
      const giveUp = setTimeout(done, 10 * 60_000);
      try {
        pc.ondatachannel = (ev) => {
          const dc = ev.channel;
          dc.binaryType = 'arraybuffer';
          dc.bufferedAmountLowThreshold = 2 * 1024 * 1024;
          dc.onopen = async () => {
            try {
              const size = await fileSize(seed.path);
              dc.send(JSON.stringify({ size }));
              for (let off = 0; off < size; off += 1024 * 1024) {
                const bytes = await readChunk(seed.path, off, 1024 * 1024);
                for (let i = 0; i < bytes.byteLength; i += PIECE) {
                  if (dc.bufferedAmount > 8 * 1024 * 1024) await new Promise<void>((r) => (dc.onbufferedamountlow = () => r()));
                  if (dc.readyState !== 'open') throw new Error('closed');
                  dc.send(bytes.subarray(i, i + PIECE));
                }
              }
              // Let the buffer drain before closing.
              while (dc.bufferedAmount > 0 && dc.readyState === 'open') await new Promise((r) => setTimeout(r, 200));
            } catch {
              try {
                dc.send(JSON.stringify({ error: 'The sender stopped sharing.' }));
              } catch {
                /* ignore */
              }
            } finally {
              clearTimeout(giveUp);
              setTimeout(done, 3000);
            }
          };
        };
        await pc.setRemoteDescription(p.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        await waitIce(pc);
        await new Promise<void>((resolve, reject) => reply.subscribe((s) => (s === 'SUBSCRIBED' ? resolve() : s === 'CHANNEL_ERROR' && reject(new Error(s)))));
        await reply.send({ type: 'broadcast', event: 'answer', payload: { sdp: pc.localDescription } });
      } catch {
        clearTimeout(giveUp);
        done();
      }
    })();
  });
  ch.subscribe();
  return () => void sb.removeChannel(ch);
}
