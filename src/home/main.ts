/**
 * The website at / (the web app lives at /app). Picks the right download for your device, fills in
 * the newest release's files, and swaps Log in / Sign up for "Open Aether" when you're signed in.
 */
import './home.css';

const RELEASES = 'NotNyxel/aether.chat-releases';

// Links from account emails and the installed web app belong to the app, not this page.
const { search, hash } = window.location;
if (/access_token|refresh_token|error_description|[?&]code=|#goto=/.test(hash + search) || window.matchMedia('(display-mode: standalone)').matches) {
  window.location.replace(`/app${search}${hash}`);
}

let signedIn = false;
try {
  signedIn = !!localStorage.getItem('aether.auth');
} catch {
  /* storage blocked: show Log in / Sign up */
}
if (signedIn) {
  const auth = document.getElementById('auth');
  if (auth) auth.innerHTML = '<a class="btn primary" href="/app">Open Aether</a>';
}

const ua = navigator.userAgent;
const os = /Android/i.test(ua) ? 'apk' : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ipa' : /Mac OS X|Macintosh/i.test(ua) ? 'dmg' : /Linux/i.test(ua) ? 'appimage' : 'setup';
const labels: Record<string, string> = { setup: 'Download for Windows', dmg: 'Download for macOS', appimage: 'Download for Linux', apk: 'Download for Android', ipa: 'Get it for iPhone & iPad' };
const primary = document.getElementById('primary-download') as HTMLAnchorElement | null;
if (primary) primary.textContent = labels[os] ?? 'Download';
document.querySelector(`.dl[data-asset="${os}"]`)?.classList.add('mine');

const patterns: Record<string, RegExp> = {
  setup: /^Aether-Setup\.exe$/,
  dmg: /\.dmg$/,
  appimage: /\.AppImage$/,
  deb: /\.deb$/,
  apk: /\.apk$/,
  ipa: /\.ipa$/,
};

void fetch(`https://api.github.com/repos/${RELEASES}/releases?per_page=10`, { headers: { Accept: 'application/vnd.github+json' } })
  .then((r) => (r.ok ? r.json() : []))
  .then((releases: { tag_name: string; draft: boolean; assets: { name: string; browser_download_url: string }[] }[]) => {
    const found: Record<string, string> = {};
    let newest: string | null = null;
    // Intermediate releases may be Windows-only: take each platform's file from the newest release that has it.
    for (const rel of releases.filter((r) => !r.draft)) {
      newest ??= rel.tag_name;
      for (const [key, re] of Object.entries(patterns)) {
        if (found[key]) continue;
        const a = rel.assets.find((x) => re.test(x.name));
        if (a) found[key] = a.browser_download_url;
      }
    }
    document.querySelectorAll<HTMLAnchorElement>('.dl[data-asset]').forEach((el) => {
      const url = found[el.dataset.asset!];
      if (url) el.href = url;
    });
    if (primary && found[os]) primary.href = found[os]!;
    const note = document.getElementById('version-note');
    if (note && newest) note.innerHTML = `Latest version: <b>${newest.replace(/^v/, '')}</b> · <a href="https://github.com/${RELEASES}/releases/latest">all downloads and release notes</a>`;
  })
  .catch(() => {});
