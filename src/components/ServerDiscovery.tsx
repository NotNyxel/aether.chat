/** Explore public servers (servers.discoverable): search, categories, join in one click. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSupabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import { CompassIcon, SearchIcon, UsersIcon } from './icons';
import { toast } from './Toaster';

export const DISCOVERY_CATEGORIES: { id: string; label: string }[] = [
  { id: 'gaming', label: 'Gaming' },
  { id: 'music', label: 'Music' },
  { id: 'art', label: 'Art' },
  { id: 'tech', label: 'Tech' },
  { id: 'education', label: 'Education' },
  { id: 'anime', label: 'Anime' },
  { id: 'social', label: 'Hangouts' },
  { id: 'science', label: 'Science' },
  { id: 'sports', label: 'Sports' },
  { id: 'other', label: 'Other' },
];

interface Found {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  banner_url: string | null;
  category: string | null;
  member_count: number;
  is_member: boolean;
}

export function ServerDiscovery({ userId, onDone }: { userId: string; onDone: () => void }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const selectServer = useUiStore((s) => s.selectServer);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data = [], isLoading } = useQuery({
    queryKey: ['discover', term, cat],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await sb.rpc('discover_servers', { p_query: term, p_category: cat });
      if (error) throw new Error(error.message);
      return data as Found[];
    },
  });

  const join = async (s: Found) => {
    if (s.is_member) {
      selectServer(s.id);
      return onDone();
    }
    setJoining(s.id);
    const { error } = await sb.rpc('join_discoverable', { p_server_id: s.id });
    setJoining(null);
    if (error) return toast.error(error.message);
    await qc.invalidateQueries({ queryKey: ['servers', userId] });
    selectServer(s.id);
    toast.success(`Welcome to ${s.name}!`);
    onDone();
  };

  return (
    <div className="space-y-3">
      <div className="ae-field">
        <SearchIcon size={15} />
        <input className="ae-input" autoFocus placeholder="Search public servers" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setCat(null)} className={`rounded-full border px-3 py-1 text-xs ${cat === null ? 'border-ae-accent bg-ae-accent/15 font-semibold' : 'border-ae-border text-ae-muted hover:text-ae-text'}`}>
          All
        </button>
        {DISCOVERY_CATEGORIES.map((c) => (
          <button key={c.id} type="button" onClick={() => setCat(c.id)} className={`rounded-full border px-3 py-1 text-xs ${cat === c.id ? 'border-ae-accent bg-ae-accent/15 font-semibold' : 'border-ae-border text-ae-muted hover:text-ae-text'}`}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="ae-scroll grid max-h-[50vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {isLoading && [0, 1, 2, 3].map((i) => <div key={i} className="ae-skeleton h-36 rounded-ae" />)}
        {!isLoading && data.length === 0 && (
          <p className="col-span-full flex flex-col items-center gap-2 py-10 text-center text-sm text-ae-muted">
            <CompassIcon size={30} /> No public servers here yet. Server owners can list theirs in Server Settings → Safety &amp; Welcome.
          </p>
        )}
        {data.map((s) => (
          <div key={s.id} className="overflow-hidden rounded-ae border border-ae-border bg-ae-surface/30">
            <div className="h-14 bg-gradient-to-br from-ae-accent/40 to-ae-surface" style={s.banner_url ? { backgroundImage: `url(${s.banner_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} />
            <div className="px-3 pb-3">
              <div className="-mt-6 mb-1 grid h-12 w-12 place-items-center overflow-hidden rounded-[30%] border-4 border-ae-elevated bg-ae-sunken font-bold">
                {s.icon_url ? <img src={s.icon_url} alt="" className="h-full w-full object-cover" /> : s.name.slice(0, 2).toUpperCase()}
              </div>
              <p className="truncate font-bold">{s.name}</p>
              <p className="line-clamp-2 min-h-8 text-xs text-ae-muted">{s.description || 'No description yet.'}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs text-ae-muted">
                  <UsersIcon size={12} /> {s.member_count.toLocaleString()}
                  {s.category && ` · ${DISCOVERY_CATEGORIES.find((c) => c.id === s.category)?.label ?? ''}`}
                </span>
                <button type="button" disabled={joining === s.id} onClick={() => void join(s)} className={`ae-press rounded-ae px-3 py-1 text-xs font-semibold disabled:opacity-50 ${s.is_member ? 'bg-ae-surface' : 'bg-ae-success text-black'}`}>
                  {s.is_member ? 'Open' : joining === s.id ? 'Joining…' : 'Join'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
