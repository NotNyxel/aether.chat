/**
 * Updates while the app is running (desktop only). Startup updates happen in the startup window
 * (splash.ts) before the app opens; this covers long sessions. Every few hours it checks the signed
 * feed, downloads a newer version in the background, then offers a one-click restart. If you ignore
 * it, the startup window installs it the next time Aether opens.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import { isTauri } from '../lib/platform';
import { CloseIcon, DownloadIcon } from './icons';

const FIRST_CHECK_MS = 30 * 60_000;
const CHECK_EVERY_MS = 3 * 3600_000;

type State = { kind: 'idle' } | { kind: 'ready'; update: Update } | { kind: 'installing'; version: string } | { kind: 'error'; message: string };

export function UpdateBanner() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [hidden, setHidden] = useState(false);
  const busy = useRef(false);

  const checkNow = useCallback(async () => {
    if (!isTauri || busy.current) return;
    busy.current = true;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check({ timeout: 20_000 });
      if (!update) return;
      await update.download();
      setHidden(false);
      setState({ kind: 'ready', update });
    } catch {
      // Offline or the feed is unreachable: try again later.
    } finally {
      busy.current = false;
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

  const restart = async (update: Update) => {
    setState({ kind: 'installing', version: update.version });
    try {
      await update.install(); // Windows: the installer closes the app, updates and restarts it.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (state.kind === 'idle' || hidden) return null;

  return (
    <div className="ae-enter fixed right-4 bottom-4 z-[60] w-80 overflow-hidden rounded-ae border border-ae-border bg-ae-elevated shadow-2xl" role="status">
      <div className="h-1 bg-gradient-to-r from-ae-accent to-ae-success" />
      <div className="p-4">
        {state.kind === 'ready' && (
          <>
            <div className="mb-1 flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ae-accent/15 text-ae-accent">
                <DownloadIcon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Update ready</p>
                <p className="text-xs text-ae-muted">v{state.update.version} is downloaded. Restart now, or it installs next time you open the app.</p>
              </div>
              <button type="button" aria-label="Later" data-tip="Later" className="text-ae-muted hover:text-ae-text" onClick={() => setHidden(true)}>
                <CloseIcon size={16} />
              </button>
            </div>
            <button type="button" onClick={() => void restart(state.update)} className="ae-press mt-3 w-full rounded-ae bg-ae-accent py-2 text-sm font-semibold text-ae-on-accent">
              Restart to update
            </button>
          </>
        )}
        {state.kind === 'installing' && (
          <>
            <p className="mb-2 text-sm font-semibold">Installing v{state.version}…</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-ae-sunken">
              <div className="ae-skeleton h-full w-full" />
            </div>
            <p className="mt-2 text-xs text-ae-muted">Aether will reopen in a few seconds.</p>
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
    </div>
  );
}
