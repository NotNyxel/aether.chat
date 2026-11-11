/**
 * Self-update (desktop only). Checks the signed GitHub Releases feed on startup and every 6 hours.
 * When a newer version exists, shows a small banner; one click downloads it, verifies its signature
 * against the public key built into the app, installs it and restarts.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import { APP_NAME } from '../config';
import { isTauri } from '../lib/platform';
import { CloseIcon } from './icons';

const FIRST_CHECK_MS = 8_000;
const CHECK_EVERY_MS = 6 * 3600_000;

type State =
  | { kind: 'idle' }
  | { kind: 'available'; update: Update }
  | { kind: 'downloading'; update: Update; received: number; total: number | null }
  | { kind: 'error'; message: string };

export function UpdateBanner() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [dismissed, setDismissed] = useState<string | null>(null);

  const checkNow = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) setState((s) => (s.kind === 'downloading' ? s : { kind: 'available', update }));
    } catch {
      // Offline or the feed is unreachable: stay quiet and try again later.
    }
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    const first = setTimeout(() => void checkNow(), FIRST_CHECK_MS);
    const every = setInterval(() => void checkNow(), CHECK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [checkNow]);

  const install = async (update: Update) => {
    setState({ kind: 'downloading', update, received: 0, total: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') setState({ kind: 'downloading', update, received: 0, total: event.data.contentLength ?? null });
        if (event.event === 'Progress')
          setState((s) => (s.kind === 'downloading' ? { ...s, received: s.received + event.data.chunkLength } : s));
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (state.kind === 'idle') return null;
  if (state.kind === 'available' && dismissed === state.update.version) return null;

  return (
    <div className="fixed right-4 bottom-4 z-[60] w-80 rounded-ae border border-ae-accent bg-ae-elevated p-4 shadow-2xl ae-glow" role="status">
      {state.kind === 'available' && (
        <>
          <div className="mb-1 flex items-start justify-between gap-2">
            <p className="font-semibold">Update available: v{state.update.version}</p>
            <button type="button" aria-label="Later" className="text-ae-muted hover:text-ae-text" onClick={() => setDismissed(state.update.version)}>
              <CloseIcon size={16} />
            </button>
          </div>
          {state.update.body && <p className="mb-3 line-clamp-4 text-xs whitespace-pre-line text-ae-muted">{state.update.body}</p>}
          <button
            type="button"
            onClick={() => void install(state.update)}
            className="w-full rounded-ae bg-ae-accent py-2 text-sm font-semibold text-ae-on-accent"
          >
            Update and restart {APP_NAME}
          </button>
        </>
      )}
      {state.kind === 'downloading' && (
        <>
          <p className="mb-2 text-sm font-semibold">Downloading v{state.update.version}…</p>
          <div className="h-2 overflow-hidden rounded-full bg-ae-sunken">
            <div
              className="h-full bg-ae-accent transition-[width]"
              style={{ width: state.total ? `${Math.min(100, (state.received / state.total) * 100)}%` : '35%' }}
            />
          </div>
          <p className="mt-2 text-xs text-ae-muted">The app will restart when the update is installed.</p>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <p className="text-sm font-semibold text-ae-danger">Update failed</p>
          <p className="mb-2 text-xs text-ae-muted">{state.message}</p>
          <button type="button" className="text-sm text-ae-accent hover:underline" onClick={() => setState({ kind: 'idle' })}>
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
