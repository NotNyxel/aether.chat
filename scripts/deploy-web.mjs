#!/usr/bin/env node
/**
 * Deploy the web app (the same frontend as the desktop app) to Vercel.
 *   node scripts/deploy-web.mjs           build and deploy to production
 *   node scripts/deploy-web.mjs --preview build and deploy a preview URL
 *
 * Only the built `dist` folder is uploaded (never the source, .secrets or Rust build output).
 * Routing, caching and security headers come from public/vercel.json, which Vite copies into dist.
 *
 * First run: sign in once with `npx vercel login`. The script links a Vercel project named
 * "aether-chat" and remembers its ids in .secrets/vercel-project.json (git-ignored), so later
 * runs need nothing else.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const IDS = join(ROOT, '.secrets', 'vercel-project.json');
const PROJECT = 'aether-chat';
const VERCEL = ['--yes', 'vercel@65'];

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${r.status}`);
  return r;
};
const capture = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  if (r.stderr) process.stderr.write(r.stderr);
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim();
};

run('npm', ['run', 'build']);
if (!existsSync(join(DIST, 'vercel.json'))) throw new Error('dist/vercel.json is missing (it comes from public/vercel.json).');
// Website pictures (web/site) go to the web deploy only, not into the desktop app.
cpSync(join(ROOT, 'web', 'site'), join(DIST, 'site'), { recursive: true });

const env = { ...process.env };
if (existsSync(IDS)) {
  const ids = JSON.parse(readFileSync(IDS, 'utf8'));
  env.VERCEL_ORG_ID = ids.orgId;
  env.VERCEL_PROJECT_ID = ids.projectId;
} else {
  run('npx', [...VERCEL, 'link', '--yes', '--project', PROJECT, '--cwd', `"${DIST}"`]);
  mkdirSync(join(ROOT, '.secrets'), { recursive: true });
  copyFileSync(join(DIST, '.vercel', 'project.json'), IDS);
  const ids = JSON.parse(readFileSync(IDS, 'utf8'));
  env.VERCEL_ORG_ID = ids.orgId;
  env.VERCEL_PROJECT_ID = ids.projectId;
  // Linking can also connect the GitHub repo and drop an OIDC token into dist. This project deploys
  // from here only, so undo both before uploading anything.
  spawnSync('npx', [...VERCEL, 'git', 'disconnect', '--yes'], { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' });
  rmSync(join(DIST, '.env.local'), { force: true });
  rmSync(join(DIST, '.vercel'), { recursive: true, force: true });
  console.log(`Linked Vercel project "${PROJECT}" (ids saved to .secrets/vercel-project.json).`);
}

const prod = !process.argv.includes('--preview');
const url = capture('npx', [...VERCEL, 'deploy', `"${DIST}"`, ...(prod ? ['--prod'] : []), '--yes'], { env, stdio: ['inherit', 'pipe', 'pipe'] });
// The production alias (e.g. aether-chat-beta.vercel.app) is the last vercel.app URL printed.
const last = (url.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) ?? []).pop() ?? url;
// Put our own address (WEB_APP_URL in src/config.ts) on this deployment too; the old address keeps working.
const WEB = /WEB_APP_URL = 'https:\/\/([^']+)'/.exec(readFileSync(join(ROOT, 'src', 'config.ts'), 'utf8'))?.[1];
const urls = url.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) ?? [];
const deployment = urls.find((u) => /-[a-z0-9]{8,10}-/.test(u.replace('https://', ''))) ?? urls[0];
if (prod && WEB && deployment) run('npx', [...VERCEL, 'alias', 'set', deployment, WEB], { env });
writeFileSync(join(ROOT, '.secrets', 'vercel-last-deploy.txt'), `${WEB ? `https://${WEB}` : last}\n`);
console.log(`\nDeployed: ${WEB ? `https://${WEB} (also ${last})` : last}`);
