#!/usr/bin/env node
/**
 * Publishes a release from the files the Release workflow built (see .github/workflows/release.yml):
 *   node scripts/ci-publish.mjs <artifacts-dir> <version> <commit-sha>
 *
 * Renames everything to the usual names, creates (or adds to) the release on both repos, and writes
 * the update feed latest.json with every platform that was built. Needs GH_TOKEN with write access
 * to both repos.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [dirArg, version, sha] = process.argv.slice(2);
if (!dirArg || !version || !sha) throw new Error('usage: ci-publish.mjs <artifacts-dir> <version> <sha>');
const ROOT = resolve(import.meta.dirname, '..');
const OWNER = 'NotNyxel';
const SRC = `${OWNER}/aether.chat`;
const FEED = `${OWNER}/aether.chat-releases`;
const tag = `v${version}`;
const out = join(ROOT, 'release-out');
mkdirSync(out, { recursive: true });

const gh = (args, opts = {}) => execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });

// Every file the build jobs produced.
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(resolve(dirArg));

const assets = [];
const take = (re, name, required = false) => {
  const f = files.find((x) => re.test(x));
  if (!f) {
    if (required) throw new Error(`Build output missing: ${re}`);
    return null;
  }
  const to = join(out, name);
  copyFileSync(f, to);
  assets.push(to);
  return to;
};

const win = take(/_x64-setup\.exe$/, `Aether_${version}_x64-setup.exe`, true);
const winSig = take(/_x64-setup\.exe\.sig$/, `Aether_${version}_x64-setup.exe.sig`, true);
const setup = take(/Aether-Setup\.exe$/, 'Aether-Setup.exe', true);
copyFileSync(setup, join(out, 'aether.chat-Setup.exe')); // old download links
assets.push(join(out, 'aether.chat-Setup.exe'));
take(/\.dmg$/, `Aether_${version}_macos-universal.dmg`);
const macTar = take(/\.app\.tar\.gz$/, `Aether_${version}_macos-universal.app.tar.gz`);
const macSig = take(/\.app\.tar\.gz\.sig$/, `Aether_${version}_macos-universal.app.tar.gz.sig`);
const appImage = take(/\.AppImage$/, `Aether_${version}_linux-x86_64.AppImage`);
const appImageSig = take(/\.AppImage\.sig$/, `Aether_${version}_linux-x86_64.AppImage.sig`);
take(/\.deb$/, `Aether_${version}_linux-amd64.deb`);
take(/\.apk$/, `Aether_${version}_android.apk`);
take(/\.ipa$/, `Aether_${version}_ios-unsigned.ipa`);

// Release notes: the CHANGELOG section plus a download line.
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const m = new RegExp(`^## \\[?v?${version.replace(/\./g, '\\.')}\\]?[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(changelog);
if (!m) throw new Error(`CHANGELOG.md has no section for ${version}`);
const notes = `**Download:** [Aether-Setup.exe](https://github.com/${SRC}/releases/latest/download/Aether-Setup.exe) (one click, no admin needed). Already installed? It updates itself.\n\n${m[1].trim()}`;
const notesFile = join(out, 'notes.md');
writeFileSync(notesFile, notes);

// The update feed.
const url = (p) => `https://github.com/${SRC}/releases/download/${tag}/${encodeURIComponent(p.split(/[\\/]/).pop())}`;
const platforms = { 'windows-x86_64': { signature: readFileSync(winSig, 'utf8').trim(), url: url(win) } };
if (macTar && macSig) platforms['darwin-aarch64'] = platforms['darwin-x86_64'] = { signature: readFileSync(macSig, 'utf8').trim(), url: url(macTar) };
if (appImage && appImageSig) platforms['linux-x86_64'] = { signature: readFileSync(appImageSig, 'utf8').trim(), url: url(appImage) };
const latest = join(out, 'latest.json');
writeFileSync(latest, JSON.stringify({ version, notes: m[1].trim(), pub_date: new Date().toISOString(), platforms }, null, 2));
assets.push(latest);

const exists = (repo) => {
  try {
    gh(['release', 'view', tag, '--repo', repo]);
    return true;
  } catch {
    return false;
  }
};
for (const repo of [SRC, FEED]) {
  if (exists(repo)) gh(['release', 'upload', tag, ...assets, '--repo', repo, '--clobber']);
  else gh(['release', 'create', tag, ...assets, '--repo', repo, '--title', `Aether ${tag}`, '--notes-file', notesFile, '--latest', ...(repo === SRC ? ['--target', sha] : [])]);
  console.log(`Published ${tag} on ${repo}`);
}
console.log(`\nPlatforms in the update feed: ${Object.keys(platforms).join(', ')}`);
console.log(assets.map((a) => `  ${a.split(/[\\/]/).pop()}`).join('\n'));
