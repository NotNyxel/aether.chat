/**
 * Settings → Admin (only for accounts with users.is_admin). Every action is an RPC that re-checks
 * is_app_admin() on the server, so hiding the tab is a convenience, not the security boundary.
 * Admins can also be granted straight in Supabase: `update public.users set is_admin = true where username = '…'`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { useSupabase } from '../lib/supabase';
import { adminUserCall, AdminUserManager, AuditList } from './AdminUserManager';
import { ask, promptText } from './ConfirmDialog';
import { LevelChip } from './Moderation';
import { AdminIcon, AuditIcon, BannedIcon, CheckIcon, CloseIcon, DashboardIcon, FlagIcon, GavelIcon, MegaphoneIcon, MessageIcon, ReportsIcon, ScaleIcon, SearchIcon, ServerIcon, SlidersIcon, UserPlusIcon, UsersIcon, LiveIcon, WarningIcon } from './icons';
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
  banned: number;
  open_appeals: number;
  active_warnings: number;
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
  banned: boolean;
  level: string;
}
interface AppealRow {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  message: string;
  status: 'open' | 'accepted' | 'denied';
  response: string | null;
  created_at: string;
  ban: { reason: string; created_at: string; expires_at: string | null; lifted_at: string | null };
}
type AdminSection = 'overview' | 'users' | 'appeals' | 'reports' | 'settings' | 'audit';
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

function Stat({ icon, label, value, sub, onClick }: { icon: ReactNode; label: string; value: number | undefined; sub?: string; onClick?: () => void }) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => onClick && e.key === 'Enter' && onClick()}
      className={`rounded-ae border border-ae-border bg-ae-surface/40 p-3 ${onClick ? 'ae-lift cursor-pointer hover:border-ae-accent/50' : ''}`}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-ae-muted uppercase">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value === undefined ? '…' : value.toLocaleString()}</p>
      {sub && <p className="text-xs text-ae-muted">{sub}</p>}
    </div>
  );
}

function Overview({ goto }: { goto: (t: AdminSection, q?: string) => void }) {
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
      <Stat icon={<FlagIcon size={12} />} label="Open reports" value={s?.open_reports} onClick={() => goto('reports')} />
      <Stat icon={<ScaleIcon size={12} />} label="Open appeals" value={s?.open_appeals} onClick={() => goto('appeals')} />
      <Stat icon={<BannedIcon size={12} />} label="Banned now" value={s?.banned} onClick={() => goto('users', 'is:banned')} />
      <Stat icon={<WarningIcon size={12} />} label="Active warnings" value={s?.active_warnings} onClick={() => goto('users', 'is:warned')} />
      <Stat icon={<AdminIcon size={12} />} label="Admins" value={s?.admins} onClick={() => goto('users', 'is:admin')} />
    </div>
  );
}

function UserRow({ u, me, onChanged, onOpen }: { u: AdminUser; me: string; onChanged: () => void; onOpen: () => void }) {
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
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-ae text-left">
        {u.avatar_url ? <img src={u.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-full bg-ae-sunken font-bold">{u.username[0]?.toUpperCase()}</span>}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-semibold">
            {u.display_name || u.username} <span className="font-normal text-ae-muted">@{u.username}</span>
            {u.is_admin && <span className="rounded bg-ae-accent/20 px-1.5 text-[10px] font-bold text-ae-accent uppercase">Admin</span>}
            {u.banned && <span className="rounded bg-ae-danger/20 px-1.5 text-[10px] font-bold text-ae-danger uppercase">Banned</span>}
            {u.level && u.level !== 'good' && <LevelChip level={u.level} />}
          </p>
          <p className="truncate text-xs text-ae-muted">
            {u.email ?? 'no email'} · joined {date(u.created_at)} · last sign-in {date(u.last_sign_in_at)} · {u.servers} servers · {u.messages.toLocaleString()} messages
          </p>
        </div>
        </button>
        <BadgeRow badgeIds={u.badge_ids ?? []} size={22} />
        <button type="button" className="rounded-ae px-2.5 py-1.5 text-xs hover:bg-ae-hover" onClick={() => setEditing((v) => !v)}>
          Badges
        </button>
        {u.id !== me && (
          <button type="button" className={`rounded-ae px-2.5 py-1.5 text-xs hover:bg-ae-hover ${u.is_admin ? 'text-ae-danger' : 'text-ae-accent'}`} onClick={() => void setAdmin(!u.is_admin)}>
            {u.is_admin ? 'Remove admin' : 'Make admin'}
          </button>
        )}
        <button type="button" className="ae-press flex items-center gap-1 rounded-ae bg-ae-surface px-2.5 py-1.5 text-xs font-semibold hover:bg-ae-hover" onClick={onOpen}>
          <GavelIcon size={13} /> Manage
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

function Users({ me, initial }: { me: string; initial: string }) {
  const sb = useSupabase();
  const [q, setQ] = useState(initial);
  const [term, setTerm] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data = [], isFetching, refetch } = useQuery({
    queryKey: ['admin', 'users', term],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await sb.rpc('admin_search_users', { p_query: term });
      rpcError(error);
      return data as AdminUser[];
    },
  });
  const filters = [
    { id: '', label: 'Everyone' },
    { id: 'is:banned', label: 'Banned' },
    { id: 'is:warned', label: 'Warned' },
    { id: 'is:admin', label: 'Admins' },
  ];
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="ae-field flex-1">
          <SearchIcon size={15} />
          <input className="ae-input" placeholder="Search by username, display name, email or user ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" onClick={() => setCreating(true)} className="ae-press flex shrink-0 items-center gap-1.5 rounded-ae bg-ae-accent px-4 text-sm font-semibold text-ae-on-accent">
          <UserPlusIcon size={15} /> Create user
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setQ(f.id)}
            className={`rounded-full border px-3 py-1 text-xs ${term === f.id ? 'border-ae-accent bg-ae-accent/15 font-semibold' : 'border-ae-border text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-ae-muted">{isFetching ? 'Searching…' : `${data.length}${data.length === 50 ? '+' : ''} shown`}</span>
      </div>
      {isFetching && data.length === 0 ? (
        <div className="ae-skeleton h-16" />
      ) : data.length === 0 ? (
        <p className="py-8 text-center text-sm text-ae-muted">No users found.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.map((u) => (
            <UserRow key={u.id} u={u} me={me} onChanged={() => void refetch()} onOpen={() => setOpen(u.id)} />
          ))}
        </ul>
      )}
      {open && <AdminUserManager userId={open} onClose={() => setOpen(null)} />}
      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            void refetch();
            setOpen(id);
          }}
        />
      )}
    </div>
  );
}

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const sb = useSupabase();
  const [f, setF] = useState({ email: '', password: '', username: '', display_name: '', verified: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF((cur) => ({ ...cur, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error, data } = await adminUserCall(sb, { action: 'create', ...f });
    setBusy(false);
    if (error) return setErr(error);
    toast.success(`@${f.username} was created.`);
    onCreated(String(data?.user_id ?? ''));
  };
  const lbl = 'mb-1 block text-[11px] font-bold tracking-wide text-ae-muted uppercase';
  return (
    <Dialog title="Create a user" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={lbl}>Username</span>
            <input className="ae-input w-full" required maxLength={32} value={f.username} placeholder="new_user" onChange={(e) => set('username', e.target.value)} />
          </label>
          <label>
            <span className={lbl}>Display name</span>
            <input className="ae-input w-full" maxLength={64} value={f.display_name} placeholder="Optional" onChange={(e) => set('display_name', e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className={lbl}>Email</span>
          <input className="ae-input w-full" type="email" required value={f.email} placeholder="name@example.com" onChange={(e) => set('email', e.target.value)} />
        </label>
        <label className="block">
          <span className={lbl}>Password</span>
          <input className="ae-input w-full" type="text" required minLength={8} maxLength={72} autoComplete="off" value={f.password} placeholder="At least 8 characters" onChange={(e) => set('password', e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={f.verified} onChange={(e) => set('verified', e.target.checked)} />
          Mark the email as verified now
          <span className="text-xs text-ae-muted">(otherwise you can verify it later)</span>
        </label>
        {err && <p className="rounded-ae bg-ae-danger/10 px-3 py-2 text-sm text-ae-danger">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="ae-press rounded-ae bg-ae-accent px-5 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50">
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Appeals() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [open, setOpen] = useState<string | null>(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'appeals', filter],
    queryFn: async () => {
      const { data, error } = await sb.rpc('admin_list_appeals', { p_status: filter });
      rpcError(error);
      return data as AppealRow[];
    },
  });
  const review = async (a: AppealRow, accept: boolean) => {
    const response = await promptText(accept ? `Accept @${a.username}'s appeal and lift the ban?` : `Deny @${a.username}'s appeal?`, {
      title: accept ? 'Accept appeal' : 'Deny appeal',
      placeholder: 'Message to the user (optional)',
      confirmLabel: accept ? 'Accept and unban' : 'Deny',
      danger: !accept,
      multiline: true,
      maxLength: 1000,
    });
    if (response === null) return;
    const { error } = await sb.rpc('admin_review_appeal', { p_appeal_id: a.id, p_accept: accept, p_response: response });
    if (error) return toast.error(error.message);
    toast.success(accept ? `@${a.username} is unbanned.` : 'Appeal denied.');
    void qc.invalidateQueries({ queryKey: ['admin'] });
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(['open', 'all'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-ae px-3 py-1.5 text-sm ${filter === f ? 'bg-ae-surface font-semibold' : 'text-ae-muted hover:bg-ae-hover'}`}>
            {f === 'open' ? 'Waiting' : 'All'}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="ae-skeleton h-20" />
      ) : data.length === 0 ? (
        <p className="flex items-center gap-2 py-6 text-sm text-ae-muted">
          <CheckIcon size={15} /> No appeals to review.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.map((a) => (
            <li key={a.id} className="rounded-ae border border-ae-border bg-ae-surface/30 p-4">
              <div className="flex items-center gap-3">
                {a.avatar_url ? (
                  <img src={a.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-ae-sunken font-bold">{a.username[0]?.toUpperCase()}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {a.display_name || a.username} <span className="font-normal text-ae-muted">@{a.username}</span>
                  </p>
                  <p className="truncate text-xs text-ae-muted">
                    {a.ban.expires_at ? `Suspended until ${new Date(a.ban.expires_at).toLocaleString()}` : 'Permanent ban'} · “{a.ban.reason}”
                  </p>
                </div>
                <span className="text-xs text-ae-muted capitalize">{a.status}</span>
              </div>
              <p className="mt-3 rounded-ae bg-ae-sunken/60 px-3 py-2 text-sm whitespace-pre-wrap">{a.message}</p>
              {a.response && <p className="mt-1 text-xs text-ae-muted">Response: {a.response}</p>}
              <div className="mt-3 flex gap-2">
                {a.status === 'open' && (
                  <>
                    <button type="button" className="ae-press flex items-center gap-1 rounded-ae bg-ae-success/20 px-3 py-1.5 text-xs font-semibold text-ae-success" onClick={() => void review(a, true)}>
                      <CheckIcon size={13} /> Accept & unban
                    </button>
                    <button type="button" className="ae-press flex items-center gap-1 rounded-ae px-3 py-1.5 text-xs text-ae-muted hover:bg-ae-hover" onClick={() => void review(a, false)}>
                      <CloseIcon size={13} /> Deny
                    </button>
                  </>
                )}
                <button type="button" className="ml-auto rounded-ae px-3 py-1.5 text-xs text-ae-accent hover:bg-ae-hover" onClick={() => setOpen(a.user_id)}>
                  Open file
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && <AdminUserManager userId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AuditLog() {
  const sb = useSupabase();
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: async () => {
      const { data, error } = await sb.rpc('admin_audit_list', { p_limit: 150 });
      rpcError(error);
      return data as { action: string; details: Record<string, unknown>; created_at: string; by: string | null; target_name: string | null }[];
    },
  });
  return isLoading ? <div className="ae-skeleton h-32" /> : <AuditList rows={data} showTarget />;
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
  const [group, setGroup] = useState<string | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const set = async (key: string, value: unknown) => {
    const { error } = await sb.rpc('admin_set_config', { p_key: key, p_value: value });
    if (error) return toast.error(error.message);
    toast.success('Saved.');
    void qc.invalidateQueries({ queryKey: ['app-config'] });
  };
  if (!cfg) return <div className="ae-skeleton h-32" />;
  const limitValue = limit ?? String(cfg.message_request_limit ?? 3);
  const groupValue = group ?? String(cfg.group_dm_limit ?? 10);
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
      <div>
        <p className="text-sm font-semibold">Group DM size</p>
        <p className="mb-2 text-xs text-ae-muted">The most people a group DM can have, including its owner.</p>
        <div className="flex gap-2">
          <input type="number" min={2} max={10000} className="ae-input !w-28" value={groupValue} onChange={(e) => setGroup(e.target.value)} />
          <button
            type="button"
            className="ae-press rounded-ae bg-ae-surface px-4 text-sm hover:bg-ae-hover"
            onClick={() => {
              const n = Math.round(Number(groupValue));
              if (!(n >= 2 && n <= 10000)) return toast.error('Pick a number from 2 to 10,000.');
              void set('group_dm_limit', n);
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
  const [section, setSection] = useState<AdminSection>('overview');
  const [userQuery, setUserQuery] = useState('');
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
  const goto = (t: AdminSection, q?: string) => {
    if (q !== undefined) setUserQuery(q);
    setSection(t);
  };
  const tabs: { id: AdminSection; label: string; icon: ReactNode; count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: <DashboardIcon size={14} /> },
    { id: 'users', label: 'Users', icon: <UsersIcon size={14} /> },
    { id: 'appeals', label: 'Appeals', icon: <ScaleIcon size={14} />, count: s?.open_appeals },
    { id: 'reports', label: 'Reports', icon: <ReportsIcon size={14} />, count: s?.open_reports },
    { id: 'settings', label: 'App settings', icon: <SlidersIcon size={14} /> },
    { id: 'audit', label: 'Audit log', icon: <AuditIcon size={14} /> },
  ];
  return (
    <div className="space-y-6">
      <div>
        <p className="flex items-center gap-1.5 text-sm text-ae-muted">
          <AdminIcon size={15} className="text-ae-accent" /> Only admins see this. Every action is checked on the server and written to the audit log.</p>
      </div>
      <div className="flex flex-wrap gap-1 rounded-[calc(var(--ae-radius)+4px)] border border-ae-border bg-ae-sunken/50 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => goto(t.id, t.id === 'users' ? '' : undefined)}
            className={`flex items-center gap-1.5 rounded-ae px-3 py-1.5 text-sm ${section === t.id ? 'bg-ae-surface font-semibold text-ae-text shadow-sm' : 'text-ae-muted hover:text-ae-text'}`}
          >
            {t.icon}
            {t.label}
            {!!t.count && <span className="rounded-full bg-ae-danger px-1.5 text-[10px] font-bold text-white">{t.count}</span>}
          </button>
        ))}
      </div>
      <div key={section} className="ae-enter">
        {section === 'overview' && (
          <Section title="Overview" description="Live numbers. Click a tile to jump to it.">
            <Overview goto={goto} />
          </Section>
        )}
        {section === 'users' && (
          <Section title="Users" description="Search anyone, then open their file to warn, ban, edit or delete. Admins can also be set in Supabase (users.is_admin).">
            <Users key={userQuery} me={userId} initial={userQuery} />
          </Section>
        )}
        {section === 'appeals' && (
          <Section title="Ban appeals" description="Accepting an appeal lifts the ban right away.">
            <Appeals />
          </Section>
        )}
        {section === 'reports' && (
          <Section title="Reports" description="Reports from DMs and message requests. Server reports go to each server's moderators.">
            <Reports />
          </Section>
        )}
        {section === 'settings' && (
          <Section title="App settings">
            <Config />
          </Section>
        )}
        {section === 'audit' && (
          <Section title="Audit log" description="The last 150 admin actions.">
            <AuditLog />
          </Section>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-ae-muted">
        <MessageIcon size={12} /> <LiveIcon size={12} /> <ServerIcon size={12} /> Changes apply to everyone immediately.
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
