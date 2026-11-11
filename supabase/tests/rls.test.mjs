// Run with: npm run test:db
// Runs AetherChat's schema + migration 002 against real Postgres (PGlite) with Supabase stubs,
// then exercises the social flows as two different authenticated users with RLS enforced.
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync } from 'node:fs';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'schema.sql');
const migrationPath = join(here, '..', 'migrations', '002_social.sql');
const db = new PGlite({ extensions: { citext } });

const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
create schema extensions; grant usage on schema extensions to authenticated, anon;
create schema realtime;
create table realtime.messages (id bigserial primary key, topic text, extension text, payload jsonb);
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated; grant select, insert on realtime.messages to authenticated;
grant execute on function realtime.topic() to authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated; grant select, insert, delete on storage.objects to authenticated;
grant execute on function storage.foldername(text) to authenticated;
create publication supabase_realtime;
grant usage on schema public to authenticated, anon;
`;

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

let failures = 0;
async function as(uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role;');
  }
}
async function expectOk(label, fn) {
  try {
    const r = await fn();
    console.log(`  ok   ${label}`);
    return r;
  } catch (e) {
    failures++;
    console.log(`  FAIL ${label}: ${e.message}`);
  }
}
async function expectError(label, fn, match) {
  try {
    await fn();
    failures++;
    console.log(`  FAIL ${label}: expected an error`);
  } catch (e) {
    if (match && !e.message.includes(match)) {
      failures++;
      console.log(`  FAIL ${label}: wrong error: ${e.message}`);
    } else console.log(`  ok   ${label} (rejected: ${e.message.slice(0, 70)})`);
  }
}

console.log('Applying stubs, schema.sql, 002_social.sql');
await db.exec(STUBS);
await db.exec('create extension if not exists citext with schema extensions;');
await db.exec(readFileSync(schemaPath, 'utf8'));
await db.exec(readFileSync(migrationPath, 'utf8'));
console.log('  ok   both files applied');

// Users via the auth trigger
await db.exec(`insert into auth.users (id, raw_user_meta_data) values
  ('${A}', '{"username":"alice"}'), ('${B}', '{"username":"bob"}'), ('${C}', '{"username":"carol"}');`);

console.log('\nFriends');
await expectOk('alice → bob request', () => as(A, `select public.send_friend_request('bob') r`));
await expectError('bob cannot DM alice before accepting (no shared server)', () => as(B, `select public.open_dm('${A}')`), 'only message friends');
await expectOk('bob accepts', () => as(B, `select public.accept_friend_request('${A}')`));
await expectOk('alice ↔ carol become friends (mutual request auto-accepts)', async () => {
  await as(A, `select public.send_friend_request('carol')`);
  const r = await as(C, `select public.send_friend_request('alice') r`);
  if (r.rows[0].r !== 'accepted') throw new Error(`got ${r.rows[0].r}`);
});
await expectOk('carol sees only her own friendships', async () => {
  const r = await as(C, `select count(*)::int n from public.friendships`);
  if (r.rows[0].n !== 1) throw new Error(`saw ${r.rows[0].n}`);
});

console.log('\nDMs');
const dm = (await expectOk('alice opens DM with bob', () => as(A, `select public.open_dm('${B}') id`)))?.rows[0].id;
await expectOk('re-opening returns the same DM', async () => {
  const r = await as(B, `select public.open_dm('${A}') id`);
  if (r.rows[0].id !== dm) throw new Error('different id');
});
await expectOk('alice sends a DM', () => as(A, `insert into public.messages (conversation_id, content) values ($1, 'hi bob @bob') returning id`, [dm]));
await expectOk('bob reads it', async () => {
  const r = await as(B, `select content from public.messages where conversation_id = $1`, [dm]);
  if (r.rows.length !== 1) throw new Error(`${r.rows.length} rows`);
});
await expectOk('carol cannot see the DM or its messages', async () => {
  const r = await as(C, `select (select count(*) from public.conversations where id = $1)::int c, (select count(*) from public.messages where conversation_id = $1)::int m`, [dm]);
  if (r.rows[0].c || r.rows[0].m) throw new Error('leak');
});
await expectError('carol cannot post into it', () => as(C, `insert into public.messages (conversation_id, content) values ($1, 'x')`, [dm]));
await expectOk('bob replies to alice', async () => {
  const msg = (await as(B, `select id from public.messages where conversation_id = $1`, [dm])).rows[0].id;
  await as(B, `insert into public.messages (conversation_id, content, reply_to_id) values ($1, 'hey', $2)`, [dm, msg]);
});
await expectOk('unread: sender is read, receiver is not', async () => {
  await as(A, `insert into public.messages (conversation_id, content) values ($1, 'ping')`, [dm]);
  const r = await as(A, `select cm.user_id, c.last_message_at > cm.last_read_at unread from public.conversation_members cm join public.conversations c on c.id = cm.conversation_id where c.id = $1`, [dm]);
  const byUser = Object.fromEntries(r.rows.map((x) => [x.user_id, x.unread]));
  if (byUser[A] !== false || byUser[B] !== true) throw new Error(JSON.stringify(byUser));
});
await expectError('bob cannot edit alice\'s message', async () => {
  const msg = (await as(B, `select id from public.messages where conversation_id = $1 and author_id = '${A}' limit 1`, [dm])).rows[0].id;
  await as(B, `update public.messages set content = 'hacked' where id = $1`, [msg]);
}, 'only the author');

console.log('\nReactions');
await expectOk('bob reacts 👍 to alice', async () => {
  const msg = (await as(B, `select id from public.messages where conversation_id = $1 limit 1`, [dm])).rows[0].id;
  const r = await as(B, `insert into public.message_reactions (message_id, emoji) values ($1, '👍') returning scope_id, user_id`, [msg]);
  if (r.rows[0].scope_id !== dm || r.rows[0].user_id !== B) throw new Error(JSON.stringify(r.rows[0]));
});
await expectOk('carol cannot see the reaction', async () => {
  const r = await as(C, `select count(*)::int n from public.message_reactions`);
  if (r.rows[0].n !== 0) throw new Error('leak');
});

console.log('\nGroups');
await expectError('bob cannot add carol (not his friend)', () => as(B, `select public.create_group_dm(array['${C}']::uuid[], 'x')`), 'only add friends');
const grp = (await expectOk('alice creates a group with bob + carol', () => as(A, `select public.create_group_dm(array['${B}','${C}']::uuid[], 'Squad') id`)))?.rows[0].id;
await expectOk('carol posts in the group', () => as(C, `insert into public.messages (conversation_id, content) values ($1, 'yo')`, [grp]));
await expectOk('alice leaves; ownership moves to someone else', async () => {
  await as(A, `select public.leave_conversation($1)`, [grp]);
  const r = await as(B, `select owner_id from public.conversations where id = $1`, [grp]);
  if (!r.rows[0] || r.rows[0].owner_id === A) throw new Error(JSON.stringify(r.rows));
});
await expectOk('alice no longer sees the group', async () => {
  const r = await as(A, `select count(*)::int n from public.messages where conversation_id = $1`, [grp]);
  if (r.rows[0].n !== 0) throw new Error('still visible');
});

console.log('\nCalls and realtime topic auth');
const call1 = (await expectOk('alice starts a DM call', () => as(A, `select public.start_call($1) id`, [dm])))?.rows[0].id;
await expectOk('bob "starting" joins the same active call', async () => {
  const r = await as(B, `select public.start_call($1) id`, [dm]);
  if (r.rows[0].id !== call1) throw new Error('second call created');
});
await expectOk('bob sees the active call (drives ringing)', async () => {
  const r = await as(B, `select count(*)::int n from public.calls where ended_at is null`);
  if (r.rows[0].n !== 1) throw new Error(`${r.rows[0].n}`);
});
const topicCheck = async (uid, topic) =>
  (await as(uid, `select public.can_access_realtime_topic($1) ok`, [topic])).rows[0].ok;
await expectOk('voice topic: bob allowed, carol denied', async () => {
  if (!(await topicCheck(B, `voice:${dm}`))) throw new Error('bob denied');
  if (await topicCheck(C, `voice:${dm}`)) throw new Error('carol allowed');
});
await expectOk('typing topic: member allowed, outsider denied; online:global open', async () => {
  if (!(await topicCheck(A, `typing:${dm}`))) throw new Error('alice denied');
  if (await topicCheck(C, `typing:${dm}`)) throw new Error('carol allowed');
  if (!(await topicCheck(C, 'online:global'))) throw new Error('global denied');
  if (await topicCheck(C, 'voice:not-a-uuid')) throw new Error('garbage allowed');
});
await expectOk('end_call clears it', async () => {
  await as(A, `select public.end_call($1)`, [dm]);
  const r = await as(B, `select count(*)::int n from public.calls where ended_at is null`);
  if (r.rows[0].n !== 0) throw new Error('still active');
});

console.log('\nBlocking');
await expectOk('bob blocks alice', () => as(B, `select public.block_user('${A}')`));
await expectError('alice can no longer message bob', () => as(A, `insert into public.messages (conversation_id, content) values ($1, 'hello?')`, [dm]), 'cannot message');
await expectError('alice cannot call bob', () => as(A, `select public.start_call($1)`, [dm]), 'cannot call');
await expectError('alice cannot re-friend bob', () => as(A, `select public.send_friend_request('bob')`), 'cannot send');
await expectOk('voice topic now denied for the DM', async () => {
  if (await topicCheck(A, `voice:${dm}`)) throw new Error('still allowed');
});

console.log('\nServer channels still work');
await expectOk('alice creates a server and posts in #general', async () => {
  const s = (await as(A, `insert into public.servers (name) values ('Test') returning id`)).rows[0].id;
  const ch = (await as(A, `select id from public.channels where server_id = $1 and type = 'text'`, [s])).rows[0].id;
  await as(A, `insert into public.messages (channel_id, content) values ($1, 'server msg')`, [ch]);
  const r = await as(A, `select count(*)::int n from public.messages where channel_id = $1`, [ch]);
  if (r.rows[0].n !== 1) throw new Error('missing');
  if (!(await topicCheck(A, `typing:${ch}`))) throw new Error('typing topic denied for own channel');
});
await expectOk('presence status column is writable', () => as(C, `update public.users set presence_status = 'dnd' where id = '${C}'`));
await expectError('badge_ids still not writable', () => as(C, `update public.users set badge_ids = '["staff"]' where id = '${C}'`));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
