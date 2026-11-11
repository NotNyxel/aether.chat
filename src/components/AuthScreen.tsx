/**
 * Signed-out screens: sign in, sign up and "forgot password", plus the two-factor step and the
 * "choose a new password" step that follow a reset link.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { APP_NAME } from '../config';
import { authRedirectUrl } from '../lib/authLinks';
import { useSupabase } from '../lib/supabase';

const input = 'w-full rounded-ae border border-ae-border bg-ae-sunken px-3 py-2.5 text-sm outline-none transition-colors focus:border-ae-accent';

function Shell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="relative grid h-full place-items-center overflow-hidden p-6">
      {/* drifting accent orbs behind the card */}
      <div aria-hidden className="ae-auth-orb pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-ae-accent opacity-20 blur-3xl" />
      <div aria-hidden className="ae-auth-orb pointer-events-none absolute -right-24 -bottom-40 h-[28rem] w-[28rem] rounded-full bg-ae-accent opacity-10 blur-3xl [animation-delay:-7s]" />
      <div className="ae-dialog ae-panel relative w-full max-w-sm space-y-5 rounded-[calc(var(--ae-radius)+6px)] border border-ae-border p-8 shadow-2xl">
        <header className="space-y-1 text-center">
          <img src="/icon.svg" alt="" className="mx-auto mb-3 h-14 w-14 drop-shadow-[0_0_18px_var(--ae-accent)]" draggable={false} />
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-ae-muted">{subtitle}</p>
        </header>
        {children}
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        className={`${input} pr-16`}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        minLength={6}
        required
      />
      <button type="button" className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-ae-muted hover:text-ae-text" onClick={() => setShow((v) => !v)}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy} className="ae-press w-full rounded-ae bg-ae-accent py-2.5 text-sm font-semibold text-ae-on-accent shadow-lg disabled:opacity-40">
      {busy ? 'Please wait…' : children}
    </button>
  );
}

export function AuthScreen({ linkError }: { linkError?: string | null }) {
  const sb = useSupabase();
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(linkError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setError(linkError ?? null), [linkError]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        const { error: err } = await sb.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else if (mode === 'signup') {
        if (!/^[A-Za-z0-9_.]{2,32}$/.test(username)) throw new Error('Usernames are 2–32 characters: letters, numbers, _ and .');
        const { data, error: err } = await sb.auth.signUp({
          email,
          password,
          options: { data: { username, display_name: username }, emailRedirectTo: authRedirectUrl() },
        });
        if (err) throw err;
        if (!data.session) setNotice(`We emailed a confirmation link to ${email}. Open it on this computer and ${APP_NAME} signs you straight in.`);
      } else {
        const { error: err } = await sb.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() });
        if (err) throw err;
        setNotice(`If ${email} has an account, a reset link is on its way. Open it on this computer to choose a new password.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const titles = { signin: 'Welcome back', signup: `Join ${APP_NAME}`, reset: 'Forgot your password?' };
  const subtitles = {
    signin: 'Peer-to-peer voice and video. No servers in the middle.',
    signup: 'Create an account. It takes ten seconds.',
    reset: "Enter your email and we'll send you a reset link.",
  };

  return (
    <Shell title={titles[mode]} subtitle={subtitles[mode]}>
      <form onSubmit={submit} className="space-y-3">
        {mode === 'signup' && (
          <input className={input} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        )}
        <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        {mode !== 'reset' && (
          <PasswordInput value={password} onChange={setPassword} placeholder="Password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
        )}
        {mode === 'signin' && (
          <button type="button" className="text-xs text-ae-accent hover:underline" onClick={() => setMode('reset')}>
            Forgot your password?
          </button>
        )}

        {error && <p className="ae-enter rounded-ae bg-ae-danger/10 px-3 py-2 text-sm text-ae-danger">{error}</p>}
        {notice && <p className="ae-enter rounded-ae bg-ae-success/10 px-3 py-2 text-sm text-ae-success">{notice}</p>}

        <Submit busy={busy}>{mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}</Submit>
      </form>

      <p className="text-center text-sm text-ae-muted">
        {mode === 'signin' ? 'New here? ' : mode === 'signup' ? 'Already have an account? ' : 'Remembered it? '}
        <button
          type="button"
          className="text-ae-accent hover:underline"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setNotice(null);
          }}
        >
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </Shell>
  );
}

/** Second step of sign-in when the account has an authenticator app. */
export function MfaChallenge({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const sb = useSupabase();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data: factors, error: fErr } = await sb.auth.mfa.listFactors();
      if (fErr) throw fErr;
      const factor = factors.totp.find((f) => f.status === 'verified');
      if (!factor) throw new Error('No authenticator is set up for this account.');
      const { error: vErr } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s/g, '') });
      if (vErr) throw vErr;
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Two-factor authentication" subtitle="Enter the 6-digit code from your authenticator app.">
      <form onSubmit={submit} className="space-y-3">
        <input
          className={`${input} text-center font-mono text-2xl tracking-[0.5em]`}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={7}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
        />
        {error && <p className="ae-enter rounded-ae bg-ae-danger/10 px-3 py-2 text-sm text-ae-danger">{error}</p>}
        <Submit busy={busy}>Verify</Submit>
      </form>
      <button type="button" className="w-full text-center text-sm text-ae-muted hover:text-ae-text" onClick={onCancel}>
        Use a different account
      </button>
    </Shell>
  );
}

/** After a password-reset link: pick the new password. */
export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const sb = useSupabase();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else onDone();
  };

  return (
    <Shell title="Choose a new password" subtitle="You're signed in from your reset link. Pick a new password to finish.">
      <form onSubmit={submit} className="space-y-3">
        <PasswordInput value={password} onChange={setPassword} placeholder="New password" autoComplete="new-password" />
        <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repeat it" autoComplete="new-password" />
        {error && <p className="ae-enter rounded-ae bg-ae-danger/10 px-3 py-2 text-sm text-ae-danger">{error}</p>}
        <Submit busy={busy}>Save password</Submit>
      </form>
    </Shell>
  );
}
