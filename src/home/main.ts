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

// Home: the layout switcher (screenshots stacked; the chosen one fades in).
const CAPS: Record<string, string> = {
  orbit: 'Orbit: a calm home with your friends, their Moments and what’s coming up.',
  lounge: 'Lounge: big friend cards and calls up front.',
  workspace: 'Workspace: tabs and a tree of spaces, for busy servers.',
  classic: 'Classic: the familiar look, with dozens of themes.',
};
const cap = document.getElementById('layout-cap');
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs [data-shot]')];
const frames = [...document.querySelectorAll<HTMLElement>('.layout-stage [data-shot]')];
let auto: ReturnType<typeof setInterval> | undefined;
const pick = (name: string) => {
  tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.shot === name)));
  frames.forEach((f) => f.classList.toggle('on', f.dataset.shot === name));
  if (cap) cap.textContent = CAPS[name] ?? '';
};
tabs.forEach((b, i) => {
  b.addEventListener('click', () => {
    clearInterval(auto);
    pick(b.dataset.shot!);
  });
  b.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    clearInterval(auto);
    const next = tabs[(i + step + tabs.length) % tabs.length]!;
    next.focus();
    pick(next.dataset.shot!);
  });
});
// Cycle through them until someone picks one.
if (tabs.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let n = 0;
  auto = setInterval(() => {
    n = (n + 1) % tabs.length;
    pick(tabs[n]!.dataset.shot!);
  }, 5000);
}
