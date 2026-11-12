/**
 * Admin Panel → a user's moderation file. Opens over the panel when an admin picks someone.
 * Tabs: Overview (standing and recent history), Account (profile, email, password, sign-out,
 * delete), Warnings (add, edit, revoke, restore, delete; pin a danger level), Bans (timed or
 * permanent, lift/pardon, appeals) and History (the admin audit log for this person).
 * Every action is a server-checked RPC (011_moderation.sql) or the admin-user Edge Function.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useSupabase } from '../lib/supabase';
import { ask, promptText } from './ConfirmDialog';
import {
  BannedIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  EditIcon,
  GaugeIcon,
  HistoryIcon,
  KeyIcon,
  LogOutIcon,
  MailIcon,
  ScaleIcon,
  TrashIcon,
  UndoIcon,
  UserIcon,
  WarningIcon,
} from './icons';
import { fmtDate, LevelChip, LEVELS, levelInfo, StandingMeter, untilText, WARNING_CATEGORIES, type DangerLevel } from './Moderation';
import { toast } from './Toaster';
import { useEscape } from '../lib/escape';

interface DetailWarning {
  id: string;
  category: string;
  details: string | null;
  severity: number;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  acknowledged_at: string | null;
  by: string | null;
  active: boolean;
}
interface DetailBan {
  id: string;
  reason: string;
  created_at: string;
  expires_at: string | null;
  lifted_at: string | null;
  lift_reason: string | null;
  by: string | null;
  active: boolean;
}
interface Detail {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  is_admin: boolean;
  created_at: string;
  email: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  servers_owned: number;
  servers: number;
  messages: number;
  reports_against: number;
  banned: boolean;
  level: DangerLevel;
  computed_level: DangerLevel;
  points: number;
  standing: { override: DangerLevel | null; note: string | null; updated_at: string } | null;
  bans: DetailBan[];
  warnings: DetailWarning[];
  appeals: { id: string; message: string; status: string; response: string | null; created_at: string }[];
  audit: { action: string; details: Record<string, unknown>; created_at: string; by: string | null }[];
}

type Tab = 'overview' | 'account' | 'warnings' | 'bans' | 'history';

const BAN_DURATIONS: { label: string; hours: number | null }[] = [
  { label: '1 hour', hours: 1 },
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
  { label: '30 days', hours: 720 },
  { label: 'Permanent', hours: null },
];
const SEVERITIES = [
  { n: 1, label: 'Minor', hint: '1 point' },
  { n: 2, label: 'Moderate', hint: '2 points' },
  { n: 3, label: 'Serious', hint: '3 points' },
  { n: 4, label: 'Severe', hint: '4 points' },
];
const ACTION_LABEL: Record<string, string> = {
  ban: 'Banned',
  unban: 'Ban lifted',
  warn: 'Warned',
  warning_edited: 'Warning edited',
  warning_revoke: 'Warning revoked',
  warning_restore: 'Warning restored',
  warning_delete: 'Warning deleted',
  standing: 'Standing changed',
  profile_edited: 'Profile edited',
  account_edited: 'Email or password changed',
  signed_out: 'Signed out everywhere',
  delete: 'Account deleted',
  appeal_accepted: 'Appeal accepted',
  appeal_denied: 'Appeal denied',
  admin_granted: 'Made admin',
  admin_removed: 'Admin removed',
  badges: 'Badges changed',
};
function durationText(hours: number) {
  const h = Math.max(1, Math.round(hours));
  if (h < 24) return `${h}-hour`;
  const d = Math.round(h / 24);
  return d % 7 === 0 && d < 60 ? `${d / 7}-week` : `${d}-day`;
}
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.replace(/_/g, ' ');

const btn = 'ae-press flex items-center justify-center gap-1.5 rounded-ae px-3.5 py-2 text-sm font-semibold disabled:opacity-40';
const label = 'mb-1 block text-[11px] font-bold tracking-wide text-ae-muted uppercase';

export function AdminUserManager({ userId, onClose }: { userId: string; onClose: () => void }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const { data: d, refetch } = useQuery({
    queryKey: ['admin', 'user', userId],
    queryFn: async () => {
      const { data, error } = await sb.rpc('admin_user_detail', { p_user_id: userId });
      if (error) throw new Error(error.message);
      return data as Detail;
    },
  });
  const changed = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ['admin'] });
  };

  useEscape(() => onClose(), true);

  const tabs: { id: Tab; label: string; icon: ReactNode; count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: <GaugeIcon size={15} /> },
    { id: 'account', label: 'Account', icon: <UserIcon size={15} /> },
    { id: 'warnings', label: 'Warnings', icon: <WarningIcon size={15} />, count: d?.warnings.filter((w) => w.active).length },
    { id: 'bans', label: 'Bans & appeals', icon: <BannedIcon size={15} />, count: d?.appeals.filter((a) => a.status === 'open').length },
    { id: 'history', label: 'History', icon: <HistoryIcon size={15} /> },
  ];
  const lvl = levelInfo(d?.level);

  return (
    <div className="ae-backdrop fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage user"
        className="ae-dialog flex h-[min(720px,calc(100vh-32px))] w-full max-w-4xl overflow-hidden rounded-[calc(var(--ae-radius)+6px)] border border-ae-border bg-ae-bg shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <aside className="flex w-60 shrink-0 flex-col border-r border-ae-border bg-ae-elevated">
          <div className="relative h-20 shrink-0 bg-ae-surface" style={d?.banner_url ? { backgroundImage: `url(${d.banner_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
            <div className="absolute -bottom-7 left-4 rounded-full border-4 border-ae-elevated">
              {d?.avatar_url ? (
                <img src={d.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
              ) : (
                <span className="grid h-14 w-14 place-items-center rounded-full bg-ae-sunken text-lg font-bold">{d?.username[0]?.toUpperCase() ?? '?'}</span>
              )}
            </div>
          </div>
          <div className="px-4 pt-9 pb-3">
            <p className="truncate font-bold">{d?.display_name || d?.username || '…'}</p>
            <p className="truncate text-xs text-ae-muted">@{d?.username}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {d?.is_admin && <span className="rounded bg-ae-accent/20 px-1.5 py-px text-[10px] font-bold text-ae-accent uppercase">Admin</span>}
              {d?.banned && <span className="rounded bg-ae-danger/20 px-1.5 py-px text-[10px] font-bold text-ae-danger uppercase">Banned</span>}
              {d && <LevelChip level={d.level} />}
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 px-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex w-full items-center gap-2.5 rounded-ae px-3 py-2 text-left text-sm ${tab === t.id ? 'bg-ae-surface font-semibold text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`}
              >
                {t.icon}
                <span className="flex-1">{t.label}</span>
                {!!t.count && <span className="rounded-full bg-ae-danger px-1.5 text-[10px] font-bold text-white">{t.count}</span>}
              </button>
            ))}
          </nav>
          <p className="truncate px-4 py-3 font-mono text-[10px] text-ae-muted" title={userId}>
            {userId}
          </p>
        </aside>

        <section className="ae-scroll relative min-w-0 flex-1 overflow-y-auto p-6">
          <button type="button" aria-label="Close" onClick={onClose} className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-full text-ae-muted hover:bg-ae-hover hover:text-ae-text">
            <CloseIcon size={16} />
          </button>
          {!d ? (
            <div className="space-y-3">
              <div className="ae-skeleton h-24" />
              <div className="ae-skeleton h-40" />
            </div>
          ) : (
            <div key={tab} className="ae-enter">
              {tab === 'overview' && <Overview d={d} lvl={lvl} goto={setTab} />}
              {tab === 'account' && <Account d={d} onChanged={changed} onDeleted={onClose} />}
              {tab === 'warnings' && <Warnings d={d} onChanged={changed} />}
              {tab === 'bans' && <Bans d={d} onChanged={changed} />}
              {tab === 'history' && <History d={d} />}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function H({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4 pr-10">
      <h2 className="text-lg font-bold">{children}</h2>
      {sub && <p className="text-sm text-ae-muted">{sub}</p>}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="rounded-ae border border-ae-border bg-ae-surface/30 px-3 py-2">
      <p className="text-[10px] font-bold tracking-wide text-ae-muted uppercase">{k}</p>
      <p className="truncate text-sm font-semibold tabular-nums">{v}</p>
    </div>
  );
}

function Overview({ d, lvl, goto }: { d: Detail; lvl: ReturnType<typeof levelInfo>; goto: (t: Tab) => void }) {
  const activeBan = d.bans.find((b) => b.active);
  return (
    <>
      <H sub="Standing, activity and anything that needs attention.">Overview</H>
      {activeBan && (
        <button type="button" onClick={() => goto('bans')} className="mb-4 flex w-full items-start gap-3 rounded-ae border border-ae-danger/40 bg-ae-danger/10 p-3 text-left">
          <BannedIcon size={18} className="mt-0.5 shrink-0 text-ae-danger" />
          <span className="text-sm">
            <b>{activeBan.expires_at ? `Suspended until ${new Date(activeBan.expires_at).toLocaleString()}` : 'Permanently banned'}</b>
            <span className="block text-ae-muted">{activeBan.reason}</span>
          </span>
        </button>
      )}
      <div className="mb-5 rounded-[calc(var(--ae-radius)+4px)] border border-ae-border bg-ae-surface/20 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">
            Danger level: <span style={{ color: lvl.color }}>{lvl.label}</span>
            {d.standing?.override && <span className="ml-2 text-xs font-normal text-ae-muted">(set by hand; computed: {levelInfo(d.computed_level).label})</span>}
          </p>
          <span className="text-xs text-ae-muted tabular-nums">{d.points} active point{d.points === 1 ? '' : 's'}</span>
        </div>
        <StandingMeter level={d.level} />
        {d.standing?.note && <p className="mt-3 rounded-ae bg-ae-sunken/60 px-3 py-2 text-xs text-ae-muted">Note: {d.standing.note}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact k="Joined" v={fmtDate(d.created_at)} />
        <Fact k="Last sign-in" v={d.last_sign_in_at ? fmtDate(d.last_sign_in_at) : 'Never'} />
        <Fact k="Messages" v={d.messages.toLocaleString()} />
        <Fact k="Servers" v={`${d.servers} (${d.servers_owned} owned)`} />
        <Fact k="Reports against" v={d.reports_against} />
        <Fact k="Warnings" v={`${d.warnings.filter((w) => w.active).length} active / ${d.warnings.length}`} />
        <Fact k="Bans" v={d.bans.length} />
        <Fact k="Email" v={d.email_confirmed_at ? 'Confirmed' : 'Unconfirmed'} />
      </div>
      <p className="mt-6 mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Recent admin actions</p>
      <AuditList rows={d.audit.slice(0, 5)} />
    </>
  );
}

function Account({ d, onChanged, onDeleted }: { d: Detail; onChanged: () => void; onDeleted: () => void }) {
  const sb = useSupabase();
  const [username, setUsername] = useState(d.username);
  const [display, setDisplay] = useState(d.display_name ?? '');
  const [bio, setBio] = useState(d.bio ?? '');
  const [clearAvatar, setClearAvatar] = useState(false);
  const [clearBanner, setClearBanner] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const protectedAccount = d.is_admin;

  const saveProfile = async () => {
    if (!/^[A-Za-z0-9_.]{2,32}$/.test(username.trim())) return toast.error('Usernames are 2–32 letters, numbers, dots or underscores.');
    setBusy('profile');
    const { error } = await sb.rpc('admin_update_profile', {
      p_user_id: d.id,
      p_username: username.trim(),
      p_display_name: display,
      p_bio: bio,
      p_clear_avatar: clearAvatar,
      p_clear_banner: clearBanner,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success('Profile saved.');
    setClearAvatar(false);
    setClearBanner(false);
    onChanged();
  };
  const saveAuth = async (what: 'email' | 'password') => {
    const body = what === 'email' ? { user_id: d.id, email } : { user_id: d.id, password };
    if (what === 'password' && !(await ask(`Set a new password for @${d.username}? They'll be signed out on every device.`, { confirmLabel: 'Change password' }))) return;
    setBusy(what);
    const { data, error } = await sb.functions.invoke('admin-user', { body });
    let message = error ? error.message : (data as { error?: string } | null)?.error;
    if (error && 'context' in error) {
      try {
        message = ((await (error as { context: Response }).context.json()) as { error?: string }).error ?? message;
      } catch {
        // keep the generic message
      }
    }
    if (!message && what === 'password') await sb.rpc('admin_sign_out_user', { p_user_id: d.id });
    setBusy(null);
    if (message) return toast.error(message);
    toast.success(what === 'email' ? 'Email changed.' : 'Password changed and sessions signed out.');
    if (what === 'email') setEmail('');
    else setPassword('');
    onChanged();
  };
  const signOut = async () => {
    if (!(await ask(`Sign @${d.username} out on every device?`, { confirmLabel: 'Sign out' }))) return;
    const { error } = await sb.rpc('admin_sign_out_user', { p_user_id: d.id });
    if (error) return toast.error(error.message);
    toast.success('Signed out everywhere.');
    onChanged();
  };
  const del = async () => {
    const owned = d.servers_owned ? ` The ${d.servers_owned} server${d.servers_owned === 1 ? '' : 's'} they own will be deleted too.` : '';
    const reason = await promptText(
      `Permanently delete @${d.username}? Their messages stay as "Deleted user".${owned} This can't be undone.`,
      { title: 'Delete account', placeholder: 'Reason (kept in the audit log)', confirmLabel: 'Delete account', danger: true, maxLength: 300 },
    );
    if (reason === null) return;
    const { error } = await sb.rpc('admin_delete_user', { p_user_id: d.id, p_reason: reason || 'No reason given' });
    if (error) return toast.error(error.message);
    toast.success(`@${d.username} was deleted.`);
    onChanged();
    onDeleted();
  };

  return (
    <>
      <H sub="Edit what this person shows and how they sign in.">Account</H>
      {protectedAccount && (
        <p className="mb-4 rounded-ae border border-ae-accent/40 bg-ae-accent/10 px-3 py-2 text-sm">
          This account is an admin. You can edit its profile; to change its sign-in, ban or delete it, remove its admin access first.
        </p>
      )}
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={label}>Username</span>
            <input className="ae-input w-full" value={username} maxLength={32} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            <span className={label}>Display name</span>
            <input className="ae-input w-full" value={display} maxLength={64} placeholder={d.username} onChange={(e) => setDisplay(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className={label}>About me</span>
          <textarea className="ae-input min-h-20 w-full text-sm" value={bio} maxLength={4000} onChange={(e) => setBio(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className={`flex items-center gap-2 ${d.avatar_url ? '' : 'opacity-40'}`}>
            <input type="checkbox" className="h-4 w-4" disabled={!d.avatar_url} checked={clearAvatar} onChange={(e) => setClearAvatar(e.target.checked)} /> Remove avatar
          </label>
          <label className={`flex items-center gap-2 ${d.banner_url ? '' : 'opacity-40'}`}>
            <input type="checkbox" className="h-4 w-4" disabled={!d.banner_url} checked={clearBanner} onChange={(e) => setClearBanner(e.target.checked)} /> Remove banner
          </label>
        </div>
        <div className="flex justify-end">
          <button type="button" disabled={busy !== null} onClick={() => void saveProfile()} className={`${btn} bg-ae-accent text-ae-on-accent`}>
            <CheckIcon size={15} /> Save profile
          </button>
        </div>
      </div>

      <div className={`mt-6 space-y-4 border-t border-ae-border pt-5 ${protectedAccount ? 'pointer-events-none opacity-40' : ''}`}>
        <p className="text-sm font-semibold">Sign-in</p>
        <div>
          <span className={label}>Email · currently {d.email ?? 'none'}</span>
          <div className="flex gap-2">
            <div className="ae-field flex-1">
              <MailIcon size={15} />
              <input className="ae-input" type="email" value={email} placeholder="new@email.com" onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button type="button" disabled={!email.trim() || busy !== null} onClick={() => void saveAuth('email')} className={`${btn} bg-ae-surface hover:bg-ae-hover`}>
              Change email
            </button>
          </div>
          <p className="mt-1 text-xs text-ae-muted">Takes effect right away; no confirmation email is sent.</p>
        </div>
        <div>
          <span className={label}>New password</span>
          <div className="flex gap-2">
            <div className="ae-field flex-1">
              <KeyIcon size={15} />
              <input className="ae-input" type="password" autoComplete="new-password" value={password} placeholder="At least 8 characters" onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="button" disabled={password.length < 8 || busy !== null} onClick={() => void saveAuth('password')} className={`${btn} bg-ae-surface hover:bg-ae-hover`}>
              Set password
            </button>
          </div>
        </div>
        <button type="button" onClick={() => void signOut()} className={`${btn} bg-ae-surface hover:bg-ae-hover`}>
          <LogOutIcon size={15} /> Sign out everywhere
        </button>
      </div>

      <div className={`mt-6 rounded-ae border border-ae-danger/40 p-4 ${protectedAccount ? 'pointer-events-none opacity-40' : ''}`}>
        <p className="text-sm font-semibold text-ae-danger">Delete account</p>
        <p className="mb-3 text-xs text-ae-muted">Removes the account and sign-in for good. Messages stay, shown as “Deleted user”; servers they own are deleted.</p>
        <button type="button" onClick={() => void del()} className={`${btn} bg-ae-danger text-white`}>
          <TrashIcon size={15} /> Delete @{d.username}
        </button>
      </div>
    </>
  );
}

function WarningForm({ initial, onSubmit, onCancel, submitLabel }: {
  initial?: { category: string; details: string; severity: number; expires: string };
  onSubmit: (v: { category: string; details: string; severity: number; expires: string }) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const [category, setCategory] = useState(initial?.category ?? 'spam');
  const [details, setDetails] = useState(initial?.details ?? '');
  const [severity, setSeverity] = useState(initial?.severity ?? 1);
  const [expires, setExpires] = useState(initial?.expires ?? '90');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3 rounded-[calc(var(--ae-radius)+4px)] border border-ae-border bg-ae-surface/20 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSubmit({ category, details, severity, expires });
        setBusy(false);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={label}>Rule broken</span>
          <select className="ae-input w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(WARNING_CATEGORIES).map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={label}>Counts for</span>
          <select className="ae-input w-full" value={expires} onChange={(e) => setExpires(e.target.value)}>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">6 months</option>
            <option value="365">1 year</option>
            <option value="never">Never expires</option>
          </select>
        </label>
      </div>
      <div>
        <span className={label}>Severity</span>
        <div className="grid grid-cols-4 gap-1.5">
          {SEVERITIES.map((s) => (
            <button
              key={s.n}
              type="button"
              onClick={() => setSeverity(s.n)}
              className={`rounded-ae border px-2 py-1.5 text-left text-xs ${severity === s.n ? 'border-ae-warning bg-ae-warning/15' : 'border-ae-border hover:bg-ae-hover'}`}
            >
              <span className="block font-semibold">{s.label}</span>
              <span className="text-ae-muted">{s.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className={label}>Message to the user</span>
        <textarea className="ae-input min-h-16 w-full text-sm" maxLength={1000} value={details} placeholder="What they did, and what to avoid. They'll see this." onChange={(e) => setDetails(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className={`${btn} hover:bg-ae-hover`}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={busy} className={`${btn} bg-ae-warning text-black`}>
          <WarningIcon size={15} /> {submitLabel}
        </button>
      </div>
    </form>
  );
}

function Warnings({ d, onChanged }: { d: Detail; onChanged: () => void }) {
  const sb = useSupabase();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [override, setOverride] = useState<DangerLevel | ''>(d.standing?.override ?? '');
  const [note, setNote] = useState(d.standing?.note ?? '');
  const canWarn = !d.is_admin;

  const setState = async (id: string, mode: 'revoke' | 'restore' | 'delete') => {
    if (mode === 'delete' && !(await ask('Delete this warning for good? It disappears from their history too.', { danger: true, confirmLabel: 'Delete' }))) return;
    const { error } = await sb.rpc('admin_set_warning_state', { p_warning_id: id, p_mode: mode });
    if (error) return toast.error(error.message);
    onChanged();
  };
  const saveStanding = async () => {
    const { error } = await sb.rpc('admin_set_standing', { p_user_id: d.id, p_override: override || null, p_note: note });
    if (error) return toast.error(error.message);
    toast.success('Standing saved.');
    onChanged();
  };

  return (
    <>
      <H sub="Warnings add points to the danger level until they expire. The user sees each warning once, then in Account Standing.">Warnings</H>
      {canWarn ? (
        adding ? (
          <WarningForm
            submitLabel="Issue warning"
            onCancel={() => setAdding(false)}
            onSubmit={async (v) => {
              const { error } = await sb.rpc('admin_warn_user', {
                p_user_id: d.id,
                p_category: v.category,
                p_details: v.details,
                p_severity: v.severity,
                p_expires_days: v.expires === 'never' ? null : Number(v.expires),
              });
              if (error) return void toast.error(error.message);
              toast.success('Warning issued.');
              setAdding(false);
              onChanged();
            }}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={`${btn} bg-ae-warning text-black`}>
            <WarningIcon size={15} /> Warn @{d.username}
          </button>
        )
      ) : (
        <p className="text-sm text-ae-muted">Admins can&apos;t be warned. Remove their admin access first.</p>
      )}

      <ul className="mt-5 space-y-2">
        {d.warnings.length === 0 && <li className="rounded-ae border border-dashed border-ae-border px-4 py-6 text-center text-sm text-ae-muted">No warnings on record.</li>}
        {d.warnings.map((w) =>
          editing === w.id ? (
            <li key={w.id}>
              <WarningForm
                submitLabel="Save warning"
                initial={{
                  category: w.category,
                  details: w.details ?? '',
                  severity: w.severity,
                  expires: w.expires_at ? String(Math.max(1, Math.round((new Date(w.expires_at).getTime() - new Date(w.created_at).getTime()) / 86400_000))) : 'never',
                }}
                onCancel={() => setEditing(null)}
                onSubmit={async (v) => {
                  const expires = v.expires === 'never' ? null : new Date(new Date(w.created_at).getTime() + Number(v.expires) * 86400_000).toISOString();
                  const { error } = await sb.rpc('admin_update_warning', { p_warning_id: w.id, p_category: v.category, p_details: v.details, p_severity: v.severity, p_expires_at: expires });
                  if (error) return void toast.error(error.message);
                  setEditing(null);
                  onChanged();
                }}
              />
            </li>
          ) : (
            <li key={w.id} className={`rounded-ae border border-ae-border px-4 py-3 ${w.active ? 'bg-ae-surface/20' : 'opacity-60'}`}>
              <div className="flex items-center gap-2">
                <WarningIcon size={15} className={w.active ? 'text-ae-warning' : 'text-ae-muted'} />
                <span className="font-semibold">{WARNING_CATEGORIES[w.category] ?? w.category}</span>
                <span className="rounded bg-ae-warning/15 px-1.5 text-[10px] font-bold text-ae-warning">{SEVERITIES[w.severity - 1]?.label}</span>
                {!w.active && <span className="text-[10px] font-bold text-ae-muted uppercase">{w.revoked_at ? 'Revoked' : 'Expired'}</span>}
                <span className="ml-auto flex gap-0.5">
                  <IconBtn tip="Edit" onClick={() => setEditing(w.id)}>
                    <EditIcon size={14} />
                  </IconBtn>
                  {w.revoked_at ? (
                    <IconBtn tip="Restore" onClick={() => void setState(w.id, 'restore')}>
                      <UndoIcon size={14} />
                    </IconBtn>
                  ) : (
                    <IconBtn tip="Revoke (keeps history)" onClick={() => void setState(w.id, 'revoke')}>
                      <CloseIcon size={14} />
                    </IconBtn>
                  )}
                  <IconBtn tip="Delete" danger onClick={() => void setState(w.id, 'delete')}>
                    <TrashIcon size={14} />
                  </IconBtn>
                </span>
              </div>
              {w.details && <p className="mt-1 text-sm text-ae-muted">{w.details}</p>}
              <p className="mt-1 text-xs text-ae-muted">
                {fmtDate(w.created_at)} by @{w.by ?? 'unknown'} · {w.expires_at ? `${w.active ? 'expires' : 'expired'} ${fmtDate(w.expires_at)}` : 'never expires'} ·{' '}
                {w.acknowledged_at ? 'seen' : 'not seen yet'}
              </p>
            </li>
          ),
        )}
      </ul>

      <div className="mt-6 space-y-3 border-t border-ae-border pt-5">
        <p className="text-sm font-semibold">Danger level</p>
        <p className="text-xs text-ae-muted">Computed from active warnings ({levelInfo(d.computed_level).label}, {d.points} points). Pin a level to override it.</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setOverride('')} className={`rounded-full border px-3 py-1 text-xs ${override === '' ? 'border-ae-accent bg-ae-accent/15' : 'border-ae-border hover:bg-ae-hover'}`}>
            Automatic
          </button>
          {LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setOverride(l.id)}
              className="rounded-full border px-3 py-1 text-xs font-semibold"
              style={override === l.id ? { borderColor: l.color, background: `color-mix(in srgb, ${l.color} 20%, transparent)`, color: l.color } : { borderColor: 'var(--ae-border)' }}
            >
              {l.label}
            </button>
          ))}
        </div>
        <input className="ae-input w-full text-sm" maxLength={1000} value={note} placeholder="Private note for admins (optional)" onChange={(e) => setNote(e.target.value)} />
        <div className="flex justify-end">
          <button type="button" onClick={() => void saveStanding()} className={`${btn} bg-ae-surface hover:bg-ae-hover`}>
            <CheckIcon size={15} /> Save level
          </button>
        </div>
      </div>
    </>
  );
}

function Bans({ d, onChanged }: { d: Detail; onChanged: () => void }) {
  const sb = useSupabase();
  const [hours, setHours] = useState<number | null>(24);
  const [custom, setCustom] = useState('');
  const [reason, setReason] = useState('');
  const active = d.bans.find((b) => b.active);
  const customHours = custom ? Math.round(Number(custom) * 24) : null;

  const ban = async () => {
    const h = customHours ?? hours;
    if (!reason.trim()) return toast.error('Give a reason. The user sees it.');
    if (customHours !== null && !(customHours >= 1)) return toast.error('Enter a number of days.');
    const what = h === null ? 'permanently ban' : `ban for ${h >= 24 ? `${Math.round(h / 24)} day${h >= 48 ? 's' : ''}` : `${h} hour${h === 1 ? '' : 's'}`}`;
    if (!(await ask(`${what[0]!.toUpperCase()}${what.slice(1)} @${d.username}? They'll be locked out right away and can appeal.`, { danger: true, confirmLabel: 'Ban' }))) return;
    const { error } = await sb.rpc('admin_ban_user', { p_user_id: d.id, p_reason: reason.trim(), p_duration_hours: h });
    if (error) return toast.error(error.message);
    toast.success(`@${d.username} is banned.`);
    setReason('');
    setCustom('');
    onChanged();
  };
  const unban = async () => {
    const why = await promptText(`Lift @${d.username}'s ban?`, { title: 'Pardon', placeholder: 'Reason (optional)', confirmLabel: 'Lift ban', maxLength: 300 });
    if (why === null) return;
    const { error } = await sb.rpc('admin_unban_user', { p_user_id: d.id, p_reason: why });
    if (error) return toast.error(error.message);
    toast.success('Ban lifted.');
    onChanged();
  };
  const review = async (id: string, accept: boolean) => {
    const response = await promptText(accept ? 'Accept this appeal and lift the ban?' : 'Deny this appeal?', {
      title: accept ? 'Accept appeal' : 'Deny appeal',
      placeholder: 'Message to the user (optional)',
      confirmLabel: accept ? 'Accept and unban' : 'Deny',
      danger: !accept,
      multiline: true,
      maxLength: 1000,
    });
    if (response === null) return;
    const { error } = await sb.rpc('admin_review_appeal', { p_appeal_id: id, p_accept: accept, p_response: response });
    if (error) return toast.error(error.message);
    onChanged();
  };

  return (
    <>
      <H sub="Banned accounts can still sign in, but only see their ban and can appeal.">Bans & appeals</H>
      {active ? (
        <div className="flex items-start gap-3 rounded-ae border border-ae-danger/40 bg-ae-danger/10 p-4">
          <BannedIcon size={20} className="mt-0.5 shrink-0 text-ae-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{active.expires_at ? `Suspended, ends ${untilText(active.expires_at)}` : 'Permanently banned'}</p>
            <p className="text-sm text-ae-muted">{active.reason}</p>
            <p className="mt-1 text-xs text-ae-muted">
              Since {new Date(active.created_at).toLocaleString()} by @{active.by ?? 'unknown'}
              {active.expires_at && ` · until ${new Date(active.expires_at).toLocaleString()}`}
            </p>
          </div>
          <button type="button" onClick={() => void unban()} className={`${btn} shrink-0 bg-ae-success text-white`}>
            <UndoIcon size={15} /> Lift ban
          </button>
        </div>
      ) : d.is_admin ? (
        <p className="text-sm text-ae-muted">Admins can&apos;t be banned. Remove their admin access first.</p>
      ) : (
        <div className="space-y-3 rounded-[calc(var(--ae-radius)+4px)] border border-ae-border bg-ae-surface/20 p-4">
          <div>
            <span className={label}>Duration</span>
            <div className="flex flex-wrap gap-1.5">
              {BAN_DURATIONS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => {
                    setHours(o.hours);
                    setCustom('');
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${!custom && hours === o.hours ? 'border-ae-danger bg-ae-danger/15 text-ae-danger' : 'border-ae-border hover:bg-ae-hover'}`}
                >
                  {o.label}
                </button>
              ))}
              <span className="flex items-center gap-1.5 text-xs text-ae-muted">
                or
                <input className="ae-input w-16 !py-1 text-center text-xs" inputMode="decimal" value={custom} placeholder="14" onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ''))} />
                days
              </span>
            </div>
          </div>
          <label className="block">
            <span className={label}>Reason (shown to the user)</span>
            <textarea className="ae-input min-h-16 w-full text-sm" maxLength={500} value={reason} placeholder="e.g. Repeated spam in message requests after warnings" onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex justify-end">
            <button type="button" onClick={() => void ban()} className={`${btn} bg-ae-danger text-white`}>
              <BannedIcon size={15} /> Ban @{d.username}
            </button>
          </div>
        </div>
      )}

      {d.appeals.length > 0 && (
        <>
          <p className="mt-6 mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Appeals</p>
          <ul className="space-y-2">
            {d.appeals.map((a) => (
              <li key={a.id} className="rounded-ae border border-ae-border bg-ae-surface/20 px-4 py-3">
                <div className="flex items-center gap-2 text-xs">
                  <ScaleIcon size={14} />
                  <span className="font-bold uppercase">{a.status}</span>
                  <span className="text-ae-muted">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap">{a.message}</p>
                {a.response && <p className="mt-1 text-xs text-ae-muted">Response: {a.response}</p>}
                {a.status === 'open' && (
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => void review(a.id, true)} className={`${btn} bg-ae-success/20 !py-1 text-xs text-ae-success`}>
                      <CheckIcon size={13} /> Accept & unban
                    </button>
                    <button type="button" onClick={() => void review(a.id, false)} className={`${btn} !py-1 text-xs text-ae-muted hover:bg-ae-hover`}>
                      <CloseIcon size={13} /> Deny
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-6 mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Ban history</p>
      {d.bans.length === 0 ? (
        <p className="text-sm text-ae-muted">Never banned.</p>
      ) : (
        <ul className="space-y-1.5">
          {d.bans.map((b) => (
            <li key={b.id} className="flex items-start gap-3 rounded-ae border border-ae-border px-3 py-2 text-sm">
              <ClockIcon size={14} className="mt-1 shrink-0 text-ae-muted" />
              <div className="min-w-0 flex-1">
                <p>
                  <b>{b.expires_at ? `${durationText((new Date(b.expires_at).getTime() - new Date(b.created_at).getTime()) / 3600_000)} ban` : 'Permanent ban'}</b>{' '}
                  <span className="text-ae-muted">· {b.reason}</span>
                </p>
                <p className="text-xs text-ae-muted">
                  {fmtDate(b.created_at)} by @{b.by ?? 'unknown'} · {b.active ? 'active' : b.lifted_at ? `lifted ${fmtDate(b.lifted_at)} (${b.lift_reason ?? ''})` : 'expired'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function History({ d }: { d: Detail }) {
  return (
    <>
      <H sub="Every admin action on this account, newest first.">History</H>
      <AuditList rows={d.audit} />
    </>
  );
}

export function AuditList({ rows, showTarget = false }: { rows: { action: string; details: Record<string, unknown>; created_at: string; by: string | null; target_name?: string | null }[]; showTarget?: boolean }) {
  if (!rows.length) return <p className="text-sm text-ae-muted">Nothing yet.</p>;
  return (
    <ol className="relative space-y-3 border-l border-ae-border pl-4">
      {rows.map((r, i) => {
        const why = typeof r.details?.reason === 'string' ? r.details.reason : typeof r.details?.details === 'string' ? r.details.details : null;
        return (
          <li key={i} className="relative">
            <span className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-ae-bg bg-ae-accent" />
            <p className="text-sm">
              <b>{actionLabel(r.action)}</b>
              {showTarget && r.target_name && <span className="text-ae-muted"> · @{r.target_name}</span>}
              <span className="text-ae-muted"> by @{r.by ?? 'unknown'}</span>
            </p>
            {why && <p className="text-xs text-ae-muted">“{why}”</p>}
            <p className="text-[11px] text-ae-muted">{new Date(r.created_at).toLocaleString()}</p>
          </li>
        );
      })}
    </ol>
  );
}

function IconBtn({ tip, onClick, children, danger }: { tip: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button type="button" data-tip={tip} aria-label={tip} onClick={onClick} className={`grid h-7 w-7 place-items-center rounded-ae text-ae-muted hover:bg-ae-hover ${danger ? 'hover:text-ae-danger' : 'hover:text-ae-text'}`}>
      {children}
    </button>
  );
}

