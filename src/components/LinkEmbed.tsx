/** Rich link previews (via the link-preview Edge Function) and click-to-play YouTube embeds. */
import { useState } from 'react';
import { useLinkPreview } from '../hooks/useMessageExtras';
import { youtubeId } from '../lib/messageLinks';
import { openExternal } from '../lib/platform';
import { PlayIcon } from './icons';

function YouTubeEmbed({ id, url }: { id: string; url: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="mt-1 w-full max-w-md overflow-hidden rounded-ae border-l-4 border-l-[#ff0000] bg-ae-sunken">
      <button type="button" className="block px-3 pt-2 text-xs text-ae-muted hover:underline" onClick={() => void openExternal(url)}>
        YouTube
      </button>
      <div className="p-3 pt-1">
        {playing ? (
          <iframe
            className="aspect-video w-full rounded"
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`}
            title="YouTube video"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <button type="button" className="group relative block w-full" onClick={() => setPlaying(true)} aria-label="Play video">
            <img src={`https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`} alt="" className="aspect-video w-full rounded object-cover" loading="lazy" />
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-black/70 text-white group-hover:bg-[#ff0000]">
                <PlayIcon size={24} />
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function OpenGraphEmbed({ url }: { url: string }) {
  const { data } = useLinkPreview(url);
  if (!data || (!data.title && !data.description)) return null;
  const bigImage = data.image && !data.description;
  return (
    <div
      className="mt-1 flex w-full max-w-md gap-3 overflow-hidden rounded-ae border-l-4 bg-ae-sunken p-3"
      style={{ borderLeftColor: data.color ?? 'var(--ae-border)' }}
    >
      <div className="min-w-0 flex-1 space-y-1">
        {data.siteName && <p className="truncate text-xs text-ae-muted">{data.siteName}</p>}
        {data.title && (
          <button type="button" className="block text-left text-sm font-semibold text-ae-accent hover:underline" onClick={() => void openExternal(data.url || url)}>
            {data.title}
          </button>
        )}
        {data.description && <p className="line-clamp-3 text-xs text-ae-muted">{data.description}</p>}
        {bigImage && <img src={data.image!} alt="" loading="lazy" className="mt-2 max-h-72 w-full rounded object-cover" />}
      </div>
      {data.image && !bigImage && <img src={data.image} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded object-cover" />}
    </div>
  );
}

export function LinkEmbed({ url }: { url: string }) {
  const yt = youtubeId(url);
  return yt ? <YouTubeEmbed id={yt} url={url} /> : <OpenGraphEmbed url={url} />;
}
