#!/usr/bin/env node
/**
 * Release aether.chat:
 *   node scripts/release.mjs             build + sign the version in package.json and publish it
 *   node scripts/release.mjs --legacy <version> <installer.exe>
 *                                        publish an old, pre-updater installer (no signature, not "latest")
 *
 * Publishing targets (see RELEASES.md):
 *   - <owner>/aether.chat           private source repo: git tag + release with the installer
 *   - <owner>/aether.chat-releases  public update feed:   release with installer, .sig and latest.json
 *
 * The updater downloads https://github.com/<owner>/aether.chat-releases/releases/latest/download/latest.json,
 * so the public feed must always hold the newest signed build as its "latest" release.
 *
 * Each release also builds aether.chat Setup (installer/), the one-click installer people download
 * (it carries the signed NSIS installer inside), and deploys the web app to Vercel.
 *
 * Requirements: GitHub CLI (`gh`) logged in, `.secrets/updater.key` + `.secrets/updater.key.password`,
 * and for the web app a one-time `npx vercel login` (skipped with a warning otherwise).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_REPO = 'aether.chat';
const FEED_REPO = 'aether.chat-releases';
const TAURI_CONF = join(ROOT, 'src-tauri', 'tauri.conf.json');

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${r.status}`);
};
const out = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' }).trim();

function changelogSection(version) {
  const text = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const match = new RegExp(`^## \\[?v?${version.replace(/\./g, '\\.')}\\]?[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text);
  if (!match) throw new Error(`CHANGELOG.md has no section for ${version}`);
  return match[1].trim();
}

function ensureRepos(owner) {
  for (const [name, visibility] of [
    [SOURCE_REPO, '--private'],
    [FEED_REPO, '--public'],
  ]) {
    const exists = spawnSync('gh', ['repo', 'view', `${owner}/${name}`], { cwd: ROOT, stdio: 'ignore', shell: true }).status === 0;
    if (!exists) {
      const desc = name === FEED_REPO ? 'Signed installers and the auto-update feed for aether.chat' : 'aether.chat source';
      run('gh', ['repo', 'create', `${owner}/${name}`, visibility, '--description', `"${desc}"`]);
    }
  }
}

function ensureEndpoint(owner) {
  const conf = readFileSync(TAURI_CONF, 'utf8');
  if (conf.includes('__GITHUB_OWNER__')) {
    writeFileSync(TAURI_CONF, conf.replaceAll('__GITHUB_OWNER__', owner));
    console.log(`Updater endpoint set to github.com/${owner}/${FEED_REPO}`);
    return true;
  }
  return false;
}

function releaseExists(repo, tag) {
  return spawnSync('gh', ['release', 'view', tag, '--repo', repo], { cwd: ROOT, stdio: 'ignore', shell: true }).status === 0;
}

function publish(repo, tag, title, notesFile, files, { latest }) {
  if (releaseExists(repo, tag)) {
    console.log(`${repo} ${tag} already exists, uploading assets with --clobber`);
    run('gh', ['release', 'upload', tag, ...files.map((f) => `"${f}"`), '--repo', repo, '--clobber']);
    return;
  }
  run('gh', [
    'release', 'create', tag, ...files.map((f) => `"${f}"`),
    '--repo', repo, '--title', `"${title}"`, '--notes-file', `"${notesFile}"`,
    `--latest=${latest}`,
  ]);
}

async function main() {
  const owner = out('gh', ['api', 'user', '--jq', '.login']);
  ensureRepos(owner);
  const notesFile = join(ROOT, '.secrets', 'release-notes.md');

  if (process.argv[2] === '--legacy') {
    const [, , , version, installer] = process.argv;
    if (!version || !installer || !existsSync(installer)) throw new Error('usage: --legacy <version> <installer.exe>');
    writeFileSync(
      notesFile,
      `${changelogSection(version)}\n\n> Legacy build from before the auto-updater existed. Install the latest version to get automatic updates.`,
    );
    for (const repo of [`${owner}/${SOURCE_REPO}`, `${owner}/${FEED_REPO}`]) {
      publish(repo, `v${version}`, `v${version} (legacy)`, notesFile, [installer], { latest: false });
    }
    return;
  }

  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const tag = `v${version}`;
  const notes = changelogSection(version);
  const endpointChanged = ensureEndpoint(owner);

  const dirty = out('git', ['status', '--porcelain']);
  if (dirty && !endpointChanged) throw new Error(`Commit your changes before releasing:\n${dirty}`);
  if (endpointChanged) {
    run('git', ['add', 'src-tauri/tauri.conf.json']);
    run('git', ['commit', '-m', `"chore: point updater at github.com/${owner}/${FEED_REPO}"`]);
  }

  // Signed build
  const env = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(join(ROOT, '.secrets', 'updater.key'), 'utf8'),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: readFileSync(join(ROOT, '.secrets', 'updater.key.password'), 'utf8'),
  };
  run('npx', ['tauri', 'build'], { env });

  const bundleDir = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  const installer = join(bundleDir, `aether.chat_${version}_x64-setup.exe`);
  const sigFile = `${installer}.sig`;
  if (!existsSync(installer) || !existsSync(sigFile)) throw new Error(`Build output missing in ${bundleDir}`);

  // One-click Setup (embeds the signed installer). Same version as the app.
  const setupToml = join(ROOT, 'installer', 'Cargo.toml');
  writeFileSync(setupToml, readFileSync(setupToml, 'utf8').replace(/^version = "[^"]+"/m, `version = "${version}"`));
  const setupConf = join(ROOT, 'installer', 'tauri.conf.json');
  writeFileSync(setupConf, readFileSync(setupConf, 'utf8').replace(/"version": "[^"]+"/, `"version": "${version}"`));
  run('cargo', ['build', '--release', '--manifest-path', `"${setupToml}"`], { env: { ...process.env, AETHER_INSTALLER: installer } });
  const setupExe = join(bundleDir, 'aether.chat-Setup.exe');
  copyFileSync(join(ROOT, 'installer', 'target', 'release', 'aetherchat-setup.exe'), setupExe);

  const url = `https://github.com/${owner}/${FEED_REPO}/releases/download/${tag}/${encodeURIComponent(basename(installer))}`;
  const latestJson = join(bundleDir, 'latest.json');
  writeFileSync(
    latestJson,
    JSON.stringify(
      {
        version,
        notes,
        pub_date: new Date().toISOString(),
        platforms: { 'windows-x86_64': { signature: readFileSync(sigFile, 'utf8').trim(), url } },
      },
      null,
      2,
    ),
  );

  // Tag the source and publish both releases
  if (!out('git', ['tag', '--list', tag])) run('git', ['tag', '-a', tag, '-m', `"aether.chat ${tag}"`]);
  run('git', ['push', 'origin', 'HEAD', '--follow-tags']);
  const download = `**Download:** [aether.chat-Setup.exe](https://github.com/${owner}/${FEED_REPO}/releases/latest/download/aether.chat-Setup.exe) (one click, no admin needed). Already installed? It updates itself.\n\n`;
  writeFileSync(notesFile, download + notes);
  const assets = [setupExe, installer, sigFile, latestJson];
  publish(`${owner}/${SOURCE_REPO}`, tag, `aether.chat ${tag}`, notesFile, assets, { latest: true });
  publish(`${owner}/${FEED_REPO}`, tag, `aether.chat ${tag}`, notesFile, assets, { latest: true });

  // Web app
  try {
    run('node', [join(ROOT, 'scripts', 'deploy-web.mjs')]);
  } catch (err) {
    console.warn(`\nWeb deploy skipped: ${err.message}\nRun \`npx vercel login\` once, then \`npm run deploy:web\`.`);
  }

  console.log(`\nReleased ${tag}\n  feed: https://github.com/${owner}/${FEED_REPO}/releases/tag/${tag}`);
}

main().catch((err) => {
  console.error(`\nRelease failed: ${err.message}`);
  process.exit(1);
});
