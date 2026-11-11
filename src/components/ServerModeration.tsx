/**
 * Server Settings → Moderation (reports queue and AutoMod activity) and → AutoMod (rules).
 */
import { ask } from './ConfirmDialog';
import { useMemo, useState } from 'react';
import { useProfile, useServerMembers } from '../hooks/useChatData';
import { useAutomod, useResolveReport, useServerReports } from '../hooks/useAccount';
import { useServerRoles } from '../hooks/useServerAdmin';
import { useSupabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import type { AutomodAction, AutomodRule, AutomodTrigger, Channel, Report, Server } from '../types/db';
import { Dialog } from './Dialog';
import { Avatar } from './ProfileCard';
import { Field, inputCls, Section, Toggle } from './SettingsPanel';
import { toast } from './Toaster';

const REASON_LABEL: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  hate: 'Hate speech',
  violence: 'Violence',
  nsfw: 'Sexual content',
  self_harm: 'Self-harm',
  scam: 'Scam',
  other: 'Other',
};

function Who({ userId, label }: { userId: string | null; label?: string }) {
  const { data: p } = useProfile(userId);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar profile={p} size={18} showFrame={false} />
      <b>{p?.display_name || p?.username || (userId ? '…' : 'Deleted user')}</b>
      {label && <span className="text-ae-muted">{label}</span>}
    </span>
  );
}

function ReportCard({ r, server }: { r: Report; server: Server }) {
  const resolve = useResolveReport(server.id);
  const sb = useSupabase();
  const goTo = useUiStore((s) => s.goTo);
  const openSettings = useUiStore((s) => s.openServerSettings);
  const [note, setNote] = useState('');
  const act = async (fn: () => Promise<{ error: { message: string } | null }>, done: string) => {
    const { error } = await fn();
    if (error) return toast.error(error.message);
    resolve.mutate({ id: r.id, status: 'resolved', resolution: note || done }, { onSuccess: () => toast.success(done) });
  };
  const btn = 'ae-press rounded-ae px-2.5 py-1 text-xs font-semibold';

  return (
    <li className={`ae-enter space-y-2 rounded-ae border p-3 ${r.status === 'open' ? 'border-ae-warning/50 bg-ae-warning/5' : 'border-ae-border opacity-70'}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-ae-danger/15 px-1.5 text-xs font-bold text-ae-danger">{REASON_LABEL[r.reason]}</span>
        <Who userId={r.target_user_id} label="reported by" />
        <Who userId={r.reporter_id} />
        <span className="ml-auto text-xs text-ae-muted">{new Date(r.created_at).toLocaleString()}</span>
      </div>
      {r.snapshot?.content && <blockquote className="rounded-ae border-l-4 border-ae-border bg-ae-sunken px-3 py-2 text-sm whitespace-pre-wrap">{r.snapshot.content}</blockquote>}
      {r.details && <p className="text-sm text-ae-muted">“{r.details}”</p>}
      {r.status === 'open' ? (
        <div className="space-y-2">
          <input className={`${inputCls} !py-1 text-xs`} placeholder="Note for the audit log (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {r.snapshot?.channel_id && r.message_id && (
              <button
                type="button"
                className={`${btn} bg-ae-surface hover:bg-ae-hover`}
                onClick={() => {
                  openSettings(null);
                  goTo({ serverId: server.id, scopeId: r.snapshot!.channel_id!, messageId: r.message_id! });
                }}
              >
                Jump to message
              </button>
            )}
            {r.message_id && (
              <button type="button" className={`${btn} bg-ae-surface hover:bg-ae-hover`} onClick={() => void act(async () => await sb.from('messages').delete().eq('id', r.message_id!), 'Message deleted')}>
                Delete message
              </button>
            )}
            {r.target_user_id && (
              <>
                <button
                  type="button"
                  className={`${btn} bg-ae-surface hover:bg-ae-hover`}
                  onClick={() => void act(async () => await sb.rpc('timeout_member', { p_server_id: server.id, p_user_id: r.target_user_id, p_minutes: 60, p_reason: note || `Report: ${REASON_LABEL[r.reason]}` }), 'Timed out for 1 hour')}
                >
                  Timeout 1h
                </button>
                <button
                  type="button"
                  className={`${btn} bg-ae-surface text-ae-danger hover:bg-ae-hover`}
                  onClick={async () =>
                    (await ask('Kick this member?')) &&
                    void act(async () => await sb.rpc('kick_member', { p_server_id: server.id, p_user_id: r.target_user_id, p_reason: note || `Report: ${REASON_LABEL[r.reason]}` }), 'Member kicked')
                  }
                >
                  Kick
                </button>
                <button
                  type="button"
                  className={`${btn} bg-ae-danger text-white`}
                  onClick={async () =>
                    (await ask('Ban this member?')) &&
                    void act(async () => await sb.rpc('ban_member', { p_server_id: server.id, p_user_id: r.target_user_id, p_reason: note || `Report: ${REASON_LABEL[r.reason]}` }), 'Member banned')
                  }
                >
                  Ban
                </button>
              </>
            )}
            <span className="flex-1" />
            <button type="button" className={`${btn} bg-ae-success text-black`} onClick={() => resolve.mutate({ id: r.id, status: 'resolved', resolution: note || undefined })}>
              Resolve
            </button>
            <button type="button" className={`${btn} text-ae-muted hover:bg-ae-hover`} onClick={() => resolve.mutate({ id: r.id, status: 'dismissed', resolution: note || undefined })}>
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-ae-muted">
          {r.status === 'resolved' ? '✓ Resolved' : 'Dismissed'}
          {r.resolution ? `: ${r.resolution}` : ''}
          {r.resolved_by && (
            <>
              {' '}
              by <Who userId={r.resolved_by} />
            </>
          )}
        </p>
      )}
    </li>
  );
}

export function ModerationTab({ server, channels }: { server: Server; channels: Channel[] }) {
  const { data: reports = [] } = useServerReports(server.id, true);
  const { events } = useAutomod(server.id, true);
  const [view, setView] = useState<'open' | 'closed' | 'automod'>('open');
  const open = reports.filter((r) => r.status === 'open');
  const closed = reports.filter((r) => r.status !== 'open');
  const chName = (id: string | null) => channels.find((c) => c.id === id)?.name ?? 'channel';
  const tab = (id: typeof view, label: string, n: number) => (
    <button
      type="button"
      onClick={() => setView(id)}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${view === id ? 'border-ae-accent text-ae-text' : 'border-transparent text-ae-muted hover:text-ae-text'}`}
    >
      {label}
      {n > 0 && <span className="ml-1.5 rounded-full bg-ae-surface px-1.5 text-xs">{n}</span>}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-ae-border">
        {tab('open', 'Open reports', open.length)}
        {tab('closed', 'Closed', closed.length)}
        {tab('automod', 'AutoMod activity', events.length)}
      </div>
      {view !== 'automod' ? (
        (view === 'open' ? open : closed).length === 0 ? (
          <div className="py-12 text-center text-ae-muted">
            <p className="mb-2 text-4xl">{view === 'open' ? '🌤️' : '🗂️'}</p>
            <p>{view === 'open' ? 'No open reports. All quiet.' : 'Nothing here yet.'}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {(view === 'open' ? open : closed).map((r) => (
              <ReportCard key={r.id} r={r} server={server} />
            ))}
          </ul>
        )
      ) : events.length === 0 ? (
        <p className="py-12 text-center text-ae-muted">AutoMod hasn&apos;t caught anything yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="ae-enter rounded-ae border border-ae-border bg-ae-surface/30 p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span>🛡️</span>
                <Who userId={e.user_id} />
                <span className="text-ae-muted">in #{chName(e.channel_id)}</span>
                <span className="rounded bg-ae-surface px-1.5 text-xs">{e.rule_name}</span>
                <span className={`rounded px-1.5 text-xs ${e.action === 'alert' ? 'bg-ae-warning/15 text-ae-warning' : 'bg-ae-danger/15 text-ae-danger'}`}>
                  {e.action === 'alert' ? 'flagged' : e.action === 'block' ? 'blocked' : 'blocked + timed out'}
                </span>
                <span className="ml-auto text-xs text-ae-muted">{new Date(e.created_at).toLocaleString()}</span>
              </div>
              {e.content && <p className="mt-1 line-clamp-2 text-ae-muted">{e.content}</p>}
              {e.matched && <p className="mt-0.5 text-xs text-ae-muted">Matched: {e.matched}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TRIGGERS: { id: AutomodTrigger; label: string; icon: string; hint: string }[] = [
  { id: 'keyword', label: 'Blocked words', icon: '🔤', hint: 'Words or phrases. Use * as a wildcard (scam* matches scammer).' },
  { id: 'link', label: 'Links', icon: '🔗', hint: 'Blocks every link except the domains you allow.' },
  { id: 'mention', label: 'Mention spam', icon: '@', hint: 'Too many @mentions in one message.' },
  { id: 'spam', label: 'Message spam', icon: '🌊', hint: 'Flooding (5+ messages in 5 seconds) or repeating the same message.' },
];
const ACTIONS: { id: AutomodAction; label: string }[] = [
  { id: 'block', label: 'Block the message' },
  { id: 'block_and_timeout', label: 'Block and time out' },
  { id: 'alert', label: 'Allow, but flag for moderators' },
];

function RuleEditor({ server, initial, onClose }: { server: Server; initial: Partial<AutomodRule>; onClose: () => void }) {
  const { save } = useAutomod(server.id, true);
  const { data: roles = [] } = useServerRoles(server.id);
  const [r, setR] = useState<Partial<AutomodRule>>({ enabled: true, action: 'block', timeout_minutes: 10, mention_limit: 10, keywords: [], allow_list: [], exempt_roles: [], ...initial });
  const [kw, setKw] = useState((initial.keywords ?? []).join(', '));
  const [allow, setAllow] = useState((initial.allow_list ?? []).join(', '));
  const split = (v: string) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const trig = TRIGGERS.find((t) => t.id === r.trigger)!;

  return (
    <Dialog wide title={r.id ? `Edit “${r.name}”` : `New rule: ${trig.label}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            { ...r, keywords: split(kw), allow_list: split(allow) },
            { onSuccess: () => (toast.success('Rule saved.'), onClose()), onError: (err) => toast.error(err.message) },
          );
        }}
      >
        <Field label="Rule name">
          <input className={inputCls} required maxLength={60} value={r.name ?? ''} onChange={(e) => setR({ ...r, name: e.target.value })} />
        </Field>
        <p className="text-xs text-ae-muted">{trig.hint}</p>
        {r.trigger === 'keyword' && (
          <>
            <Field label="Blocked words (comma or line separated)">
              <textarea className={`${inputCls} min-h-20`} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="badword, scam*, free nitro" />
            </Field>
            <Field label="Always allowed (optional)">
              <input className={inputCls} value={allow} onChange={(e) => setAllow(e.target.value)} placeholder="class, assess" />
            </Field>
          </>
        )}
        {r.trigger === 'link' && (
          <Field label="Allowed domains (comma separated)">
            <input className={inputCls} value={allow} onChange={(e) => setAllow(e.target.value)} placeholder="youtube.com, github.com" />
          </Field>
        )}
        {r.trigger === 'mention' && (
          <Field label={`Block messages with more than ${r.mention_limit} mentions`}>
            <input type="range" min={2} max={50} value={r.mention_limit} onChange={(e) => setR({ ...r, mention_limit: Number(e.target.value) })} className="w-full" />
          </Field>
        )}
        <Field label="What happens">
          <select className={inputCls} value={r.action} onChange={(e) => setR({ ...r, action: e.target.value as AutomodAction })}>
            {ACTIONS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        {r.action === 'block_and_timeout' && (
          <Field label="Timeout length">
            <select className={inputCls} value={r.timeout_minutes} onChange={(e) => setR({ ...r, timeout_minutes: Number(e.target.value) })}>
              {[1, 5, 10, 60, 1440, 10080].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : m < 1440 ? '1 hour' : m === 1440 ? '1 day' : '1 week'}
                </option>
              ))}
            </select>
          </Field>
        )}
        {roles.filter((x) => !x.is_default).length > 0 && (
          <Field label="Exempt roles">
            <div className="flex flex-wrap gap-1.5">
              {roles
                .filter((x) => !x.is_default)
                .map((role) => {
                  const on = r.exempt_roles?.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setR({ ...r, exempt_roles: on ? r.exempt_roles!.filter((x) => x !== role.id) : [...(r.exempt_roles ?? []), role.id] })}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-ae-accent bg-ae-accent/15' : 'border-ae-border'}`}
                      style={{ color: role.color ?? undefined }}
                    >
                      {role.name}
                    </button>
                  );
                })}
            </div>
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-ae px-3 py-2 text-sm hover:bg-ae-hover" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={save.isPending} className="ae-press rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent">
            Save rule
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function AutomodTab({ server }: { server: Server }) {
  const { rules, save, remove } = useAutomod(server.id, true);
  const [editing, setEditing] = useState<Partial<AutomodRule> | null>(null);
  return (
    <div className="space-y-6">
      <Section title="Rules" description="AutoMod checks every new message before it's posted. People with Manage Server (and the owner) are never filtered.">
        {rules.length === 0 && <p className="text-sm text-ae-muted">No rules yet. Start with one of the templates below.</p>}
        <ul className="space-y-2">
          {rules.map((r) => {
            const t = TRIGGERS.find((x) => x.id === r.trigger)!;
            return (
              <li key={r.id} className="ae-enter flex items-center gap-3 rounded-ae border border-ae-border bg-ae-surface/30 px-3 py-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-ae bg-ae-sunken">{t.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{r.name}</span>
                  <span className="block truncate text-xs text-ae-muted">
                    {t.label} · {ACTIONS.find((a) => a.id === r.action)?.label}
                    {r.trigger === 'keyword' && r.keywords.length > 0 && ` · ${r.keywords.length} words`}
                  </span>
                </span>
                <Toggle label="" checked={r.enabled} onChange={(v) => save.mutate({ id: r.id, enabled: v })} />
                <button type="button" className="rounded-ae bg-ae-surface px-2.5 py-1 text-xs hover:bg-ae-hover" onClick={() => setEditing(r)}>
                  Edit
                </button>
                <button type="button" className="rounded-ae px-2 py-1 text-xs text-ae-danger hover:bg-ae-hover" onClick={async () => (await ask(`Delete “${r.name}”?`)) && remove.mutate(r.id)}>
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Add a rule">
        <div className="grid gap-2 sm:grid-cols-2">
          {TRIGGERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() =>
                setEditing({
                  trigger: t.id,
                  name: t.label,
                  ...(t.id === 'link' ? { allow_list: ['youtube.com', 'github.com'] } : {}),
                  ...(t.id === 'spam' ? { action: 'block_and_timeout', timeout_minutes: 5 } : {}),
                })
              }
              className="ae-lift flex items-start gap-3 rounded-ae border border-ae-border p-3 text-left hover:border-ae-accent"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ae bg-ae-sunken">{t.icon}</span>
              <span>
                <span className="block text-sm font-semibold">{t.label}</span>
                <span className="block text-xs text-ae-muted">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>
      {editing && <RuleEditor server={server} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function TransferOwnership({ server, userId }: { server: Server; userId: string }) {
  const sb = useSupabase();
  const { data: members = [] } = useServerMembers(server.id);
  const [to, setTo] = useState('');
  const others = useMemo(() => members.filter((m) => m.user_id !== userId), [members, userId]);
  if (server.owner_id !== userId) return null;
  return (
    <Section title="Transfer ownership" description="Give this server to another member. You'll lose owner powers, and you can't undo it yourself.">
      <div className="flex gap-2">
        <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose a member…</option>
          {others.map((m) => (
            <MemberOption key={m.user_id} userId={m.user_id} nickname={m.nickname} />
          ))}
        </select>
        <button
          type="button"
          disabled={!to}
          className="ae-press shrink-0 rounded-ae bg-ae-danger px-4 text-sm font-semibold text-white disabled:opacity-40"
          onClick={async () => {
            if (!(await ask('Transfer ownership? This is permanent unless the new owner gives it back.'))) return;
            const { error } = await sb.rpc('transfer_server', { p_server_id: server.id, p_new_owner: to });
            if (error) toast.error(error.message);
            else toast.success('Ownership transferred.', '👑');
          }}
        >
          Transfer
        </button>
      </div>
    </Section>
  );
}

function MemberOption({ userId, nickname }: { userId: string; nickname: string | null }) {
  const { data: p } = useProfile(userId);
  return <option value={userId}>{nickname || p?.display_name || p?.username || userId}</option>;
}
