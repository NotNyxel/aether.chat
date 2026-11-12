/**
 * Real artwork for activities: game art from Steam (via the game-art Edge Function), brand logos
 * from Simple Icons (CC0) for games that aren't on Steam, and album covers for Spotify tracks from
 * Apple's public search API (no key needed). Everything is cached.
 */
import { useQuery } from '@tanstack/react-query';
import { siDota2, siFortnite, siLeagueoflegends, siPubg, siRiotgames, siRoblox, siSpotify, siSteam, siValorant, siCounterstrike, siEpicgames } from 'simple-icons';
import { useSupabase } from './supabase';
import { GameIcon, MusicIcon } from '../components/icons';

interface SimpleIcon {
  path: string;
  hex: string;
  title: string;
}

/** Brand marks for games that Steam doesn't sell (or that read better as a logo). */
const BRANDS: Record<string, SimpleIcon> = {
  valorant: siValorant,
  'league of legends': siLeagueoflegends,
  fortnite: siFortnite,
  roblox: siRoblox,
  'counter-strike 2': siCounterstrike,
  'dota 2': siDota2,
  'pubg: battlegrounds': siPubg,
  'teamfight tactics': siRiotgames,
  'legends of runeterra': siRiotgames,
  'rocket league': siEpicgames,
};

export function BrandMark({ icon, size = 20, color }: { icon: SimpleIcon; size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={icon.title} fill={color ?? `#${icon.hex}`}>
      <path d={icon.path} />
    </svg>
  );
}

export function SpotifyMark({ size = 16 }: { size?: number }) {
  return <BrandMark icon={siSpotify} size={size} />;
}
export function SteamMark({ size = 16 }: { size?: number }) {
  return <BrandMark icon={siSteam} size={size} color="currentColor" />;
}

interface GameArt {
  name: string;
  appid: number;
  header: string;
  capsule: string;
  icon: string;
}

export function useGameArt(name: string | null | undefined) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['game-art', name?.toLowerCase()],
    enabled: !!name,
    staleTime: Infinity,
    gcTime: 24 * 3600_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await sb.functions.invoke(`game-art?name=${encodeURIComponent(name!)}`, { method: 'GET' });
      if (error) return null;
      return (data as GameArt | null) ?? null;
    },
  });
}

/** Square game artwork: brand logo, Steam art, or a controller icon. */
export function GameArtIcon({ name, size = 40, rounded = 'rounded-lg' }: { name: string; size?: number; rounded?: string }) {
  const brand = BRANDS[name.toLowerCase()];
  const { data: art } = useGameArt(brand ? null : name);
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden bg-ae-surface ${rounded}`} style={{ width: size, height: size }}>
      {brand ? (
        <span className="grid h-full w-full place-items-center" style={{ background: `#${brand.hex}22` }}>
          <BrandMark icon={brand} size={size * 0.6} />
        </span>
      ) : art ? (
        <img src={art.header} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <GameIcon size={size * 0.55} className="text-ae-muted" />
      )}
    </span>
  );
}

/** Wide banner art (Steam header) for profile widgets. */
export function GameBanner({ name, className = '' }: { name: string; className?: string }) {
  const brand = BRANDS[name.toLowerCase()];
  const { data: art } = useGameArt(brand ? null : name);
  if (art) return <img src={art.header} alt="" className={`object-cover ${className}`} draggable={false} />;
  return (
    <div className={`grid place-items-center ${className}`} style={{ background: brand ? `linear-gradient(135deg, #${brand.hex}55, #0006)` : 'var(--ae-surface)' }}>
      {brand ? <BrandMark icon={brand} size={40} /> : <GameIcon size={36} className="text-ae-muted" />}
    </div>
  );
}

export function useAlbumArt(title: string | null | undefined, artist: string | null | undefined) {
  return useQuery({
    queryKey: ['album-art', title, artist],
    enabled: !!title,
    staleTime: Infinity,
    gcTime: 24 * 3600_000,
    retry: false,
    queryFn: async () => {
      const term = `${artist ?? ''} ${title ?? ''}`.trim();
      const res = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=1&term=${encodeURIComponent(term)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { results?: { artworkUrl100?: string; trackViewUrl?: string }[] };
      const art = data.results?.[0]?.artworkUrl100;
      return art ? art.replace('100x100bb', '300x300bb') : null;
    },
  });
}

export function AlbumArt({ title, artist, size = 56 }: { title: string; artist: string; size?: number }) {
  const { data: url } = useAlbumArt(title, artist);
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-md bg-ae-surface" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" draggable={false} /> : <MusicIcon size={size * 0.45} className="text-ae-muted" />}
    </span>
  );
}
