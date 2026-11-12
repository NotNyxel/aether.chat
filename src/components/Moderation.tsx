/**
 * Platform moderation, as the person being moderated sees it:
 *   - ModerationGate: a banned account sees BannedScreen (with an appeal form) instead of the app
 *   - WarningNotice: a one-time notice for new warnings
 *   - AccountStanding: Settings → Account Standing, with the danger meter and active warnings
 * The rules live in supabase/migrations/011_moderation.sql; this file only displays them.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useSupabase } from '../lib/supabase';
import { BannedIcon, CheckIcon, ClockIcon, LogOutIcon, ScaleIcon, SendIcon, WarningIcon } from './icons';
import { toast } from './Toaster';

export type DangerLevel = 'good' | 'low' | 'medium' | 'high' | 'critical';

export const LEVELS: { id: DangerLevel; label: string; color: string; blurb: string }[] = [
  { id: 'good', label: 'Good', color: '#3ba55d', blurb: "You're in good standing. Thanks for helping keep aether.chat a good place." },
  { id: 'low', label: 'Low', color: '#c9b52c', blurb: "You have a warning on your account. Nothing is limited, but keep the rules in mind." },
  { id: 'medium', label: 'Medium', color: '#e8912d', blurb: 'Several warnings are active. More violations can lead to a ban.' },
  { id: 'high', label: 'High', color: '#e5484d', blurb: 'Your account is at risk. Another violation will likely lead to a ban.' },
  { id: 'critical', label: 'Critical', color: '#a51d2d', blurb: 'Your account is one step away from a ban.' },
];
export const levelInfo = (id: string | null | undefined) => LEVELS.find((l) => l.id === id) ?? LEVELS[0]!;

export const WARNING_CATEGORIES: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  hate: 'Hateful conduct',
  nsfw: 'Explicit content',
  scam: 'Scams or phishing',
  impersonation: 'Impersonation',
  self_harm: 'Self-harm content',
  violence: 'Violence or threats',
  evasion: 'Ban or block evasion',
  other: 'Other violation',
};

export interface Ban {
  id: string;
  reason: string;
  created_at: string;
  expires_at: string | null;
}
interface Appeal {
  status: 'open' | 'accepted' | 'denied';
  response: string | null;
  created_at: string;
}
export interface WarningRow {
  id: string;
  category: string;
  details: string | null;
  severity: number;
  created_at: string;
  expires_at: string | null;
  active?: boolean;
}
interface MyModeration {
  ban: Ban | null;
  appeal: Appeal | null;
  level: DangerLevel;
  points: number;
  unacknowledged: WarningRow[];
}

export const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export function untilText(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'any moment now';
  const h = ms / 3600_000;
  if (h < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `in ${Math.round(h)} h`;
  return `in ${Math.round(h / 24)} days`;
}

export function useMyModeration(enabled = true) {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['my-moderation'],
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await sb.rpc('my_moderation');
      if (error) throw new Error(error.message);
      return data as MyModeration | null;
    },
  });
}

/** Five-step danger meter. */
export function StandingMeter({ level, compact = false }: { level: DangerLevel; compact?: boolean }) {
  const idx = LEVELS.findIndex((l) => l.id === level);
  return (
    <div>
      <div className="flex gap-1">
        {LEVELS.map((l, i) => (
          <span
            key={l.id}
            className={`relative h-2 flex-1 rounded-full transition-colors ${i === idx ? 'ae-standing-on' : ''}`}
            style={{ background: i <= idx ? l.color : 'var(--ae-surface)', opacity: i <= idx ? 1 : 0.7 }}
          />
        ))}
      </div>
      {!compact && (
        <div className="mt-1.5 flex text-[11px] text-ae-muted">
          {LEVELS.map((l, i) => (
            <span key={l.id} className={`flex-1 text-center ${i === idx ? 'font-bold' : ''}`} style={i === idx ? { color: l.color } : undefined}>
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function LevelChip({ level }: { level: string }) {
  const l = levelInfo(level);
  return (
    <span className="rounded px-1.5 py-px text-[10px] font-bold uppercase" style={{ color: l.color, background: `color-mix(in srgb, ${l.color} 16%, transparent)` }}>
      {l.label}
    </span>
  );
}

/** Wraps the app: banned accounts see the ban screen; new warnings get a notice. */
export function ModerationGate({ onSignOut, children, splash, frame }: { onSignOut: () => void; children: ReactNode; splash: ReactNode; frame: (n: ReactNode) => ReactNode }) {
  const { data, isLoading, isError } = useMyModeration();
  if (isLoading) return <>{splash}</>;
  // If the check itself fails (offline), don't lock anyone out; the server still enforces bans.
  if (!isError && data?.ban) return <>{frame(<BannedScreen ban={data.ban} appeal={data.appeal} onSignOut={onSignOut} />)}</>;
  return (
    <>
      {children}
      {data && data.unacknowledged.length > 0 && <WarningNotice warnings={data.unacknowledged} level={data.level} />}
    </>
  );
}

function BannedScreen({ ban, appeal, onSignOut }: { ban: Ban; appeal: Appeal | null; onSignOut: () => void }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const canAppeal = !appeal || appeal.status === 'denied';
  const submit = async () => {
    if (text.trim().length < 10) return toast.error('Tell us a little more (at least 10 characters).');
    setBusy(true);
    const { error } = await sb.rpc('submit_ban_appeal', { p_message: text.trim() });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Appeal sent. An admin will review it.');
    setText('');
    void qc.invalidateQueries({ queryKey: ['my-moderation'] });
  };

  return (
    <div className="ae-scroll grid h-full place-items-center overflow-y-auto p-6">
      <div className="ae-enter w-full max-w-lg overflow-hidden rounded-[calc(var(--ae-radius)+6px)] border border-ae-border bg-ae-elevated shadow-2xl">
        <div className="relative overflow-hidden bg-gradient-to-br from-ae-danger/30 via-ae-danger/10 to-transparent px-7 pt-7 pb-5">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ae-danger/20 text-ae-danger">
            <BannedIcon size={30} />
          </span>
          <h1 className="mt-4 text-2xl font-extrabold">Your account is {ban.expires_at ? 'suspended' : 'banned'}</h1>
          <p className="mt-1 text-sm text-ae-muted">
            {ban.expires_at ? (
              <>
                You can use aether.chat again on <b className="text-ae-text">{new Date(ban.expires_at).toLocaleString()}</b> ({untilText(ban.expires_at)}).
              </>
            ) : (
              'This ban is permanent unless an appeal is accepted.'
            )}
          </p>
        </div>
        <div className="space-y-5 px-7 py-6">
          <div>
            <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">Reason</p>
            <p className="mt-1 rounded-ae border border-ae-border bg-ae-sunken/60 px-3 py-2 text-sm whitespace-pre-wrap">{ban.reason}</p>
            <p className="mt-1 text-xs text-ae-muted">Issued {fmtDate(ban.created_at)}</p>
          </div>

          {appeal && (
            <div
              className={`flex items-start gap-3 rounded-ae border px-3 py-2.5 text-sm ${
                appeal.status === 'open' ? 'border-ae-accent/40 bg-ae-accent/10' : appeal.status === 'denied' ? 'border-ae-danger/40 bg-ae-danger/10' : 'border-ae-success/40 bg-ae-success/10'
              }`}
            >
              {appeal.status === 'open' ? <ClockIcon size={17} className="mt-0.5 shrink-0 text-ae-accent" /> : <ScaleIcon size={17} className="mt-0.5 shrink-0" />}
              <div>
                <p className="font-semibold">
                  {appeal.status === 'open' ? 'Your appeal is waiting for review' : appeal.status === 'denied' ? 'Your appeal was denied' : 'Your appeal was accepted'}
                </p>
                <p className="text-xs text-ae-muted">Sent {fmtDate(appeal.created_at)}</p>
                {appeal.response && <p className="mt-1 text-sm">“{appeal.response}”</p>}
                {appeal.status === 'denied' && <p className="mt-1 text-xs text-ae-muted">You can appeal again 7 days after the decision.</p>}
              </div>
            </div>
          )}

          {canAppeal && (
            <div>
              <p className="text-sm font-semibold">Appeal this decision</p>
              <p className="mb-2 text-xs text-ae-muted">Explain why you think the ban should be lifted. Be honest and specific; admins read every appeal.</p>
              <textarea className="ae-input min-h-28 w-full text-sm" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened, and why should we reconsider?" />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-ae-muted tabular-nums">{text.length} / 2000</span>
                <button
                  type="button"
                  disabled={busy || text.trim().length < 10}
                  onClick={() => void submit()}
                  className="ae-press flex items-center gap-1.5 rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-40"
                >
                  <SendIcon size={15} /> Send appeal
                </button>
              </div>
            </div>
          )}

          <button type="button" onClick={onSignOut} className="flex items-center gap-2 text-sm text-ae-muted hover:text-ae-text">
            <LogOutIcon size={15} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function WarningNotice({ warnings, level }: { warnings: WarningRow[]; level: DangerLevel }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const ack = async () => {
    setBusy(true);
    await sb.rpc('acknowledge_warnings');
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ['my-moderation'] });
    void qc.invalidateQueries({ queryKey: ['my-warnings'] });
  };
  const info = levelInfo(level);
  return (
    <div className="ae-backdrop fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4">
      <div role="alertdialog" aria-modal="true" className="ae-dialog w-full max-w-md overflow-hidden rounded-[calc(var(--ae-radius)+6px)] border border-ae-border bg-ae-elevated shadow-2xl">
        <div className="px-6 pt-6">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ae-warning/15 text-ae-warning">
            <WarningIcon size={26} />
          </span>
          <h2 className="mt-3 text-xl font-extrabold">{warnings.length === 1 ? 'Your account received a warning' : `Your account received ${warnings.length} warnings`}</h2>
          <p className="mt-1 text-sm text-ae-muted">An admin found activity on your account that breaks aether.chat&apos;s rules.</p>
        </div>
        <ul className="ae-scroll mt-4 max-h-56 space-y-2 overflow-y-auto px-6">
          {warnings.map((w) => (
            <li key={w.id} className="rounded-ae border border-ae-border bg-ae-sunken/50 px-3 py-2">
              <p className="flex items-center justify-between gap-2 text-sm font-semibold">
                {WARNING_CATEGORIES[w.category] ?? w.category}
                <span className="text-xs font-normal text-ae-muted">{fmtDate(w.created_at)}</span>
              </p>
              {w.details && <p className="mt-0.5 text-sm text-ae-muted">{w.details}</p>}
            </li>
          ))}
        </ul>
        <div className="mt-4 px-6">
          <p className="mb-2 text-xs font-bold tracking-wide text-ae-muted uppercase">
            Account standing: <span style={{ color: info.color }}>{info.label}</span>
          </p>
          <StandingMeter level={level} compact />
          <p className="mt-2 text-xs text-ae-muted">{info.blurb}</p>
        </div>
        <div className="mt-5 flex justify-end border-t border-ae-border bg-ae-sunken/40 px-6 py-3">
          <button type="button" disabled={busy} onClick={() => void ack()} className="ae-press flex items-center gap-1.5 rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent disabled:opacity-50">
            <CheckIcon size={15} /> I understand
          </button>
        </div>
      </div>
    </div>
  );
}

/** Settings → Account Standing. */
export function AccountStanding() {
  const sb = useSupabase();
  const { data: me } = useMyModeration();
  const { data: warnings = [] } = useQuery({
    queryKey: ['my-warnings'],
    queryFn: async () => {
      const { data, error } = await sb.rpc('my_warnings');
      if (error) throw new Error(error.message);
      return data as WarningRow[];
    },
  });
  const level = me?.level ?? 'good';
  const info = levelInfo(level);
  const active = warnings.filter((w) => w.active);
  const past = warnings.filter((w) => !w.active);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-ae-muted">How your account is doing against aether.chat&apos;s rules. Warnings count toward your standing until they expire.</p>
      </div>
      <div className="rounded-[calc(var(--ae-radius)+4px)] border border-ae-border bg-ae-surface/30 p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${info.color} 18%, transparent)`, color: info.color }}>
            {level === 'good' ? <CheckIcon size={22} /> : <WarningIcon size={22} />}
          </span>
          <div>
            <p className="text-lg font-bold" style={{ color: info.color }}>
              {level === 'good' ? 'All good!' : `${info.label} risk`}
            </p>
            <p className="text-sm text-ae-muted">{info.blurb}</p>
          </div>
        </div>
        <StandingMeter level={level} />
      </div>
      <div>
        <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Active warnings · {active.length}</p>
        {active.length === 0 ? (
          <p className="rounded-ae border border-dashed border-ae-border px-4 py-6 text-center text-sm text-ae-muted">No active warnings. Keep it up.</p>
        ) : (
          <ul className="space-y-2">
            {active.map((w) => (
              <WarningItem key={w.id} w={w} />
            ))}
          </ul>
        )}
      </div>
      {past.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold tracking-wide text-ae-muted uppercase">Expired · {past.length}</p>
          <ul className="space-y-2 opacity-70">
            {past.map((w) => (
              <WarningItem key={w.id} w={w} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function WarningItem({ w }: { w: WarningRow }) {
  return (
    <li className="rounded-ae border border-ae-border bg-ae-surface/20 px-4 py-3">
      <div className="flex items-center gap-2">
        <WarningIcon size={15} className="text-ae-warning" />
        <span className="font-semibold">{WARNING_CATEGORIES[w.category] ?? w.category}</span>
        <span className="ml-auto text-xs text-ae-muted">{fmtDate(w.created_at)}</span>
      </div>
      {w.details && <p className="mt-1 text-sm text-ae-muted">{w.details}</p>}
      <p className="mt-1 text-xs text-ae-muted">{w.expires_at ? (w.active ? `Expires ${fmtDate(w.expires_at)}` : `Expired ${fmtDate(w.expires_at)}`) : "Doesn't expire"}</p>
    </li>
  );
}
