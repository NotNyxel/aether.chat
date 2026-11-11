#!/usr/bin/env node
/**
 * Apply a SQL migration to the production Supabase project through the Management API.
 *   node scripts/migrate.mjs supabase/migrations/003_messaging.sql
 *   node scripts/migrate.mjs --sql "select 1"
 * Needs a Supabase personal access token in .secrets/supabase.token (git-ignored).
 * Always run `npm run test:db` first.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PROJECT_REF = 'pyjvnbjsjtbogrmoimwf';
const token = readFileSync(join(ROOT, '.secrets', 'supabase.token'), 'utf8').trim();

const [flag, arg] = process.argv.slice(2);
const query = flag === '--sql' ? arg : readFileSync(resolve(ROOT, flag), 'utf8');
if (!query) {
  console.error('usage: node scripts/migrate.mjs <file.sql> | --sql "<query>"');
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const body = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${body}`);
  process.exit(1);
}
console.log(body.length > 4000 ? `${body.slice(0, 4000)}…` : body);
