/**
 * Admin panel additions (1.9.3): activity over time, custom badges, and every server.
 * Every action is an RPC that checks is_app_admin() on the server and writes the admin audit log.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { BADGE_ICONS, BadgeGlyph, badgeSlug, useBadges, type Badge } from '../lib/badges';
import { useSupabase } from '../lib/supabase';
import { ask, promptText } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { SearchIcon, TrashIcon, UploadIcon } from './icons';
import { toast } from './Toaster';

const btn = 'rounded-ae px-3 py-1.5 text-sm font-semibold';

// ── Activity ─────────────────────────────────────────────────────────────────────────────

interface Day {
  day: string;
  signups: number;
  messages: number;
  active_users: number;
}

function Bars({ days, pick, color, label }: { days: Day[]; pick: (d: Day) => number; color: string; label: string }) {
  const max = Math.max(1, ...days.map(pick));
  const total = days.reduce((n, d) => n + pick(d), 0);
  const [hover, setHover] = useState<Day | null>(null);
  return (
    <div className="rounded-ae border border-ae-border bg-ae-surface/30 p-3">
      <div className="mb-2 flex items-baseline justify-between text-xs">
        <span className="font-semibold">{label}</span>
        <span className="text-ae-muted">
          {hover ? `${new Date(hover.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${pick(hover).toLocaleString()}` : `${total.toLocaleString()} in ${days.length} days`}
        </span>
      </div>
      <div className="flex h-20 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        {days.map((d) => (
          <div
            key={d.day}
            onMouseEnter={() => setHover(d)}
            className="min-w-0 flex-1 rounded-t-sm transition-opacity"
            style={{ height: `${Math.max(2, (pick(d) / max) * 100)}%`, background: color, opacity: hover && hover !== d ? 0.45 : 0.9 }}
          />
        ))}
      </div>
    </div>
  );
}

export function ActivityCharts() {
  const sb = useSupabase();
  const [days, setDays] = useState(30);
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'activity', days],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows, error } = await sb.rpc('admin_activity', { p_days: days });
      if (error) throw new Error(error.message);
      return rows as Day[];
    },
  });
  return (
    <div className="space-y-2">
      <div className="flex gap-1 text-xs">
        {[7, 30, 90].map((n) => (
          <button key={n} type="button" onClick={() => setDays(n)} className={`rounded-full px-2.5 py-1 font-semibold ${days === n ? 'bg-ae-accent text-ae-on-accent' : 'bg-ae-surface text-ae-muted hover:text-ae-text'}`}>
            {n} days
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="ae-skeleton h-28" />
      ) : (
        <div className="grid gap-2 md:grid-cols-3">
          <Bars days={data} pick={(d) => d.active_users} color="var(--ae-accent)" label="People chatting" />
          <Bars days={data} pick={(d) => d.messages} color="#00d4ff" label="Messages" />
          <Bars days={data} pick={(d) => d.signups} color="#7bd88f" label="New accounts" />
        </div>
      )}
    </div>
  );
}

// ── Badges ───────────────────────────────────────────────────────────────────────────────

function BadgeEditor({ initial, onClose }: { initial: Badge | null; onClose: () => void }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [b, setB] = useState<Badge>(initial ?? { id: '', label: '', description: '', color: '#7c5cff', icon: 'star', icon_url: null, position: 0 });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const icons = Object.keys(BADGE_ICONS).filter((k) => k.includes(filter.toLowerCase()));

  const upload = async (file: File) => {
    if (!/^image\/(png|webp|gif|svg\+xml|jpeg)$/.test(file.type)) return toast.error('Use a PNG, WebP, GIF, SVG or JPEG image.');
    if (file.size > 256 * 1024) return toast.error('Badge images can be up to 256 KB.');
    setBusy(true);
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.name.split('.').pop() ?? 'png'}`;
    const up = await sb.storage.from('badges').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
    setBusy(false);
    if (up.error) return toast.error(up.error.message);
    setB((x) => ({ ...x, icon_url: sb.storage.from('badges').getPublicUrl(path).data.publicUrl, icon: null }));
  };

  const save = async () => {
    if (!b.label.trim()) return toast.error('Give the badge a name.');
    setBusy(true);
    const id = initial?.id ?? badgeSlug(b.label);
    const { error } = await sb.rpc('admin_save_badge', {
      p_id: id,
      p_label: b.label,
      p_description: b.description ?? '',
      p_color: b.color,
      p_icon: b.icon_url ? '' : (b.icon ?? 'star'),
      p_icon_url: b.icon_url ?? '',
      p_position: initial ? initial.position : null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(initial ? 'Badge saved.' : `Badge “${b.label}” made. Give it to people from the Users tab.`);
    void qc.invalidateQueries({ queryKey: ['badges'] });
    onClose();
  };

  return (
    <Dialog wide title={initial ? `Edit “${initial.label}”` : 'New badge'} onClose={onClose}>
      <div className="flex items-center gap-4">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-ae-sunken" style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${b.color} 45%, transparent)` }}>
          <BadgeGlyph badge={b} size={38} />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <input className="ae-input w-full" placeholder="Badge name" maxLength={40} value={b.label} onChange={(e) => setB({ ...b, label: e.target.value })} />
          <input className="ae-input w-full text-sm" placeholder="What it means (optional, shown on hover)" maxLength={120} value={b.description ?? ''} onChange={(e) => setB({ ...b, description: e.target.value })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        Color <input type="color" value={b.color} onChange={(e) => setB({ ...b, color: e.target.value })} className="h-8 w-12 cursor-pointer rounded border border-ae-border bg-transparent" />
        <code className="text-xs text-ae-muted">{b.color}</code>
      </label>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Icon</p>
          <label className={`${btn} flex cursor-pointer items-center gap-1.5 border border-ae-border hover:bg-ae-hover ${busy ? 'opacity-50' : ''}`}>
            <UploadIcon size={14} /> Upload image
            <input type="file" accept="image/png,image/webp,image/gif,image/svg+xml,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </label>
        </div>
        {b.icon_url && (
          <p className="flex items-center gap-2 text-xs text-ae-muted">
            Using an uploaded image.
            <button type="button" className="text-ae-accent hover:underline" onClick={() => setB({ ...b, icon_url: null, icon: b.icon ?? 'star' })}>
              Use an icon instead
            </button>
          </p>
        )}
        <input className="ae-input w-full text-sm" placeholder="Search icons" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="ae-scroll grid max-h-48 grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1 overflow-y-auto">
          {icons.map((k) => {
            const Icon = BADGE_ICONS[k]!;
            const on = !b.icon_url && b.icon === k;
            return (
              <button
                key={k}
                type="button"
                data-tip={k}
                onClick={() => setB({ ...b, icon: k, icon_url: null })}
                className={`grid h-10 place-items-center rounded-ae border ${on ? 'border-ae-accent bg-ae-accent/15' : 'border-transparent hover:bg-ae-hover'}`}
              >
                <Icon size={20} style={{ color: on ? b.color : undefined }} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={`${btn} hover:bg-ae-hover`} onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={busy} className={`${btn} bg-ae-accent text-ae-on-accent disabled:opacity-50`} onClick={() => void save()}>
          {initial ? 'Save badge' : 'Make badge'}
        </button>
      </div>
    </Dialog>
  );
}

function Holders({ badge }: { badge: Badge }) {
  const sb = useSupabase();
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'badge-holders', badge.id],
    queryFn: async () => {
      const { data: rows, error } = await sb.rpc('admin_badge_holders', { p_id: badge.id });
      if (error) throw new Error(error.message);
      return rows as { id: string; username: string; display_name: string | null }[];
    },
  });
  if (isLoading) return <p className="text-xs text-ae-muted">Loading…</p>;
  if (!data.length) return <p className="text-xs text-ae-muted">Nobody has this badge yet. Give it from the Users tab.</p>;
  return <p className="text-xs text-ae-muted">{data.map((u) => `@${u.username}`).join(', ')}</p>;
}

export function BadgesAdmin() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const { list, isLoading } = useBadges();
  const [editing, setEditing] = useState<Badge | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <button type="button" className={`${btn} bg-ae-accent text-ae-on-accent`} onClick={() => setEditing('new')}>
        New badge
      </button>
      {isLoading && <div className="ae-skeleton h-24" />}
      <ul className="space-y-1.5">
        {list.map((b) => (
          <li key={b.id} className="rounded-ae border border-ae-border bg-ae-surface/30 p-2.5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-ae-sunken" style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${b.color} 40%, transparent)` }}>
                <BadgeGlyph badge={b} size={22} />
              </span>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === b.id ? null : b.id)}>
                <p className="truncate text-sm font-semibold">{b.label}</p>
                <p className="truncate text-xs text-ae-muted">{b.description || <i>No description</i>}</p>
              </button>
              <button type="button" className="rounded-ae px-2.5 py-1.5 text-xs hover:bg-ae-hover" onClick={() => setOpen(open === b.id ? null : b.id)}>
                Who has it
              </button>
              <button type="button" className="rounded-ae px-2.5 py-1.5 text-xs hover:bg-ae-hover" onClick={() => setEditing(b)}>
                Edit
              </button>
              <button
                type="button"
                aria-label={`Delete ${b.label}`}
                className="rounded-ae p-1.5 text-ae-muted hover:bg-ae-danger/15 hover:text-ae-danger"
                onClick={async () => {
                  if (!(await ask(`Delete the “${b.label}” badge? Everyone who has it loses it. This can’t be undone.`, { title: 'Delete badge', confirmLabel: 'Delete', danger: true }))) return;
                  const { data, error } = await sb.rpc('admin_delete_badge', { p_id: b.id });
                  if (error) return toast.error(error.message);
                  toast(`Deleted. Taken off ${data as number} ${data === 1 ? 'person' : 'people'}.`);
                  void qc.invalidateQueries({ queryKey: ['badges'] });
                }}
              >
                <TrashIcon size={15} />
              </button>
            </div>
            {open === b.id && (
              <div className="mt-2 border-t border-ae-border pt-2">
                <Holders badge={b} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing && <BadgeEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** In a user's row: switch badges on and off (each click saves). */
export function BadgeToggles({ userId, current, onChanged }: { userId: string; current: string[]; onChanged: () => void }) {
  const sb = useSupabase();
  const { list } = useBadges();
  const [mine, setMine] = useState(current);
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((b) => {
        const on = mine.includes(b.id);
        return (
          <button
            key={b.id}
            type="button"
            onClick={async () => {
              const { error } = await sb.rpc('admin_toggle_badge', { p_user_id: userId, p_id: b.id, p_on: !on });
              if (error) return toast.error(error.message);
              setMine((cur) => (on ? cur.filter((x) => x !== b.id) : [...cur, b.id]));
              onChanged();
            }}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? 'border-transparent' : 'border-ae-border text-ae-muted hover:text-ae-text'}`}
            style={on ? { background: `color-mix(in srgb, ${b.color} 22%, transparent)`, color: b.color } : undefined}
          >
            <BadgeGlyph badge={b} size={13} /> {b.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Servers ──────────────────────────────────────────────────────────────────────────────

interface ServerRow {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string | null;
  owner_username: string | null;
  members: number;
  messages_7d: number;
  discoverable: boolean;
  created_at: string;
}

export function ServersAdmin() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'servers', query],
    queryFn: async () => {
      const { data: rows, error } = await sb.rpc('admin_list_servers', { p_query: query, p_limit: 200 });
      if (error) throw new Error(error.message);
      return rows as ServerRow[];
    },
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'servers'] });
  const totals = useMemo(() => ({ members: data.reduce((n, s) => n + s.members, 0), msgs: data.reduce((n, s) => n + s.messages_7d, 0) }), [data]);
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <div className="relative flex-1">
          <SearchIcon size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-ae-muted" />
          <input className="ae-input w-full pl-8 text-sm" placeholder="Server name, owner username or server ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="submit" className={`${btn} bg-ae-surface hover:bg-ae-hover`}>
          Search
        </button>
      </form>
      {!isLoading && (
        <p className="text-xs text-ae-muted">
          {data.length} server{data.length === 1 ? '' : 's'} · {totals.members.toLocaleString()} memberships · {totals.msgs.toLocaleString()} messages this week
        </p>
      )}
      {isLoading && <div className="ae-skeleton h-24" />}
      <ul className="space-y-1.5">
        {data.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-ae border border-ae-border bg-ae-surface/30 p-2.5">
            {s.icon_url ? <img src={s.icon_url} alt="" className="h-9 w-9 rounded-xl object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-xl bg-ae-sunken font-bold">{s.name[0]?.toUpperCase()}</span>}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-sm font-semibold">
                {s.name}
                {s.discoverable && <span className="rounded bg-ae-accent/20 px-1.5 text-[10px] font-bold text-ae-accent uppercase">On Discover</span>}
              </p>
              <p className="truncate text-xs text-ae-muted">
                owner @{s.owner_username ?? '?'} · {s.members} member{s.members === 1 ? '' : 's'} · {s.messages_7d.toLocaleString()} messages this week · made {new Date(s.created_at).toLocaleDateString()}
              </p>
            </div>
            <button type="button" className="rounded-ae px-2.5 py-1.5 text-xs hover:bg-ae-hover" onClick={() => void navigator.clipboard.writeText(s.id).then(() => toast('Server ID copied'))}>
              Copy ID
            </button>
            {s.discoverable && (
              <button
                type="button"
                className="rounded-ae px-2.5 py-1.5 text-xs hover:bg-ae-hover"
                onClick={async () => {
                  const { error } = await sb.rpc('admin_set_server_discoverable', { p_server_id: s.id, p_on: false });
                  if (error) return toast.error(error.message);
                  toast(`${s.name} is off Discover.`);
                  refresh();
                }}
              >
                Hide from Discover
              </button>
            )}
            <button
              type="button"
              aria-label={`Delete ${s.name}`}
              className="rounded-ae p-1.5 text-ae-muted hover:bg-ae-danger/15 hover:text-ae-danger"
              onClick={async () => {
                const reason = await promptText(`Why are you deleting “${s.name}”? This is kept in the admin audit log.`, { title: 'Delete server', placeholder: 'e.g. spam server, illegal content' });
                if (!reason?.trim()) return;
                if (!(await ask(`Delete “${s.name}” and everything in it (${s.members} members)? This can’t be undone.`, { title: 'Delete server', confirmLabel: 'Delete server', danger: true }))) return;
                const { error } = await sb.rpc('admin_delete_server', { p_server_id: s.id, p_reason: reason });
                if (error) return toast.error(error.message);
                toast(`${s.name} was deleted.`);
                refresh();
              }}
            >
              <TrashIcon size={15} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
