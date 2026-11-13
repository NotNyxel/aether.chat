/**
 * GIFs (GIPHY): Favorites and Trending up top (the Favorites button shows one of your saved GIFs),
 * search as you type, infinite scroll, and a star on every GIF to save it. Picking one sends it.
 * Sent GIFs play on a loop without sound.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSupabase } from '../lib/supabase';
import type { Attachment } from '../types/db';
import { SearchIcon, StarIcon } from './icons';
import { toast } from './Toaster';

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

interface FavoriteRow {
  url: string;
  preview: string;
  type: string;
  width: number;
  height: number;
  title: string;
}

export function gifAttachment(g: Gif): Attachment {
  return { url: g.url, name: `${g.title.slice(0, 60) || 'GIF'}.${g.type === 'video/mp4' ? 'mp4' : 'gif'}`, size: 0, content_type: g.type, width: g.width, height: g.height, alt: g.title, gif: true };
}

const fromFavorite = (f: FavoriteRow): Gif => ({ id: f.url, title: f.title, url: f.url, type: f.type, width: f.width, height: f.height, preview: f.preview, previewWidth: f.width, previewHeight: f.height });

export function useGifFavorites() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['gif-favorites'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('gif_favorites').select('url, preview, type, width, height, title').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data as FavoriteRow[];
    },
  });
  const urls = useMemo(() => new Set((query.data ?? []).map((f) => f.url)), [query.data]);
  const add = async (g: Pick<Gif, 'url' | 'preview' | 'type' | 'width' | 'height' | 'title'>) => {
    const row = { url: g.url, preview: g.preview, type: g.type, width: Math.round(g.width), height: Math.round(g.height), title: g.title.slice(0, 120) || 'GIF' };
    qc.setQueryData<FavoriteRow[]>(['gif-favorites'], (d) => [row, ...(d ?? []).filter((x) => x.url !== row.url)]);
    const { error } = await sb.from('gif_favorites').upsert(row, { onConflict: 'user_id,url', ignoreDuplicates: true });
    if (error) {
      toast.error(error.message);
      void qc.invalidateQueries({ queryKey: ['gif-favorites'] });
    }
  };
  const remove = async (url: string) => {
    qc.setQueryData<FavoriteRow[]>(['gif-favorites'], (d) => (d ?? []).filter((x) => x.url !== url));
    await sb.from('gif_favorites').delete().eq('url', url);
  };
  return { favorites: query.data ?? [], urls, add, remove, toggle: (g: Gif) => (urls.has(g.url) ? remove(g.url) : add(g)) };
}

/** A sent GIF in chat. */
export function GifView({ a }: { a: Attachment }) {
  const ratio = a.width && a.height ? a.width / a.height : 16 / 9;
  const w = Math.min(320, Math.round(260 * ratio));
  return a.content_type.startsWith('video/') ? (
    <video src={a.url} autoPlay loop muted playsInline aria-label={a.alt ?? 'GIF'} className="max-w-full rounded-ae border border-ae-border" style={{ width: w, aspectRatio: String(ratio) }} />
  ) : (
    <img src={a.url} alt={a.alt ?? 'GIF'} loading="lazy" className="max-w-full rounded-ae border border-ae-border" style={{ width: w, aspectRatio: String(ratio) }} />
  );
}

/** The GIFs tab of the expressions menu. */
export function GifPanel({ onPick }: { onPick: (g: Gif) => void }) {
  const sb = useSupabase();
  const fav = useGifFavorites();
  const [q, setQ] = useState('');
  const [view, setView] = useState<'trending' | 'favorites'>('trending');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  // The Favorites button shows one of your favourites, picked once per opening.
  const [cover] = useState(() => Math.random());
  const coverGif = fav.favorites.length ? fav.favorites[Math.floor(cover * fav.favorites.length)] : null;

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
    if (view === 'favorites' && !q) return;
    const t = setTimeout(() => void load(q.trim(), 0, true), q ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, view]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || (view === 'favorites' && !q)) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && next !== null && !loading && void load(q.trim(), next, false));
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, loading, q, view]);

  const showing = view === 'favorites' && !q ? fav.favorites.map(fromFavorite) : gifs;
  // Two columns, masonry-ish: each GIF goes into the shorter column.
  const cols: Gif[][] = [[], []];
  const heights = [0, 0];
  for (const g of showing) {
    const i = heights[0]! <= heights[1]! ? 0 : 1;
    cols[i]!.push(g);
    heights[i]! += g.previewHeight / Math.max(1, g.previewWidth);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-ae-border p-2">
        <div className="flex items-center gap-2 rounded-ae bg-ae-sunken px-2.5">
          <SearchIcon size={15} className="text-ae-muted" />
          <input className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search GIPHY" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!q && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setView('favorites')}
              className={`relative h-14 overflow-hidden rounded-ae text-sm font-bold text-white ${view === 'favorites' ? 'ring-2 ring-ae-accent' : ''}`}
              style={{ background: coverGif ? `center / cover no-repeat url("${coverGif.preview}")` : 'linear-gradient(135deg, #f5b942, #ff5c6c)' }}
            >
              <span className="absolute inset-0 bg-black/45" />
              <span className="relative flex items-center justify-center gap-1.5">
                <StarIcon size={15} className="fill-current" /> Favorites{fav.favorites.length ? ` (${fav.favorites.length})` : ''}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setView('trending')}
              className={`relative h-14 overflow-hidden rounded-ae text-sm font-bold text-white ${view === 'trending' ? 'ring-2 ring-ae-accent' : ''}`}
              style={{ background: gifs[0] && view === 'trending' ? `center / cover no-repeat url("${gifs[0].preview}")` : 'linear-gradient(135deg, #7c5cff, #00d4ff)' }}
            >
              <span className="absolute inset-0 bg-black/45" />
              <span className="relative">Trending</span>
            </button>
          </div>
        )}
      </div>
      <div className="ae-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2">
        {error && view === 'trending' ? (
          <p className="grid h-full place-items-center p-6 text-center text-sm text-ae-muted">{error}</p>
        ) : (
          <>
            <div className="flex gap-1.5">
              {cols.map((col, i) => (
                <div key={i} className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {col.map((g) => (
                    <div key={g.id} className="group relative overflow-hidden rounded-md bg-ae-sunken">
                      <button type="button" title={g.title} onClick={() => onPick(g)} className="block w-full hover:brightness-110">
                        <img src={g.preview} alt={g.title} loading="lazy" className="block w-full" style={{ aspectRatio: `${g.previewWidth} / ${g.previewHeight}` }} />
                      </button>
                      <button
                        type="button"
                        aria-label={fav.urls.has(g.url) ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={() => void fav.toggle(g)}
                        className={`absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white transition-opacity ${fav.urls.has(g.url) ? 'text-[#f5b942] opacity-100' : 'opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100'}`}
                      >
                        <StarIcon size={14} className={fav.urls.has(g.url) ? 'fill-current' : ''} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {!loading && showing.length === 0 && (
              <p className="p-6 text-center text-sm text-ae-muted">
                {view === 'favorites' && !q ? 'No favorites yet. Tap the star on a GIF, or open a picture in chat and choose “Save as GIF”.' : 'No GIFs found.'}
              </p>
            )}
            <div ref={sentinel} className="h-6" />
            {loading && <p className="p-2 text-center text-xs text-ae-muted">Loading…</p>}
          </>
        )}
      </div>
      <p className="border-t border-ae-border px-3 py-1.5 text-right text-[10px] font-bold tracking-wider text-ae-muted uppercase">Powered by GIPHY</p>
    </div>
  );
}
