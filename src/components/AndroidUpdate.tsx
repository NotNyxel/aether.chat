/**
 * Android app updates. The desktop updater doesn't exist on Android, so on start (and every few
 * hours) the app asks GitHub for the newest release. If it's newer, a card offers the update: it
 * downloads the new APK, and Android asks once to install it over the current app (sign-in kept).
 */
import { useEffect, useState } from 'react';
import { RELEASES_REPO } from '../config';
import { DownloadIcon, RocketIcon } from './icons';

export const isAndroidApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && /Android/i.test(navigator.userAgent);

interface Release {
  version: string;
  apk: string;
  notes: string;
}

function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

async function latest(): Promise<Release | null> {
  const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) return null;
  const r = (await res.json()) as { tag_name: string; body?: string; assets: { name: string; browser_download_url: string }[] };
  const apk = r.assets.find((a) => a.name.endsWith('.apk'));
  if (!apk) return null;
  return { version: r.tag_name.replace(/^v/, ''), apk: apk.browser_download_url, notes: r.body ?? '' };
}

async function openApk(url: string) {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

export function AndroidUpdate() {
  const [rel, setRel] = useState<Release | null>(null);
  const [later, setLater] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!isAndroidApp) return;
    const check = () =>
      void latest()
        .then((r) => r && newer(r.version, __APP_VERSION__) && setRel(r))
        .catch(() => {});
    check();
    const t = setInterval(check, 4 * 3600_000);
    return () => clearInterval(t);
  }, []);

  if (!rel || later) return null;
  return (
    <div className="ae-backdrop fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      <div className="ae-sheet w-full max-w-[420px] rounded-3xl border border-ae-border bg-ae-elevated p-5 shadow-2xl">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-ae-accent/15 text-ae-accent">
          <RocketIcon size={28} />
        </div>
        <h2 className="text-center text-xl font-extrabold">Aether {rel.version} is here</h2>
        <p className="mt-1 text-center text-sm text-ae-muted">
          {started ? 'When the download finishes, tap it and choose Install. You stay signed in.' : `You have ${__APP_VERSION__}. The update downloads and installs over this one.`}
        </p>
        <button
          type="button"
          className="ae-press mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ae-accent text-[15px] font-bold text-ae-on-accent"
          onClick={() => {
            setStarted(true);
            void openApk(rel.apk);
          }}
        >
          <DownloadIcon size={18} /> {started ? 'Download again' : 'Update now'}
        </button>
        <button type="button" className="mt-2 h-10 w-full rounded-2xl text-sm text-ae-muted" onClick={() => setLater(true)}>
          Later
        </button>
      </div>
    </div>
  );
}
