/**
 * Encrypted attachments (2.0): downloads an encrypted file, decrypts it with the chat key on this
 * device, and hands back a normal attachment (a local blob URL plus the real name, type and size)
 * so every player and viewer works unchanged. Decrypted files are kept for the session.
 */
import { useEffect, useRef, useState } from 'react';
import { useE2e } from '../components/E2eChat';
import { decryptBytes, decryptText } from '../lib/e2e';
import type { Attachment } from '../types/db';

type Meta = Pick<Attachment, 'name' | 'content_type' | 'width' | 'height'>;
const done = new Map<string, Attachment>();
const metas = new Map<string, Meta>();

export async function decryptMeta(key: CryptoKey, a: Attachment): Promise<Meta | null> {
  if (!a.e2e) return a;
  const hit = metas.get(a.e2e.meta);
  if (hit) return hit;
  const text = await decryptText(key, a.e2e.meta);
  if (!text) return null;
  try {
    const m = JSON.parse(text) as Meta;
    const safe: Meta = {
      name: String(m.name ?? 'file').slice(0, 255),
      content_type: /^[a-z]+\/[a-zA-Z0-9.+-]+$/.test(m.content_type ?? '') ? m.content_type : 'application/octet-stream',
      width: typeof m.width === 'number' ? m.width : undefined,
      height: typeof m.height === 'number' ? m.height : undefined,
    };
    metas.set(a.e2e.meta, safe);
    return safe;
  } catch {
    return null;
  }
}

export type Resolved = { state: 'plain' | 'ready'; a: Attachment } | { state: 'loading' | 'locked' | 'failed'; a: Attachment };

export function useEncryptedAttachment(a: Attachment): Resolved {
  const { key } = useE2e();
  const latest = useRef(a);
  latest.current = a;
  const sealed = a.e2e ? `${a.url}|${a.e2e.iv}` : null;
  const [res, setRes] = useState<Resolved | null>(() => (a.e2e && done.has(a.url) ? { state: 'ready', a: done.get(a.url)! } : null));
  useEffect(() => {
    const cur = latest.current;
    if (!sealed || !cur.e2e) return;
    const hit = done.get(cur.url);
    if (hit) return setRes({ state: 'ready', a: hit });
    if (!key) return setRes({ state: 'locked', a: cur });
    let gone = false;
    setRes({ state: 'loading', a: cur });
    void (async () => {
      const meta = await decryptMeta(key, cur);
      if (!meta) return !gone && setRes({ state: 'failed', a: cur });
      const r = await fetch(cur.url).catch(() => null);
      const bytes = r?.ok ? await r.arrayBuffer() : null;
      const plain = bytes ? await decryptBytes(key, cur.e2e!.iv, bytes) : null;
      if (!plain) return !gone && setRes({ state: 'failed', a: { ...cur, ...meta } });
      const out: Attachment = { ...cur, ...meta, url: URL.createObjectURL(new Blob([plain], { type: meta.content_type })) };
      done.set(cur.url, out);
      if (!gone) setRes({ state: 'ready', a: out });
    })();
    return () => {
      gone = true;
    };
  }, [sealed, key]);
  if (!a.e2e) return { state: 'plain', a };
  return res ?? { state: key ? 'loading' : 'locked', a };
}
