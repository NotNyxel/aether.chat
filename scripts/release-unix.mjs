#!/usr/bin/env node
/**
 * Build and publish the macOS, Linux and Android versions of the current release (package.json version):
 *   node scripts/release-unix.mjs [--ref <commit>]
 *
 * 1. Runs the "Desktop builds" GitHub Actions workflow (.github/workflows/desktop-builds.yml) on
 *    the private source repo and waits for it. It signs the updater bundles with the repo secrets
 *    TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD.
 * 2. Downloads the artifacts, gives them versioned names and uploads them to the release in both
 *    repos (run scripts/release.mjs first: that creates the releases and the Windows build).
 * 3. Adds darwin-aarch64, darwin-x86_64 (one universal app) and linux-x86_64 (AppImage) to the
 *    release's latest.json, so those installs update themselves like Windows does.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WORKFLOW = 'desktop-builds.yml';
const shell = process.platform === 'win32';
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${r.status}`);
};
const out = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const tag = `v${version}`;
const owner = out('gh', ['api', 'user', '--jq', '.login']);
const SRC = `${owner}/aether.chat`;
const FEED = `${owner}/aether.chat-releases`;
const refArg = process.argv.indexOf('--ref');
const ref = refArg > 0 ? process.argv[refArg + 1] : out('git', ['rev-parse', 'HEAD']);

// 1. Run the workflow and wait.
const before = new Date().toISOString();
run('gh', ['workflow', 'run', WORKFLOW, '--repo', SRC, '-f', `ref=${ref}`]);
let runId = null;
for (let i = 0; i < 30 && !runId; i++) {
  await sleep(4000);
  const list = JSON.parse(out('gh', ['run', 'list', '--repo', SRC, '--workflow', WORKFLOW, '--limit', '5', '--json', 'databaseId,createdAt,event']));
  runId = list.find((r) => r.event === 'workflow_dispatch' && r.createdAt >= before)?.databaseId ?? null;
}
if (!runId) throw new Error('The workflow run did not start.');
console.log(`\nBuilding ${tag} for macOS and Linux: https://github.com/${SRC}/actions/runs/${runId}`);
run('gh', ['run', 'watch', String(runId), '--repo', SRC, '--exit-status', '--interval', '30']);

// 2. Download and rename.
const dir = mkdtempSync(join(tmpdir(), 'aether-unix-'));
run('gh', ['run', 'download', String(runId), '--repo', SRC, '--dir', `"${dir}"`]);
const files = [];
for (const sub of readdirSync(dir)) for (const f of readdirSync(join(dir, sub))) files.push(join(dir, sub, f));
const find = (re) => {
  const f = files.find((x) => re.test(x));
  if (!f) throw new Error(`Build output missing: ${re}`);
  return f;
};
const named = (path, name) => {
  const to = join(dir, name);
  renameSync(path, to);
  return to;
};
const dmg = named(find(/\.dmg$/), `Aether_${version}_macos-universal.dmg`);
const appTar = named(find(/\.app\.tar\.gz$/), `Aether_${version}_macos-universal.app.tar.gz`);
const appSig = named(find(/\.app\.tar\.gz\.sig$/), `Aether_${version}_macos-universal.app.tar.gz.sig`);
const appImage = named(find(/\.AppImage$/), `Aether_${version}_linux-x86_64.AppImage`);
const appImageSig = named(find(/\.AppImage\.sig$/), `Aether_${version}_linux-x86_64.AppImage.sig`);
const deb = named(find(/\.deb$/), `Aether_${version}_linux-amd64.deb`);
const apk = named(find(/\.apk$/), `Aether_${version}_android.apk`);
const assets = [dmg, appTar, appSig, appImage, appImageSig, deb, apk];
for (const repo of [SRC, FEED]) run('gh', ['release', 'upload', tag, ...assets.map((a) => `"${a}"`), '--repo', repo, '--clobber']);

// 3. Merge into latest.json.
const latestPath = join(dir, 'latest.json');
run('gh', ['release', 'download', tag, '--repo', FEED, '--pattern', 'latest.json', '--dir', `"${dir}"`, '--clobber']);
const latest = JSON.parse(readFileSync(latestPath, 'utf8'));
if (latest.version !== version) throw new Error(`latest.json is for ${latest.version}, not ${version}. Run scripts/release.mjs first.`);
const url = (f) => `https://github.com/${FEED}/releases/download/${tag}/${encodeURIComponent(f.split(/[\\/]/).pop())}`;
const mac = { signature: readFileSync(appSig, 'utf8').trim(), url: url(appTar) };
latest.platforms['darwin-aarch64'] = mac;
latest.platforms['darwin-x86_64'] = mac;
latest.platforms['linux-x86_64'] = { signature: readFileSync(appImageSig, 'utf8').trim(), url: url(appImage) };
writeFileSync(latestPath, JSON.stringify(latest, null, 2));
for (const repo of [SRC, FEED]) run('gh', ['release', 'upload', tag, `"${latestPath}"`, '--repo', repo, '--clobber']);

console.log(`\nPublished ${tag} for macOS and Linux:\n  ${assets.map((a) => a.split(/[\\/]/).pop()).join('\n  ')}`);
