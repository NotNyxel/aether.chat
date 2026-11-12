/**
 * Startup window (desktop only). Runs before the main window is shown: checks the signed update
 * feed, and if a newer version exists downloads it, installs it silently and restarts into it, so
 * nobody ever runs an out-of-date copy. Offline or a slow feed never blocks startup for long.
 */
import { invoke } from '@tauri-apps/api/core';

const CHECK_TIMEOUT_MS = 7_000;

const $ = (id: string) => document.getElementById(id)!;
const status = (text: string) => {
  $('status').textContent = text;
};
const bar = (mode: 'busy' | 'progress' | 'off', pct = 0) => {
  const el = $('bar');
  el.classList.toggle('on', mode !== 'off');
  el.classList.toggle('busy', mode === 'busy');
  ($('fill') as HTMLElement).style.width = mode === 'progress' ? `${Math.max(2, Math.min(100, pct))}%` : '';
};
const mb = (n: number) => (n / 1048576).toFixed(1);

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  status('Starting…');
  await invoke('splash_finish').catch(() => undefined);
}

async function run() {
  $('version').textContent = `v${__APP_VERSION__}`;
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  $('skip').addEventListener('click', () => void finish());
  requestAnimationFrame(() => bar('busy'));

  status('Checking for updates…');
  let update;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    update = await check({ timeout: CHECK_TIMEOUT_MS });
  } catch {
    update = null; // Offline or the feed is unreachable: start the current version.
  }
  if (!update) return finish();

  await invoke('splash_busy').catch(() => undefined);
  status(`Downloading update v${update.version}…`);
  let total = 0;
  let got = 0;
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0;
        bar(total ? 'progress' : 'busy', 0);
      } else if (event.event === 'Progress') {
        got += event.data.chunkLength;
        if (total) {
          bar('progress', (got / total) * 100);
          status(`Downloading update · ${mb(got)} of ${mb(total)} MB`);
        }
      } else if (event.event === 'Finished') {
        bar('busy');
        status('Installing update…');
      }
    });
    // On Windows the installer takes over from here and restarts the app when it's done.
    status('Restarting…');
  } catch {
    bar('off');
    status("Couldn't install the update.");
    ($('skip') as HTMLElement).style.display = 'inline-block';
    setTimeout(() => void finish(), 6_000);
  }
}

void run();
