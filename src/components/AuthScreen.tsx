/** Email and password sign-in and sign-up against Supabase Auth. */
import { useState, type FormEvent } from 'react';
import { useSupabase } from '../lib/supabase';
import { APP_NAME } from '../config';

export function AuthScreen() {
  const sb = useSupabase();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === 'signin') {
      const { error: err } = await sb.auth.signInWithPassword({ email, password });
      if (err) setError(err.message);
    } else {
      if (!/^[A-Za-z0-9_.]{2,32}$/.test(username)) {
        setError('Usernames are 2–32 characters: letters, numbers, _ and .');
        setBusy(false);
        return;
      }
      const { data, error: err } = await sb.auth.signUp({
        email,
        password,
        options: { data: { username, display_name: username } },
      });
      if (err) setError(err.message);
      else if (!data.session) setNotice('Check your inbox to confirm your email, then sign in.');
    }
    setBusy(false);
  };

  const input = 'w-full rounded-ae border border-ae-border bg-ae-sunken px-3 py-2 text-sm outline-none focus:border-ae-accent';

  return (
    <div className="grid h-full place-items-center p-6">
      <form onSubmit={submit} className="ae-panel w-full max-w-sm space-y-4 rounded-ae border border-ae-border p-8 shadow-2xl">
        <header className="space-y-1 text-center">
          <img src="/icon.svg" alt="" className="mx-auto mb-2 h-14 w-14" draggable={false} />
          <h1 className="text-2xl font-bold">{mode === 'signin' ? 'Welcome back' : `Join ${APP_NAME}`}</h1>
          <p className="text-sm text-ae-muted">Peer-to-peer voice and video. No servers in the middle.</p>
        </header>

        {mode === 'signup' && (
          <input className={input} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        )}
        <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <input
          className={input}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          minLength={6}
          required
        />

        {error && <p className="text-sm text-ae-danger">{error}</p>}
        {notice && <p className="text-sm text-ae-success">{notice}</p>}

        <button type="submit" disabled={busy} className="w-full rounded-ae bg-ae-accent py-2.5 text-sm font-semibold text-ae-on-accent disabled:opacity-40">
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>

        <p className="text-center text-sm text-ae-muted">
          {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
          <button type="button" className="text-ae-accent hover:underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </form>
    </div>
  );
}
