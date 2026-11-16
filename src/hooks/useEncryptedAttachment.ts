/**
 * Encrypted attachments (2.0): downloads an encrypted file, decrypts it with the chat key on this
 * device, and hands back a normal attachment (a local blob URL plus the real name, type and size)
 * so every player and viewer works unchanged. Decrypted files are kept for the session.
 */
import { useEffect, useState } from 'react';
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
  const [res, setRes] = useState<Resolved>(() =>
    !a.e2e ? { state: 'plain', a } : done.has(a.url) ? { state: 'ready', a: done.get(a.url)! } : { state: key ? 'loading' : 'locked', a },
  );
  useEffect(() => {
    if (!a.e2e) return setRes({ state: 'plain', a });
    const hit = done.get(a.url);
    if (hit) return setRes({ state: 'ready', a: hit });
    if (!key) return setRes({ state: 'locked', a });
    let gone = false;
    setRes({ state: 'loading', a });
    void (async () => {
      const meta = await decryptMeta(key, a);
      if (!meta) return !gone && setRes({ state: 'failed', a });
      const r = await fetch(a.url).catch(() => null);
      const bytes = r?.ok ? await r.arrayBuffer() : null;
      const plain = bytes ? await decryptBytes(key, a.e2e!.iv, bytes) : null;
      if (!plain) return !gone && setRes({ state: 'failed', a: { ...a, ...meta } });
      const out: Attachment = { ...a, ...meta, url: URL.createObjectURL(new Blob([plain], { type: meta.content_type })) };
      done.set(a.url, out);
      if (!gone) setRes({ state: 'ready', a: out });
    })();
    return () => {
      gone = true;
    };
  }, [a, key]);
  return res;
}
