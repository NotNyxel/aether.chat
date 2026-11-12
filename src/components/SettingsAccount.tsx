/**
 * Settings → My Account (email, password, two-factor, sessions, data export, delete account)
 * and Settings → Privacy & Safety (DMs, friend requests, message requests, blocked users).
 */
import { DownloadIcon, LockIcon, UnlockIcon } from './icons';
import { ask } from './ConfirmDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useProfile, useUpdateProfile } from '../hooks/useChatData';
import { DEFAULT_PRIVACY, usePrivacySettings, useSavePrivacy } from '../hooks/useAccount';
import { useBlocks, useFriendActions } from '../hooks/useSocialData';
import { authRedirectUrl } from '../lib/authLinks';
import { isTauri } from '../lib/platform';
import { useSupabase } from '../lib/supabase';
import { Dialog } from './Dialog';
import { Avatar } from './ProfileCard';
import { inputCls, Section, Toggle } from './SettingsPanel';
import { toast } from './Toaster';

const btn = 'ae-press rounded-ae px-3 py-2 text-sm font-semibold disabled:opacity-40';

function Row({ title, value, action }: { title: string; value: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold tracking-wide text-ae-muted uppercase">{title}</p>
        <div className="truncate text-sm">{value}</div>
      </div>
      {action}
    </div>
  );
}

function ChangeEmail({ current, onClose }: { current: string; onClose: () => void }) {
  const sb = useSupabase();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  return (
    <Dialog title="Change email" onClose={onClose}>
      {sent ? (
        <div className="space-y-3 text-sm">
          <p>
            We sent confirmation links to <b>{current}</b> and <b>{email}</b>. Open both on this computer to finish. Your email changes once both are
            confirmed.
          </p>
          <button type="button" className={`${btn} w-full bg-ae-accent text-ae-on-accent`} onClick={onClose}>
            Got it
          </button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const { error: err } = await sb.auth.updateUser({ email }, { emailRedirectTo: authRedirectUrl() });
            setBusy(false);
            if (err) setError(err.message);
            else setSent(true);
          }}
        >
          <input className={inputCls} type="email" required autoFocus placeholder="New email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p className="text-xs text-ae-danger">{error}</p>}
          <button type="submit" disabled={busy || !email} className={`${btn} w-full bg-ae-accent text-ae-on-accent`}>
            {busy ? 'Sending…' : 'Send confirmation'}
          </button>
        </form>
      )}
    </Dialog>
  );
}

function ChangePassword({ email, onClose }: { email: string; onClose: () => void }) {
  const sb = useSupabase();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Change password" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (next !== confirm) return setError("The new passwords don't match.");
          if (next.length < 6) return setError('Use at least 6 characters.');
          setBusy(true);
          setError(null);
          // Re-check the current password first, so an unattended session can't change it.
          const check = await sb.auth.signInWithPassword({ email, password: current });
          const { error: err } = check.error ? check : await sb.auth.updateUser({ password: next });
          setBusy(false);
          if (err) setError(check.error ? 'Your current password is wrong.' : err.message);
          else {
            toast.success('Password changed.');
            onClose();
          }
        }}
      >
        <input className={inputCls} type="password" required autoFocus placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className={inputCls} type="password" required placeholder="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <input className={inputCls} type="password" required placeholder="Repeat new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p className="text-xs text-ae-danger">{error}</p>}
        <button type="submit" disabled={busy} className={`${btn} w-full bg-ae-accent text-ae-on-accent`}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </Dialog>
  );
}

function TwoFactor() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const factors = useQuery({
    queryKey: ['mfa-factors'],
    queryFn: async () => {
      const { data, error } = await sb.auth.mfa.listFactors();
      if (error) throw new Error(error.message);
      return data.totp;
    },
  });
  const verified = factors.data?.find((f) => f.status === 'verified');
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setBusy(true);
    // Drop half-finished enrolments so they don't pile up.
    for (const f of factors.data ?? []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error: err } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Aether ${new Date().toLocaleDateString()}` });
    setBusy(false);
    if (err) return setError(err.message);
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const finish = async () => {
    if (!enroll) return;
    setBusy(true);
    setError(null);
    const { error: err } = await sb.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.replace(/\s/g, '') });
    setBusy(false);
    if (err) return setError(err.message);
    setEnroll(null);
    setCode('');
    toast.success('Two-factor authentication is on.', <LockIcon size={14} />);
    void qc.invalidateQueries({ queryKey: ['mfa-factors'] });
  };

  const disable = async () => {
    if (!verified || !(await ask('Turn off two-factor authentication? Your account will only be protected by your password.'))) return;
    const { error: err } = await sb.auth.mfa.unenroll({ factorId: verified.id });
    if (err) return toast.error(err.message);
    toast('Two-factor authentication is off.', <UnlockIcon size={14} />);
    void qc.invalidateQueries({ queryKey: ['mfa-factors'] });
  };

  return (
    <Section title="Two-factor authentication" description="Protect your account with a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password, Bitwarden…) at sign-in.">
      {verified ? (
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-ae-success/15 px-3 py-1 text-sm font-semibold text-ae-success"><LockIcon size={15} className="ae-ico" /> Enabled</span>
          <button type="button" className={`${btn} bg-ae-surface hover:bg-ae-hover`} onClick={() => void disable()}>
            Remove authenticator
          </button>
        </div>
      ) : enroll ? (
        <div className="ae-enter flex flex-wrap items-start gap-5">
          <img src={enroll.qr} alt="QR code for your authenticator app" className="h-44 w-44 rounded-ae bg-white p-2" />
          <div className="min-w-0 flex-1 space-y-3 text-sm">
            <p>1. Scan this QR code with your authenticator app.</p>
            <p className="text-ae-muted">
              Can&apos;t scan? Enter this key: <code className="rounded bg-ae-sunken px-1.5 py-0.5 font-mono text-xs break-all">{enroll.secret}</code>
            </p>
            <p>2. Type the 6-digit code it shows:</p>
            <div className="flex gap-2">
              <input
                className={`${inputCls} !w-40 shrink-0 text-center font-mono text-lg tracking-[0.3em]`}
                inputMode="numeric"
                maxLength={7}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
              />
              <button type="button" disabled={busy || code.replace(/\s/g, '').length !== 6} className={`${btn} bg-ae-accent text-ae-on-accent`} onClick={() => void finish()}>
                Activate
              </button>
              <button type="button" className={`${btn} text-ae-muted`} onClick={() => setEnroll(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" disabled={busy || factors.isLoading} className={`${btn} bg-ae-accent text-ae-on-accent`} onClick={() => void start()}>
          Set up authenticator app
        </button>
      )}
      {error && <p className="text-xs text-ae-danger">{error}</p>}
    </Section>
  );
}

function DeleteAccount({ email, onClose }: { email: string; onClose: () => void }) {
  const sb = useSupabase();
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Delete account" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="rounded-ae bg-ae-danger/10 px-3 py-2 text-ae-danger">
          This permanently deletes your account, profile, friends, notes and settings. Your messages stay in their chats as “Deleted user”. It can&apos;t be
          undone. Servers you own must be transferred or deleted first.
        </p>
        <input className={inputCls} type="password" placeholder="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <input className={inputCls} placeholder='Type "DELETE" to confirm' value={typed} onChange={(e) => setTyped(e.target.value)} />
        {error && <p className="text-xs text-ae-danger">{error}</p>}
        <button
          type="button"
          disabled={busy || typed !== 'DELETE' || !password}
          className={`${btn} w-full bg-ae-danger text-white`}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const check = await sb.auth.signInWithPassword({ email, password });
            if (check.error) {
              setBusy(false);
              return setError('Wrong password.');
            }
            const { error: err } = await sb.rpc('delete_my_account');
            setBusy(false);
            if (err) return setError(err.message);
            await sb.auth.signOut({ scope: 'local' });
          }}
        >
          {busy ? 'Deleting…' : 'Delete my account forever'}
        </button>
      </div>
    </Dialog>
  );
}

async function exportData(sb: ReturnType<typeof useSupabase>) {
  const { data, error } = await sb.rpc('export_my_data');
  if (error) throw new Error(error.message);
  const json = JSON.stringify(data, null, 2);
  const name = `aether.chat-data-${new Date().toISOString().slice(0, 10)}.json`;
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('save_export', { fileName: name, contents: json });
    return path;
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}

export function AccountTab({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  const sb = useSupabase();
  const { data: profile } = useProfile(userId);
  const { data: user } = useQuery({ queryKey: ['auth-user'], queryFn: async () => (await sb.auth.getUser()).data.user });
  const [dialog, setDialog] = useState<null | 'email' | 'password' | 'delete'>(null);
  const [exporting, setExporting] = useState(false);
  const email = user?.email ?? '';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 rounded-ae border border-ae-border bg-ae-surface/40 p-4">
        <Avatar profile={profile} size={64} />
        <div className="min-w-0">
          <p className="text-lg font-bold">{profile?.display_name || profile?.username}</p>
          <p className="text-sm text-ae-muted">@{profile?.username}</p>
        </div>
      </div>

      <Section title="Sign-in">
        <Row
          title="Email"
          value={email || '…'}
          action={
            <button type="button" className={`${btn} bg-ae-surface hover:bg-ae-hover`} onClick={() => setDialog('email')}>
              Change
            </button>
          }
        />
        {user?.new_email && <p className="text-xs text-ae-warning">Waiting for you to confirm {user.new_email}.</p>}
        <Row
          title="Password"
          value="••••••••"
          action={
            <button type="button" className={`${btn} bg-ae-surface hover:bg-ae-hover`} onClick={() => setDialog('password')}>
              Change
            </button>
          }
        />
        <Row
          title="Sessions"
          value="Signed in on this device"
          action={
            <button
              type="button"
              className={`${btn} bg-ae-surface hover:bg-ae-hover`}
              onClick={async () => {
                if (!(await ask('Sign out on every device, including this one?'))) return;
                await sb.auth.signOut({ scope: 'global' });
                onSignOut();
              }}
            >
              Sign out everywhere
            </button>
          }
        />
      </Section>

      <TwoFactor />

      <Section title="Your data" description="Download a copy of your profile, settings, servers, friends, notes, and every message you've sent (JSON).">
        <button
          type="button"
          disabled={exporting}
          className={`${btn} bg-ae-surface hover:bg-ae-hover`}
          onClick={async () => {
            setExporting(true);
            try {
              const where = await exportData(sb);
              if (where) toast.success(`Saved ${where}`, <DownloadIcon size={14} />);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e));
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? 'Preparing…' : <><DownloadIcon size={15} className="ae-ico" /> Download my data</>}
        </button>
      </Section>

      <Section title="Danger zone">
        <button type="button" className={`${btn} bg-ae-danger text-white`} onClick={() => setDialog('delete')}>
          Delete account
        </button>
      </Section>

      {dialog === 'email' && <ChangeEmail current={email} onClose={() => setDialog(null)} />}
      {dialog === 'password' && <ChangePassword email={email} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteAccount email={email} onClose={() => setDialog(null)} />}
    </div>
  );
}

function BlockedRow({ userId, onUnblock }: { userId: string; onUnblock: () => void }) {
  const { data: p } = useProfile(userId);
  return (
    <li className="flex items-center gap-3 rounded-ae px-2 py-1.5 hover:bg-ae-hover">
      <Avatar profile={p} size={28} showFrame={false} />
      <span className="flex-1 truncate text-sm">{p?.display_name || p?.username || '…'}</span>
      <button type="button" className="rounded-ae bg-ae-surface px-2.5 py-1 text-xs hover:bg-ae-hover" onClick={onUnblock}>
        Unblock
      </button>
    </li>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; hint: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="space-y-1.5">
      {options.map((o) => (
        <label
          key={o.id}
          className={`flex cursor-pointer items-start gap-3 rounded-ae border p-2.5 transition-colors ${value === o.id ? 'border-ae-accent bg-ae-accent/10' : 'border-ae-border hover:bg-ae-hover'}`}
        >
          <input type="radio" className="mt-1" checked={value === o.id} onChange={() => onChange(o.id)} />
          <span>
            <span className="block text-sm font-semibold">{o.label}</span>
            <span className="block text-xs text-ae-muted">{o.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function PrivacyTab({ userId }: { userId: string }) {
  const { data: row } = usePrivacySettings(userId);
  const save = useSavePrivacy(userId);
  const { data: blocks = [] } = useBlocks();
  const friend = useFriendActions();
  const p = { ...DEFAULT_PRIVACY, ...(row ?? {}) };
  const set = (patch: Partial<typeof DEFAULT_PRIVACY>) =>
    save.mutate(patch, { onSuccess: () => toast.success('Privacy settings saved.'), onError: (e) => toast.error(e.message) });

  return (
    <div className="space-y-6">
      <Section title="Direct messages" description="Who can start a new DM with you. Existing friends can always message you.">
        <Choice
          value={p.dm_policy}
          onChange={(v) => set({ dm_policy: v })}
          options={[
            { id: 'everyone', label: 'Everyone', hint: 'Anyone can message you. People you don’t know land in Message requests, limited to a few messages until you accept.' },
            { id: 'servers', label: 'Friends and server members', hint: 'Anyone you share a server with can message you.' },
            { id: 'friends', label: 'Friends only', hint: 'Server members can’t start DMs with you, and existing non-friend DMs become read-only.' },
          ]}
        />
        <Toggle
          label="Message requests"
          hint="DMs from people who aren't your friends go to “Message requests” first. Accept to move them into your DMs."
          checked={p.message_requests}
          onChange={(v) => set({ message_requests: v })}
        />
      </Section>

      <Section title="Discovery">
        <DiscoverableToggle userId={userId} />
      </Section>

      <Section title="Friend requests" description="Who can send you a friend request.">
        <Choice
          value={p.friend_request_policy}
          onChange={(v) => set({ friend_request_policy: v })}
          options={[
            { id: 'everyone', label: 'Everyone', hint: 'Anyone who knows your username.' },
            { id: 'mutuals', label: 'Server members and friends of friends', hint: 'People you share a server or a friend with.' },
            { id: 'nobody', label: 'No one', hint: 'You can still send requests yourself.' },
          ]}
        />
      </Section>

      <Section title={`Blocked users (${blocks.length})`} description="Blocked people can't message you, call you or send friend requests, and you won't see their DMs.">
        {blocks.length === 0 ? (
          <p className="text-sm text-ae-muted">You haven&apos;t blocked anyone.</p>
        ) : (
          <ul className="space-y-0.5">
            {blocks.map((b) => (
              <BlockedRow key={b.blocked_id} userId={b.blocked_id} onUnblock={() => friend.unblock.mutate(b.blocked_id)} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Safety tips">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ae-muted">
          <li>Right-click any message or user to report them to the server&apos;s moderators.</li>
          <li>Turn on two-factor authentication in My Account.</li>
          <li>Aether staff will never ask for your password.</li>
        </ul>
      </Section>
    </div>
  );
}

function DiscoverableToggle({ userId }: { userId: string }) {
  const { data: me } = useProfile(userId);
  const update = useUpdateProfile(userId);
  return (
    <Toggle
      label="Let people find me in search"
      hint="When on, anyone can find you by username or display name in “Search for someone”. Friends can always find you."
      checked={me?.discoverable ?? true}
      onChange={(v) => update.mutate({ discoverable: v }, { onSuccess: () => toast.success(v ? 'You can be found in search.' : 'You’re hidden from search.'), onError: (e) => toast.error(e.message) })}
    />
  );
}
