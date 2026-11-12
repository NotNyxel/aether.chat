/**
 * Settings → Admin (only for accounts with users.is_admin). Every action is an RPC that re-checks
 * is_app_admin() on the server, so hiding the tab is a convenience, not the security boundary.
 * Admins can also be granted straight in Supabase: `update public.users set is_admin = true where username = '…'`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useSupabase } from '../lib/supabase';
import { ask } from './ConfirmDialog';
import { AdminIcon, CheckIcon, CloseIcon, DashboardIcon, FlagIcon, MegaphoneIcon, MessageIcon, ReportsIcon, SearchIcon, ServerIcon, SlidersIcon, UsersIcon, LiveIcon, UserPlusIcon } from './icons';
import { BADGE_CATALOG, BadgeRow } from './ProfileCard';
import { Section, Toggle } from './SettingsPanel';
import { toast } from './Toaster';

interface Stats {
  users: number;
  users_7d: number;
  servers: number;
  messages: number;
  messages_24h: number;
  voice_now: number;
  open_reports: number;
  admins: number;
}
interface AdminUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  is_admin: boolean;
  badge_ids: string[];
  created_at: string;
  last_sign_in_at: string | null;
  servers: number;
  messages: number;
}
interface ReportRow {
  id: string;
  reporter_id: string | null;
  server_id: string | null;
  target_user_id: string | null;
  reason: string;
  details: string | null;
  snapshot: { content?: string; author?: string } | null;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
}

function rpcError(e: { message: string } | null) {
  if (e) throw new Error(e.message);
}

function Stat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: number | undefined; sub?: string }) {
  return (
    <div className="rounded-ae border border-ae-border bg-ae-surface/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value === undefined ? '…' : value.toLocaleString()}</p>
      {sub && <p className="text-xs text-ae-muted">{sub}</p>}
    </div>
  );
}

function Overview() {
  const sb = useSupabase();
  const { data: s } = useQuery({
    queryKey: ['admin', 'stats'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc('admin_stats');
      rpcError(error);
      return data as Stats;
    },
  });
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      <Stat icon={<UsersIcon size={12} />} label="Users" value={s?.users} sub={s ? `+${s.users_7d} this week` : undefined} />
      <Stat icon={<ServerIcon size={12} />} label="Servers" value={s?.servers} />
      <Stat icon={<MessageIcon size={12} />} label="Messages" value={s?.messages} sub={s ? `${s.messages_24h.toLocaleString()} in 24 h` : undefined} />
      <Stat icon={<LiveIcon size={12} />} label="In voice now" value={s?.voice_now} />
      <Stat icon={<FlagIcon size={12} />} label="Open reports" value={s?.open_reports} />
      <Stat icon={<AdminIcon size={12} />} label="Admins" value={s?.admins} />
    </div>
  );
}

function UserRow({ u, me, onChanged }: { u: AdminUser; me: string; onChanged: () => void }) {
  const sb = useSupabase();
  const [editing, setEditing] = useState(false);
  const [badges, setBadges] = useState<string[]>(u.badge_ids ?? []);
  const date = (d: string | null) => (d ? new Date(d).toLocaleDateString() : 'never');

  const setAdmin = async (on: boolean) => {
    if (!(await ask(on ? `Make @${u.username} an admin? They'll see this panel and can change app settings.` : `Remove @${u.username}'s admin access?`, { danger: !on, confirmLabel: on ? 'Make admin' : 'Remove' })))
      return;
    const { error } = await sb.rpc('admin_set_admin', { p_user_id: u.id, p_admin: on });
    if (error) return toast.error(error.message);
    toast.success(on ? `@${u.username} is now an admin.` : `@${u.username} is no longer an admin.`);
    onChanged();
  };
  const saveBadges = async () => {
    const { error } = await sb.rpc('admin_set_badges', { p_user_id: u.id, p_badges: badges });
    if (error) return toast.error(error.message);
    toast.success('Badges saved.');
    setEditing(false);
    onChanged();
  };

  return (
    <li className="rounded-ae border border-ae-border bg-ae-surface/30 p-3">
      <div className="flex items-center gap-3">
        {u.avatar_url ? <img src={u.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-full bg-ae-sunken font-bold">{u.username[0]?.toUpperCase()}</span>}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-semibold">
            {u.display_name || u.username} <span className="font-normal text-ae-muted">@{u.username}</span>
            {u.is_admin && <span className="rounded bg-ae-accent/20 px-1.5 text-[10px] font-bold text-ae-accent uppercase">Admin</span>}
          </p>
          <p className="truncate text-xs text-ae-muted">
            {u.email ?? 'no email'} · joined {date(u.created_at)} · last sign-in {date(u.last_sign_in_at)} · {u.servers} servers · {u.messages.toLocaleString()} messages
          </p>
        </div>
        <BadgeRow badgeIds={u.badge_ids ?? []} size={22} />
        <button type="button" className="rounded-ae px-2.5 py-1.5 text-xs hover:bg-ae-hover" onClick={() => setEditing((v) => !v)}>
          Badges
        </button>
        {u.id !== me && (
          <button type="button" className={`rounded-ae px-2.5 py-1.5 text-xs hover:bg-ae-hover ${u.is_admin ? 'text-ae-danger' : 'text-ae-accent'}`} onClick={() => void setAdmin(!u.is_admin)}>
            {u.is_admin ? 'Remove admin' : 'Make admin'}
          </button>
        )}
        <button type="button" className="rounded-ae px-2.5 py-1.5 text-xs hover:bg-ae-hover" data-tip="Copy user ID" onClick={() => void navigator.clipboard.writeText(u.id).then(() => toast.success('User ID copied.'))}>
          ID
        </button>
      </div>
      {editing && (
        <div className="ae-enter mt-3 space-y-2 border-t border-ae-border pt-3">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(BADGE_CATALOG).map(([id, b]) => {
              const on = badges.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBadges((cur) => (on ? cur.filter((x) => x !== id) : [...cur, id]))}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? 'border-transparent' : 'border-ae-border text-ae-muted hover:text-ae-text'}`}
                  style={on ? { background: `color-mix(in srgb, ${b.color} 22%, transparent)`, color: b.color } : undefined}
                >
                  <b.Icon size={13} /> {b.label}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-ae px-3 py-1.5 text-sm hover:bg-ae-hover" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="ae-press rounded-ae bg-ae-accent px-4 py-1.5 text-sm font-semibold text-ae-on-accent" onClick={() => void saveBadges()}>
              Save badges
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Users({ me }: { me: string }) {
  const sb = useSupabase();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const { data = [], isFetching, refetch } = useQuery({
    queryKey: ['admin', 'users', term],
    queryFn: async () => {
      const { data, error } = await sb.rpc('admin_search_users', { p_query: term });
      rpcError(error);
      return data as AdminUser[];
    },
  });
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(q.trim());
        }}
      >
        <div className="relative flex-1">
          <SearchIcon size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-ae-muted" />
          <input className="ae-input w-full !pl-9" placeholder="Username, display name, email or user ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="submit" className="ae-press rounded-ae bg-ae-accent px-4 text-sm font-semibold text-ae-on-accent">
          Search
        </button>
      </form>
      {isFetching && data.length === 0 ? (
        <div className="ae-skeleton h-16" />
      ) : data.length === 0 ? (
        <p className="text-sm text-ae-muted">No users found.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.map((u) => (
            <UserRow key={u.id} u={u} me={me} onChanged={() => void refetch()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function useConfig() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['app-config'],
    queryFn: async () => {
      const { data, error } = await sb.from('app_config').select('key, value');
      rpcError(error);
      return Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value])) as Record<string, unknown>;
    },
  });
}

function Config() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const { data: cfg } = useConfig();
  const [limit, setLimit] = useState<string | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const set = async (key: string, value: unknown) => {
    const { error } = await sb.rpc('admin_set_config', { p_key: key, p_value: value });
    if (error) return toast.error(error.message);
    toast.success('Saved.');
    void qc.invalidateQueries({ queryKey: ['app-config'] });
  };
  if (!cfg) return <div className="ae-skeleton h-32" />;
  const limitValue = limit ?? String(cfg.message_request_limit ?? 3);
  const announceValue = announce ?? ((cfg.announcement as string | null) ?? '');
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold">Message request limit</p>
        <p className="mb-2 text-xs text-ae-muted">How many messages someone can send a stranger before the request is accepted.</p>
        <div className="flex gap-2">
          <input type="number" min={1} max={20} className="ae-input !w-24" value={limitValue} onChange={(e) => setLimit(e.target.value)} />
          <button
            type="button"
            className="ae-press rounded-ae bg-ae-surface px-4 text-sm hover:bg-ae-hover"
            onClick={() => {
              const n = Math.round(Number(limitValue));
              if (!(n >= 1 && n <= 20)) return toast.error('Pick a number from 1 to 20.');
              void set('message_request_limit', n);
            }}
          >
            Save
          </button>
        </div>
      </div>
      <Toggle
        label="People search"
        hint="Lets everyone use “Search for someone” in the Friends tab."
        checked={cfg.people_search_enabled !== false}
        onChange={(v) => void set('people_search_enabled', v)}
      />
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <MegaphoneIcon size={14} /> Announcement
        </p>
        <p className="mb-2 text-xs text-ae-muted">Shown as a banner at the top of the app for everyone. Leave empty to hide it.</p>
        <div className="flex gap-2">
          <input className="ae-input w-full" maxLength={200} placeholder="Scheduled maintenance tonight at 22:00 UTC" value={announceValue} onChange={(e) => setAnnounce(e.target.value)} />
          <button type="button" className="ae-press shrink-0 rounded-ae bg-ae-surface px-4 text-sm hover:bg-ae-hover" onClick={() => void set('announcement', announceValue.trim() || null)}>
            {announceValue.trim() ? 'Publish' : 'Clear'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Reports() {
  const sb = useSupabase();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const { data = [], refetch, isLoading } = useQuery({
    queryKey: ['admin', 'reports', filter],
    queryFn: async () => {
      let q = sb.from('reports').select('*').is('server_id', null).order('created_at', { ascending: false }).limit(100);
      if (filter === 'open') q = q.eq('status', 'open');
      const { data, error } = await q;
      rpcError(error);
      return data as ReportRow[];
    },
  });
  const resolve = async (id: string, status: 'resolved' | 'dismissed') => {
    const { error } = await sb.rpc('resolve_report', { p_report_id: id, p_status: status, p_resolution: null });
    if (error) return toast.error(error.message);
    void refetch();
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(['open', 'all'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-ae px-3 py-1.5 text-sm ${filter === f ? 'bg-ae-surface font-semibold' : 'text-ae-muted hover:bg-ae-hover'}`}>
            {f === 'open' ? 'Open' : 'All'}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="ae-skeleton h-16" />
      ) : data.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ae-muted">
          <CheckIcon size={15} /> Nothing to review.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data.map((r) => (
            <li key={r.id} className="rounded-ae border border-ae-border bg-ae-surface/30 p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="rounded bg-ae-danger/20 px-1.5 text-[11px] font-bold text-ae-danger uppercase">{r.reason.replace('_', ' ')}</span>
                <span className="text-xs text-ae-muted">{new Date(r.created_at).toLocaleString()}</span>
                <span className="ml-auto text-xs text-ae-muted capitalize">{r.status}</span>
              </div>
              {r.snapshot?.content && <blockquote className="mt-2 border-l-2 border-ae-border pl-2 text-sm whitespace-pre-wrap">{r.snapshot.content}</blockquote>}
              {r.details && <p className="mt-1 text-xs text-ae-muted">{r.details}</p>}
              <p className="mt-1 font-mono text-[11px] text-ae-muted">target {r.target_user_id ?? '—'} · reporter {r.reporter_id ?? '—'}</p>
              {r.status === 'open' && (
                <div className="mt-2 flex gap-2">
                  <button type="button" className="flex items-center gap-1 rounded-ae bg-ae-success/20 px-3 py-1 text-xs font-semibold text-ae-success" onClick={() => void resolve(r.id, 'resolved')}>
                    <CheckIcon size={13} /> Resolve
                  </button>
                  <button type="button" className="flex items-center gap-1 rounded-ae px-3 py-1 text-xs text-ae-muted hover:bg-ae-hover" onClick={() => void resolve(r.id, 'dismissed')}>
                    <CloseIcon size={13} /> Dismiss
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AdminTab({ userId }: { userId: string }) {
  return (
    <div className="space-y-8">
      <Section title="Overview">
        <Overview />
      </Section>
      <Section title="Users" description="Find anyone, award badges and grant admin access. Admins can also be set in Supabase (users.is_admin).">
        <Users me={userId} />
      </Section>
      <Section title="App settings">
        <Config />
      </Section>
      <Section title="Reports" description="Reports from DMs and message requests. Server reports go to each server's moderators.">
        <Reports />
      </Section>
      <p className="flex items-center gap-1.5 text-xs text-ae-muted">
        <SlidersIcon size={12} /> <DashboardIcon size={12} /> <ReportsIcon size={12} /> <UserPlusIcon size={12} /> Only admins can see this tab.
      </p>
    </div>
  );
}

/** App-wide announcement banner (set by admins). */
export function AnnouncementBar() {
  const { data: cfg } = useConfig();
  const text = typeof cfg?.announcement === 'string' ? cfg.announcement : null;
  const [hidden, setHidden] = useState<string | null>(() => {
    try {
      return localStorage.getItem('aether.announce.hidden');
    } catch {
      return null;
    }
  });
  if (!text || hidden === text) return null;
  return (
    <div className="ae-enter flex items-center gap-2 bg-ae-accent px-4 py-1.5 text-sm font-semibold text-ae-on-accent">
      <MegaphoneIcon size={15} />
      <span className="min-w-0 flex-1 truncate text-center">{text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setHidden(text);
          try {
            localStorage.setItem('aether.announce.hidden', text);
          } catch {
            // ignore
          }
        }}
      >
        <CloseIcon size={15} />
      </button>
    </div>
  );
}
