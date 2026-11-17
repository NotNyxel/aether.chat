/**
 * Home, Features, Download, FAQ and Privacy pages: picks the right download for your device, fills
 * in the newest release's files, and runs the layout switcher on the home page.
 */
import './site';

const RELEASES = 'NotNyxel/aether.chat';

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

if (primary || document.querySelector('.dl[data-asset]')) {
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
      // On the home page the big button downloads directly; elsewhere it goes to /download.
      if (primary && found[os] && primary.getAttribute('href') !== '/download') primary.href = found[os]!;
      const note = document.getElementById('version-note');
      if (note && newest) note.innerHTML = `Latest version: <b>${newest.replace(/^v/, '')}</b> · <a href="https://github.com/${RELEASES}/releases/latest">all downloads and release notes</a>`;
    })
    .catch(() => {});
}

// Home: the layout switcher.
const SHOTS: Record<string, { src: string; alt: string; cap: string }> = {
  orbit: { src: '/site/layout-orbit.png', alt: 'The Orbit layout', cap: 'Orbit: a calm home with your friends, their Moments and what’s coming up.' },
  lounge: { src: '/site/layout-lounge.png', alt: 'The Lounge layout', cap: 'Lounge: big friend cards and calls up front.' },
  workspace: { src: '/site/layout-workspace.png', alt: 'The Workspace layout', cap: 'Workspace: tabs and a tree of spaces, for busy servers.' },
  classic: { src: '/site/desktop.png', alt: 'The Classic layout', cap: 'Classic: the familiar look, with dozens of themes.' },
};
const img = document.getElementById('layout-img') as HTMLImageElement | null;
const cap = document.getElementById('layout-cap');
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs [data-shot]')];
const pick = (btn: HTMLButtonElement) => {
  const s = SHOTS[btn.dataset.shot!];
  if (!s || !img || !cap) return;
  tabs.forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
  img.src = s.src;
  img.alt = s.alt;
  cap.textContent = s.cap;
};
tabs.forEach((b, i) => {
  b.addEventListener('click', () => pick(b));
  b.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length]!;
    next.focus();
    pick(next);
  });
});
