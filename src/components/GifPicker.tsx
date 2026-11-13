/**
 * GIF picker (GIPHY): trending when empty, search as you type, infinite scroll. Picking one sends it
 * straight away. Sent GIFs play on a loop without sound, like Discord's.
 */
import { useEffect, useRef, useState } from 'react';
import { useEscape } from '../lib/escape';
import { useSupabase } from '../lib/supabase';
import type { Attachment } from '../types/db';
import { SearchIcon } from './icons';

export interface Gif {
  id: string;
  title: string;
  url: string;
  type: string;
  width: number;
  height: number;
  preview: string;
  previewWidth: number;
  previewHeight: number;
}

export function gifAttachment(g: Gif): Attachment {
  return { url: g.url, name: `${g.title.slice(0, 60) || 'GIF'}.${g.type === 'video/mp4' ? 'mp4' : 'gif'}`, size: 0, content_type: g.type, width: g.width, height: g.height, alt: g.title, gif: true };
}

/** A sent GIF in chat. */
export function GifView({ a }: { a: Attachment }) {
  const ratio = a.width && a.height ? a.width / a.height : 16 / 9;
  const w = Math.min(320, Math.round(260 * ratio));
  return a.content_type.startsWith('video/') ? (
    <video src={a.url} autoPlay loop muted playsInline aria-label={a.alt ?? 'GIF'} className="rounded-ae border border-ae-border" style={{ width: w, aspectRatio: String(ratio) }} />
  ) : (
    <img src={a.url} alt={a.alt ?? 'GIF'} loading="lazy" className="rounded-ae border border-ae-border" style={{ width: w, aspectRatio: String(ratio) }} />
  );
}

export function GifPicker({ onPick, onClose }: { onPick: (g: Gif) => void; onClose: () => void }) {
  const sb = useSupabase();
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  useEscape(onClose);

  const load = async (query: string, offset: number, replace: boolean) => {
    const my = ++seq.current;
    setLoading(true);
    const { data, error: err } = await sb.functions.invoke(`gifs?${new URLSearchParams({ q: query, offset: String(offset) })}`, { method: 'GET' });
    if (my !== seq.current) return;
    setLoading(false);
    if (err) {
      let msg = 'GIF search is unavailable right now.';
      try {
        const body = (await (err as { context?: Response }).context?.json()) as { error?: string } | undefined;
        if (body?.error) msg = body.error;
      } catch {
        /* keep the generic message */
      }
      setError(msg);
      return;
    }
    const res = data as { gifs: Gif[]; next: number | null };
    setError(null);
    setGifs((cur) => (replace ? res.gifs : [...cur, ...res.gifs.filter((g) => !cur.some((c) => c.id === g.id))]));
    setNext(res.next);
  };

  useEffect(() => {
    const t = setTimeout(() => void load(q.trim(), 0, true), q ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && next !== null && !loading && void load(q.trim(), next, false));
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, loading, q]);

  // Two columns, masonry-ish: each GIF goes into the shorter column.
  const cols: Gif[][] = [[], []];
  const heights = [0, 0];
  for (const g of gifs) {
    const i = heights[0]! <= heights[1]! ? 0 : 1;
    cols[i]!.push(g);
    heights[i]! += g.previewHeight / g.previewWidth;
  }

  return (
    <div className="ae-pop absolute right-0 bottom-full z-40 mb-2 flex h-[min(460px,62vh)] w-[min(400px,calc(100vw-16px))] flex-col rounded-ae border border-ae-border bg-ae-elevated shadow-2xl">
      <div className="flex items-center gap-2 border-b border-ae-border p-2">
        <div className="flex flex-1 items-center gap-2 rounded-ae bg-ae-sunken px-2.5">
          <SearchIcon size={15} className="text-ae-muted" />
          <input className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search GIFs" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
      </div>
      <div className="ae-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {error ? (
          <p className="grid h-full place-items-center p-6 text-center text-sm text-ae-muted">{error}</p>
        ) : (
          <>
            {!q && <p className="px-1 pb-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Trending</p>}
            <div className="flex gap-1.5">
              {cols.map((col, i) => (
                <div key={i} className="flex flex-1 flex-col gap-1.5">
                  {col.map((g) => (
                    <button key={g.id} type="button" title={g.title} onClick={() => onPick(g)} className="ae-press overflow-hidden rounded-md bg-ae-sunken hover:ring-2 hover:ring-ae-accent">
                      <img src={g.preview} alt={g.title} loading="lazy" className="block w-full" style={{ aspectRatio: `${g.previewWidth} / ${g.previewHeight}` }} />
                    </button>
                  ))}
                </div>
              ))}
            </div>
            {!loading && gifs.length === 0 && <p className="p-6 text-center text-sm text-ae-muted">No GIFs found.</p>}
            <div ref={sentinel} className="h-6" />
            {loading && <p className="p-2 text-center text-xs text-ae-muted">Loading…</p>}
          </>
        )}
      </div>
      <p className="border-t border-ae-border px-3 py-1.5 text-right text-[10px] font-bold tracking-wider text-ae-muted uppercase">Powered by GIPHY</p>
    </div>
  );
}
