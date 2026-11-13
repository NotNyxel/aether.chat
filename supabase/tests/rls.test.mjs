// Run with: npm run test:db
// Applies aether.chat's schema.sql + every file in supabase/migrations (in order) to real Postgres
// (PGlite) with Supabase stubs, then exercises the flows as several users with RLS enforced.
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readdirSync, readFileSync } from 'node:fs';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'schema.sql');
const migrationsDir = join(here, '..', 'migrations');
const migrationPaths = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().map((f) => join(migrationsDir, f));
const db = new PGlite({ extensions: { citext } });

const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}'::jsonb, email text, last_sign_in_at timestamptz, email_confirmed_at timestamptz, created_at timestamptz default now());
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

console.log(`Applying stubs, schema.sql, ${migrationPaths.length} migration(s)`);
await db.exec(STUBS);
await db.exec('create extension if not exists citext with schema extensions;');
await db.exec(readFileSync(schemaPath, 'utf8'));
for (const m of migrationPaths) await db.exec(readFileSync(m, 'utf8'));
console.log('  ok   all files applied');

// Users via the auth trigger
await db.exec(`insert into auth.users (id, raw_user_meta_data) values
  ('${A}', '{"username":"alice"}'), ('${B}', '{"username":"bob"}'), ('${C}', '{"username":"carol"}');`);

console.log('\nFriends');
await expectOk('alice → bob request', () => as(A, `select public.send_friend_request('bob') r`));
await expectError('with "friends and server members", bob cannot DM alice (no shared server)', async () => {
  await as(A, `insert into public.privacy_settings (dm_policy) values ('servers')`);
  try {
    await as(B, `select public.open_dm('${A}')`);
  } finally {
    await as(A, `delete from public.privacy_settings where user_id = '${A}'`);
  }
}, 'people in their servers');
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

console.log('\nBatch 1: mentions, unreads, pins, polls, search, forwards');
const srv = (await as(A, `select id from public.servers where name = 'Test'`)).rows[0].id;
const general = (await as(A, `select id from public.channels where server_id = $1 and type = 'text'`, [srv])).rows[0].id;
await expectOk('carol joins the server by invite', async () => {
  const code = (await as(A, `insert into public.server_invites (server_id) values ($1) returning code`, [srv])).rows[0].code;
  await as(C, `select public.join_server($1)`, [code]);
});
await expectOk('@mention is resolved to a user id', async () => {
  const r = await as(A, `insert into public.messages (channel_id, content) values ($1, 'hey @carol look') returning mentions`, [general]);
  if (!r.rows[0].mentions.includes(C)) throw new Error(JSON.stringify(r.rows[0]));
});
await expectOk('owner can @everyone, carol cannot (no MENTION_EVERYONE)', async () => {
  const a = await as(A, `insert into public.messages (channel_id, content) values ($1, '@everyone hi') returning mention_everyone`, [general]);
  const c = await as(C, `insert into public.messages (channel_id, content) values ($1, '@everyone spam') returning mention_everyone`, [general]);
  if (a.rows[0].mention_everyone !== true || c.rows[0].mention_everyone !== false) throw new Error(`${a.rows[0].mention_everyone} ${c.rows[0].mention_everyone}`);
});
await expectOk('unread_summary: carol has 2 mentions in #general', async () => {
  // carol posted after alice, which marks the channel read for her; rewind her read state to before alice's messages
  await db.exec(`update public.channel_read_states set last_read_at = now() - interval '1 hour' where user_id = '${C}'`);
  const r = await as(C, `select * from public.unread_summary() where scope_id = $1`, [general]);
  const row = r.rows[0];
  if (!row || row.mention_count !== 2) throw new Error(JSON.stringify(row));
});
await expectOk('mark_channel_read clears it', async () => {
  await as(C, `select public.mark_channel_read($1)`, [general]);
  const row = (await as(C, `select * from public.unread_summary() where scope_id = $1`, [general])).rows[0];
  if (row.mention_count !== 0) throw new Error(JSON.stringify(row));
});
await expectOk('outsider sees no unread rows for the server', async () => {
  const r = await as(B, `select count(*)::int n from public.unread_summary() where server_id = $1`, [srv]);
  if (r.rows[0].n !== 0) throw new Error('leak');
});
const msgForPin = (await as(C, `select id from public.messages where channel_id = $1 and author_id = '${C}' limit 1`, [general])).rows[0].id;
await expectError('carol cannot pin in a server channel', () => as(C, `update public.messages set pinned = true where id = $1`, [msgForPin]), 'MANAGE_MESSAGES');
await expectOk('owner pins: pinned_at / pinned_by recorded', async () => {
  const r = await as(A, `update public.messages set pinned = true where id = $1 returning pinned_at, pinned_by`, [msgForPin]);
  if (!r.rows[0]?.pinned_at || r.rows[0].pinned_by !== A) throw new Error(JSON.stringify(r.rows));
});
const pollMsg = (await expectOk('create a poll (normalized by trigger)', async () => {
  const r = await as(A, `insert into public.messages (channel_id, poll) values ($1, $2::jsonb) returning id, poll`,
    [general, JSON.stringify({ question: ' Lunch? ', options: [{ text: 'Pizza' }, { text: 'Sushi', emoji: '\u{1F363}' }], multi: false, duration_hours: 24, junk: 1 })]);
  const p = r.rows[0].poll;
  if (p.question !== 'Lunch?' || p.options.length !== 2 || !p.expires_at || 'junk' in p) throw new Error(JSON.stringify(p));
  return r;
}))?.rows[0].id;
await expectError('poll needs at least 2 options', () => as(A, `insert into public.messages (channel_id, poll) values ($1, $2::jsonb)`,
  [general, JSON.stringify({ question: 'x', options: [{ text: 'only' }], duration_hours: 1 })]));
await expectError('bad poll duration rejected', () => as(A, `insert into public.messages (channel_id, poll) values ($1, $2::jsonb)`,
  [general, JSON.stringify({ question: 'x', options: [{ text: 'a' }, { text: 'b' }], duration_hours: 5 })]), 'duration');
await expectOk('carol votes, then changes her vote', async () => {
  await as(C, `select public.vote_poll($1, array[0]::smallint[])`, [pollMsg]);
  await as(C, `select public.vote_poll($1, array[1]::smallint[])`, [pollMsg]);
  const r = await as(A, `select option_id from public.poll_votes where message_id = $1`, [pollMsg]);
  if (r.rows.length !== 1 || r.rows[0].option_id !== 1) throw new Error(JSON.stringify(r.rows));
});
await expectError('single-choice poll rejects two answers', () => as(C, `select public.vote_poll($1, array[0,1]::smallint[])`, [pollMsg]), 'only one');
await expectError('outsider cannot vote', () => as(B, `select public.vote_poll($1, array[0]::smallint[])`, [pollMsg]), 'not found');
await expectOk('outsider cannot see votes', async () => {
  const r = await as(B, `select count(*)::int n from public.poll_votes`);
  if (r.rows[0].n !== 0) throw new Error('leak');
});
await expectError('poll cannot be edited after posting', () => as(A, `update public.messages set poll = null where id = $1`, [pollMsg]), 'permission denied');
await expectOk('full-text search finds a message', async () => {
  const r = await as(C, `select count(*)::int n from public.messages where channel_id = $1 and to_tsvector('simple', content) @@ websearch_to_tsquery('simple', 'look')`, [general]);
  if (r.rows[0].n !== 1) throw new Error(`${r.rows[0].n}`);
});
const dmAC = (await as(A, `select public.open_dm('${C}') id`)).rows[0].id;
await expectOk('carol forwards a server message into her DM with alice', async () => {
  const r = await as(C, `insert into public.messages (conversation_id, content, forwarded_from) values ($1, 'fwd', $2::jsonb) returning forwarded_from`,
    [dmAC, JSON.stringify({ message_id: msgForPin })]);
  const f = r.rows[0].forwarded_from;
  if (f.message_id !== msgForPin || f.channel_id !== general || f.author_id !== C) throw new Error(JSON.stringify(f));
});
await expectError('bob cannot forward a message he cannot read', async () => {
  // bob can post in his group with carol, but cannot read the server message he tries to forward
  await as(B, `insert into public.messages (conversation_id, content, forwarded_from) values ($1, 'x', $2::jsonb)`, [grp, JSON.stringify({ message_id: msgForPin })]);
}, 'cannot forward');
await expectOk('DM unread count for alice (1 unread from carol)', async () => {
  const row = (await as(A, `select * from public.unread_summary() where scope_id = $1`, [dmAC])).rows[0];
  if (row.mention_count !== 1) throw new Error(JSON.stringify(row));
});
await expectOk('spoiler + alt attachments accepted', () => as(A, `insert into public.messages (channel_id, attachments) values ($1, $2::jsonb)`,
  [general, JSON.stringify([{ url: 'https://x.test/a.png', name: 'a.png', size: 10, content_type: 'image/png', spoiler: true, alt: 'a cat' }])]));


console.log('\nBatch 2: roles, timeouts, role mentions, audit log, invites, reordering');
const D = '44444444-4444-4444-4444-444444444444';
await db.exec(`insert into auth.users (id, raw_user_meta_data) values ('${D}', '{"username":"dave"}')`);
const srv2 = (await as(A, `select id from public.servers where name = 'Test'`)).rows[0].id;
const gen2 = (await as(A, `select id from public.channels where server_id = $1 and type = 'text'`, [srv2])).rows[0].id;
const voice2 = (await as(A, `select id from public.channels where server_id = $1 and type = 'voice'`, [srv2])).rows[0].id;
await expectOk('dave joins the server', async () => {
  const code = (await as(A, `insert into public.server_invites (server_id) values ($1) returning code`, [srv2])).rows[0].code;
  await as(D, `select public.join_server($1)`, [code]);
});
await expectOk('owner has every permission bit', async () => {
  const r = await as(A, `select public.server_permissions($1) p, public.all_permissions() a`, [srv2]);
  if (Number(r.rows[0].p) !== Number(r.rows[0].a)) throw new Error(String(r.rows[0].p));
});
const MOD_PERMS = (1 << 15) | (1 << 19) | (1 << 20) | (1 << 21); // kick, manage nicknames, moderate, audit log
const modRole = (await expectOk('owner creates a mentionable Mod role', () =>
  as(A, `insert into public.server_roles (server_id, name, color, position, permissions, mentionable, hoist) values ($1, 'Mod', '#ff8800', 2, $2, true, true) returning id`, [srv2, MOD_PERMS])))?.rows[0].id;
await expectOk('owner gives carol the Mod role', () => as(A, `insert into public.member_roles (server_id, user_id, role_id) values ($1, '${C}', $2)`, [srv2, modRole]));
await expectError('carol cannot create a role with ADMINISTRATOR (no MANAGE_ROLES)', () =>
  as(C, `insert into public.server_roles (server_id, name, position, permissions) values ($1, 'x', 1, $2)`, [srv2, 1 << 18]));

await expectOk('mod (carol) times out dave for 10 minutes', () => as(C, `select public.timeout_member($1, '${D}', 10, 'spam')`, [srv2]));
await expectError('timed-out dave cannot post', () => as(D, `insert into public.messages (channel_id, content) values ($1, 'hi')`, [gen2]), 'timed out');
await expectError('timed-out dave cannot react', async () => {
  const m = (await as(A, `insert into public.messages (channel_id, content) values ($1, 'react to me') returning id`, [gen2])).rows[0].id;
  await as(D, `insert into public.message_reactions (message_id, emoji) values ($1, '👍')`, [m]);
}, 'timed out');
await expectOk('timed-out dave cannot join voice', async () => {
  const ok = (await as(D, `select public.can_access_realtime_topic($1) ok`, [`voice:${voice2}`])).rows[0].ok;
  if (ok) throw new Error('allowed');
});
await expectError('dave cannot time out carol', () => as(D, `select public.timeout_member($1, '${C}', 10)`, [srv2]), 'permission');
await expectError('carol cannot time out the owner', () => as(C, `select public.timeout_member($1, '${A}', 10)`, [srv2]), 'at or above');
await expectOk('timeout removed: dave can post again', async () => {
  await as(C, `select public.timeout_member($1, '${D}', 0)`, [srv2]);
  await as(D, `insert into public.messages (channel_id, content) values ($1, 'back')`, [gen2]);
});

await expectOk('@role mention resolves for a mentionable role', async () => {
  const r = await as(D, `insert into public.messages (channel_id, content) values ($1, $2) returning mention_roles`, [gen2, `ping <@&${modRole}>`]);
  if (!r.rows[0].mention_roles.includes(modRole)) throw new Error(JSON.stringify(r.rows[0]));
});
await expectOk('carol sees the role mention in unread_summary', async () => {
  await db.exec(`update public.channel_read_states set last_read_at = now() - interval '1 hour' where user_id = '${C}'`);
  const row = (await as(C, `select * from public.unread_summary() where scope_id = $1`, [gen2])).rows[0];
  if (!row || row.mention_count < 1) throw new Error(JSON.stringify(row));
});
await expectOk('non-mentionable role is ignored for dave', async () => {
  await as(A, `update public.server_roles set mentionable = false where id = $1`, [modRole]);
  const r = await as(D, `insert into public.messages (channel_id, content) values ($1, $2) returning mention_roles`, [gen2, `ping <@&${modRole}>`]);
  if (r.rows[0].mention_roles.length !== 0) throw new Error('mentioned');
});

await expectError('dave cannot create a custom invite code', () =>
  as(D, `insert into public.server_invites (server_id, code) values ($1, 'mycoolserver')`, [srv2]), 'Manage Server');
await expectOk('owner creates a vanity invite', () => as(A, `insert into public.server_invites (server_id, code) values ($1, 'testvanity')`, [srv2]));

await expectError('dave cannot reorder channels', () => as(D, `select public.reorder_channels($1, '[]'::jsonb)`, [srv2]), 'MANAGE_CHANNELS');
await expectOk('owner moves #general to the top of the voice category', async () => {
  const cat = (await as(A, `select id from public.channels where server_id = $1 and type = 'category' and name = 'Voice Channels'`, [srv2])).rows[0].id;
  await as(A, `select public.reorder_channels($1, $2::jsonb)`, [srv2, JSON.stringify([{ id: gen2, parent_id: cat, position: 0 }])]);
  const r = await as(A, `select parent_id from public.channels where id = $1`, [gen2]);
  if (r.rows[0].parent_id !== cat) throw new Error('not moved');
});
await expectOk('owner reorders roles', async () => {
  const second = (await as(A, `insert into public.server_roles (server_id, name, position) values ($1, 'Helper', 1) returning id`, [srv2])).rows[0].id;
  await as(A, `select public.reorder_roles($1, array[$2, $3]::uuid[])`, [srv2, second, modRole]);
  const r = await as(A, `select name, position from public.server_roles where server_id = $1 and not is_default order by position desc`, [srv2]);
  if (r.rows[0].name !== 'Helper') throw new Error(JSON.stringify(r.rows));
});

await expectOk('mod sets dave\'s nickname', () => as(C, `select public.set_member_nickname($1, '${D}', 'Davey')`, [srv2]));
await expectOk('mod kicks dave with a reason', () => as(C, `select public.kick_member($1, '${D}', 'rule 3')`, [srv2]));
await expectOk('audit log records the moderation trail', async () => {
  const r = await as(C, `select action, reason from public.audit_log where server_id = $1 order by id`, [srv2]);
  const actions = r.rows.map((x) => x.action);
  for (const need of ['role_create', 'member_role_add', 'member_timeout', 'member_timeout_remove', 'invite_create', 'channel_reorder', 'role_reorder', 'member_nickname', 'member_kick']) {
    if (!actions.includes(need)) throw new Error(`missing ${need}: ${actions.join(',')}`);
  }
  if (r.rows.find((x) => x.action === 'member_kick').reason !== 'rule 3') throw new Error('kick reason missing');
  if (actions.filter((x) => x === 'role_update').length > 1) throw new Error('reorder logged as role updates');
});
await expectOk('outsiders and members without VIEW_AUDIT_LOG see nothing', async () => {
  const r = await as(B, `select count(*)::int n from public.audit_log`);
  if (r.rows[0].n !== 0) throw new Error('leak');
});
await expectError('audit log cannot be written directly', () => as(A, `insert into public.audit_log (server_id, action) values ($1, 'fake')`, [srv2]), 'permission denied');
await expectOk('ban is logged once (no extra kick entry)', async () => {
  const code = (await as(A, `insert into public.server_invites (server_id) values ($1) returning code`, [srv2])).rows[0].code;
  await as(D, `select public.join_server($1)`, [code]);
  const before = (await as(A, `select count(*)::int n from public.audit_log where action = 'member_kick'`)).rows[0].n;
  await as(A, `select public.ban_member($1, '${D}', 'raid')`, [srv2]);
  const after = (await as(A, `select count(*)::int n from public.audit_log where action = 'member_kick'`)).rows[0].n;
  const ban = (await as(A, `select reason from public.audit_log where action = 'member_ban' order by id desc limit 1`)).rows[0];
  if (after !== before || ban?.reason !== 'raid') throw new Error(`${before} ${after} ${JSON.stringify(ban)}`);
});
await expectOk('NSFW flag is settable by channel managers', () => as(A, `update public.channels set nsfw = true where id = $1`, [gen2]));
await expectOk('deleting a server does not fail on audit writes', async () => {
  const s = (await as(B, `insert into public.servers (name) values ('Throwaway') returning id`)).rows[0].id;
  await as(B, `update public.servers set name = 'Throwaway 2' where id = $1`, [s]);
  await as(B, `delete from public.servers where id = $1`, [s]);
});

// ── Batch 3: notification settings, status expiry, inbox ──────────────────────────────
console.log('\n# Batch 3: notifications');
const unreadOf = async (uid, scope) => (await as(uid, `select mention_count from public.unread_summary() where scope_id = $1`, [scope])).rows[0]?.mention_count;
await expectOk('carol (mod) gets an @everyone mention badge by default', async () => {
  await as(A, `select public.mark_channel_read($1)`, [gen2]).catch(() => undefined);
  await as(C, `select public.mark_channel_read($1)`, [gen2]);
  await new Promise((r) => setTimeout(r, 25)); // PGlite's clock is coarse
  await as(A, `insert into public.messages (channel_id, content) values ($1, '@everyone hello')`, [gen2]);
  if ((await unreadOf(C, gen2)) !== 1) throw new Error(String(await unreadOf(C, gen2)));
});
await expectOk('suppress @everyone on the server hides it', async () => {
  await as(C, `insert into public.notification_settings (scope_id, scope_kind, suppress_everyone) values ($1, 'server', true)`, [srv2]);
  if ((await unreadOf(C, gen2)) !== 0) throw new Error(String(await unreadOf(C, gen2)));
});
await expectOk('direct mention still counts with suppression on', async () => {
  await new Promise((r) => setTimeout(r, 25));
  await as(A, `insert into public.messages (channel_id, content) values ($1, 'hey @carol, inbox test')`, [gen2]);
  if ((await unreadOf(C, gen2)) !== 1) throw new Error(String(await unreadOf(C, gen2)));
});
await expectOk('channel level "none" zeroes the badge', async () => {
  await as(C, `insert into public.notification_settings (scope_id, scope_kind, level) values ($1, 'channel', 'none')`, [gen2]);
  if ((await unreadOf(C, gen2)) !== 0) throw new Error(String(await unreadOf(C, gen2)));
});
await expectOk('settings are private to their owner', async () => {
  const r = await as(A, `select count(*)::int n from public.notification_settings`);
  if (r.rows[0].n !== 0) throw new Error('leak');
});
await expectError('cannot write settings for someone else', () =>
  as(A, `insert into public.notification_settings (user_id, scope_id, scope_kind, level) values ('${C}', $1, 'server', 'none')`, [srv2]), 'row-level security');
await expectOk('inbox lists carol\'s mentions, newest first', async () => {
  const r = await as(C, `select content from public.recent_mentions(null, 10)`);
  if (r.rows[0]?.content !== 'hey @carol, inbox test' || r.rows.length < 2) throw new Error(JSON.stringify(r.rows));
});
await expectOk('inbox hides mentions in servers you cannot see', async () => {
  const r = await as(B, `select count(*)::int n from public.recent_mentions(null, 100) m where m.channel_id = $1`, [gen2]);
  if (r.rows[0].n !== 0) throw new Error('leak');
});
await expectOk('custom status expiry is writable', () =>
  as(C, `update public.users set custom_status = 'brb', custom_status_expires_at = now() + interval '1 hour' where id = '${C}'`));

// ── Batch 4: voice states, moderation, stage, soundboard, profiles ──────────────────────
console.log('\n# Batch 4: voice & profiles');
const E = '55555555-5555-5555-5555-555555555555';
await db.exec(`insert into auth.users (id, raw_user_meta_data) values ('${E}', '{"username":"erin"}')`);
const stage2 = (await as(A, `select id from public.channels where server_id = $1 and type = 'stream'`, [srv2])).rows[0].id;
await expectOk('erin joins the server', async () => {
  const code = (await as(A, `insert into public.server_invites (server_id) values ($1) returning code`, [srv2])).rows[0].code;
  await as(E, `select public.join_server($1)`, [code]);
});
await expectOk('owner now has all 25 bits; @everyone gained soundboard + request to speak', async () => {
  const r = await as(E, `select public.server_permissions($1) p`, [srv2]);
  const p = BigInt(r.rows[0].p);
  if (!(p & (1n << 22n)) || !(p & (1n << 24n)) || (p & (1n << 23n))) throw new Error(p.toString(2));
});
await expectError('outsider cannot join the voice channel', () => as(B, `select public.voice_join($1)`, [voice2]), 'permission');
await expectOk('erin joins voice; members see her, outsiders do not', async () => {
  await as(E, `select public.voice_join($1)`, [voice2]);
  const seen = (await as(A, `select channel_id from public.voice_states where user_id = '${E}'`)).rows[0]?.channel_id;
  const leak = (await as(B, `select count(*)::int n from public.voice_states`)).rows[0].n;
  if (seen !== voice2 || leak !== 0) throw new Error(`${seen} ${leak}`);
});
await expectOk('heartbeat updates own flags', async () => {
  await as(E, `select public.voice_update(true, false, true, false)`);
  const r = (await as(E, `select self_mute, streaming from public.voice_states where user_id = '${E}'`)).rows[0];
  if (!r.self_mute || !r.streaming) throw new Error(JSON.stringify(r));
});
await expectError('voice_states cannot be written directly', () => as(E, `update public.voice_states set server_mute = false where user_id = '${E}'`), 'permission denied');
await expectError('erin cannot server-mute the owner', () => as(E, `select public.voice_moderate('${A}', true, null)`), 'not in voice');
await expectOk('owner joins and server-mutes erin (audited)', async () => {
  await as(A, `select public.voice_join($1)`, [voice2]);
  await as(A, `select public.voice_moderate('${E}', true, null)`);
  const r = (await as(A, `select server_mute from public.voice_states where user_id = '${E}'`)).rows[0];
  const log = (await as(A, `select count(*)::int n from public.audit_log where action = 'voice_server_mute'`)).rows[0].n;
  if (!r.server_mute || log !== 1) throw new Error(`${r.server_mute} ${log}`);
});
await expectError('erin cannot server-mute the owner back', () => as(E, `select public.voice_moderate('${A}', true, null)`), 'Mute Members');
await expectOk('server mute follows erin into the stage, where she joins the audience', async () => {
  await as(E, `select public.voice_join($1)`, [stage2]);
  const r = (await as(E, `select server_mute, suppressed from public.voice_states where user_id = '${E}'`)).rows[0];
  if (!r.server_mute || !r.suppressed) throw new Error(JSON.stringify(r));
});
await expectOk('erin raises her hand', async () => {
  await as(E, `select public.stage_request_to_speak(true)`);
  const r = (await as(A, `select request_to_speak_at from public.voice_states where user_id = '${E}'`)).rows[0];
  if (!r.request_to_speak_at) throw new Error('no hand');
});
await expectError('erin cannot make herself a speaker', () => as(E, `select public.stage_set_speaker('${E}', true)`), 'stage moderators');
await expectOk('owner invites erin to speak', async () => {
  await as(A, `select public.stage_set_speaker('${E}', true)`);
  const r = (await as(A, `select suppressed, request_to_speak_at from public.voice_states where user_id = '${E}'`)).rows[0];
  if (r.suppressed || r.request_to_speak_at) throw new Error(JSON.stringify(r));
});
await expectOk('erin steps down to the audience herself', () => as(E, `select public.stage_set_speaker('${E}', false)`));
await expectError('erin cannot move people', () => as(E, `select public.voice_move('${A}', $1)`, [stage2]), 'Move Members');
await expectOk('owner moves erin back to the voice channel', async () => {
  await as(A, `select public.voice_move('${E}', $1)`, [voice2]);
  const r = (await as(A, `select channel_id, suppressed from public.voice_states where user_id = '${E}'`)).rows[0];
  if (r.channel_id !== voice2 || r.suppressed) throw new Error(JSON.stringify(r));
});
await expectOk('owner disconnects erin (audited)', async () => {
  await as(A, `select public.voice_disconnect('${E}')`);
  const n = (await as(A, `select count(*)::int n from public.voice_states where user_id = '${E}'`)).rows[0].n;
  const log = (await as(A, `select count(*)::int n from public.audit_log where action in ('voice_disconnect', 'voice_move')`)).rows[0].n;
  if (n !== 0 || log !== 2) throw new Error(`${n} ${log}`);
});
await expectOk('user limit is enforced for regular members', async () => {
  await as(A, `update public.channels set user_limit = 1 where id = $1`, [voice2]);
  let blocked = false;
  try { await as(E, `select public.voice_join($1)`, [voice2]); } catch (e) { blocked = e.message.includes('full'); }
  await as(A, `update public.channels set user_limit = null where id = $1`, [voice2]);
  if (!blocked) throw new Error('not blocked');
});
await expectOk('leaving the server leaves its voice', async () => {
  await as(E, `select public.voice_join($1)`, [voice2]);
  await as(A, `select public.kick_member($1, '${E}', null)`, [srv2]);
  const n = (await as(A, `select count(*)::int n from public.voice_states where user_id = '${E}'`)).rows[0].n;
  if (n !== 0) throw new Error('still in voice');
});
await expectOk('erin rejoins the server', async () => {
  const code = (await as(A, `insert into public.server_invites (server_id) values ($1) returning code`, [srv2])).rows[0].code;
  await as(E, `select public.join_server($1)`, [code]);
});

await expectError('members without Manage Expressions cannot add sounds', () =>
  as(E, `insert into public.soundboard_sounds (server_id, name, url) values ($1, 'boom', 'https://x.test/boom.mp3')`, [srv2]), 'row-level security');
await expectOk('owner adds a sound (audited); members can list it, outsiders cannot', async () => {
  await as(A, `insert into public.soundboard_sounds (server_id, name, emoji, url) values ($1, 'boom', '💥', 'https://x.test/boom.mp3')`, [srv2]);
  const seen = (await as(E, `select count(*)::int n from public.soundboard_sounds`)).rows[0].n;
  const leak = (await as(B, `select count(*)::int n from public.soundboard_sounds`)).rows[0].n;
  const log = (await as(A, `select count(*)::int n from public.audit_log where action = 'sound_create'`)).rows[0].n;
  if (seen !== 1 || leak !== 0 || log !== 1) throw new Error(`${seen} ${leak} ${log}`);
});
await expectError('soundboard uploads need Manage Expressions', () =>
  as(E, `insert into storage.objects (bucket_id, name) values ('soundboard', $1)`, [`${srv2}/x.mp3`]), 'row-level security');

await expectOk('profile customization fields are writable', () =>
  as(E, `update public.users set pronouns = 'she/her', name_font = 'pixel', name_effect = 'rainbow', name_color_a = '#ff00aa',
         profile_effect = 'sparkles', card_style = 'aurora', avatar_shape = 'squircle', theme_preset = 'tokyo-night',
         profile_links = '[{"label":"GitHub","url":"https://github.com/erin"}]' where id = '${E}'`));
await expectError('profile links must be https', () =>
  as(E, `update public.users set profile_links = '[{"label":"x","url":"javascript:alert(1)"}]' where id = '${E}'`), 'check');
await expectError('unknown profile effects are rejected', () =>
  as(E, `update public.users set profile_effect = 'Explode!' where id = '${E}'`), 'check');

// ── Batch 5: threads, forums, announcements, events ─────────────────────────────────────
console.log('\n# Batch 5: threads, forums, announcements, events');
const starter = (await as(A, `insert into public.messages (channel_id, content) values ($1, 'Thread starter: what should we build next?') returning id`, [gen2])).rows[0].id;
const thread1 = (await expectOk('erin starts a public thread from a message', async () => {
  const r = await as(E, `select * from public.create_thread($1, '', $2)`, [gen2, starter]);
  const t = r.rows[0];
  const m = (await as(E, `select thread_id from public.messages where id = $1`, [starter])).rows[0];
  if (t.thread_parent_id !== gen2 || m.thread_id !== t.id || !t.name.startsWith('Thread starter')) throw new Error(JSON.stringify(t));
  return r;
}))?.rows[0].id;
await expectError('a message can only have one thread', () => as(C, `select public.create_thread($1, 'again', $2)`, [gen2, starter]), 'already has a thread');
await expectOk('posting in a thread counts and auto-joins', async () => {
  await as(C, `insert into public.messages (channel_id, content) values ($1, 'a game!')`, [thread1]);
  const t = (await as(C, `select thread_message_count from public.channels where id = $1`, [thread1])).rows[0];
  const mem = (await as(C, `select count(*)::int n from public.thread_members where thread_id = $1`, [thread1])).rows[0].n;
  if (t.thread_message_count !== 1 || mem !== 2) throw new Error(`${t.thread_message_count} ${mem}`);
});
await expectOk('outsiders cannot see threads or their messages', async () => {
  const a = (await as(B, `select count(*)::int n from public.channels where id = $1`, [thread1])).rows[0].n;
  const b = (await as(B, `select count(*)::int n from public.messages where channel_id = $1`, [thread1])).rows[0].n;
  if (a + b !== 0) throw new Error('leak');
});
const priv = (await expectOk('erin starts a private thread', () => as(E, `select * from public.create_thread($1, 'secret plans', null, true)`, [gen2])))?.rows[0].id;
await expectOk('carol cannot see the private thread until added', async () => {
  const before = (await as(C, `select count(*)::int n from public.channels where id = $1`, [priv])).rows[0].n;
  await as(E, `select public.add_thread_member($1, '${C}')`, [priv]);
  const after = (await as(C, `select count(*)::int n from public.channels where id = $1`, [priv])).rows[0].n;
  if (before !== 0 || after !== 1) throw new Error(`${before} ${after}`);
});
await expectError('private threads cannot start from a message', () => as(E, `select public.create_thread($1, 'x', $2, true)`, [gen2, starter]), 'Private threads');
await expectError('only Manage Threads can lock', () => as(E, `select public.update_thread($1, p_locked => true)`, [thread1]), 'Manage Threads');
await expectOk('owner locks the thread; erin can no longer post, the owner can', async () => {
  await as(A, `select public.update_thread($1, p_locked => true)`, [thread1]);
  let blocked = false;
  try { await as(E, `insert into public.messages (channel_id, content) values ($1, 'hey')`, [thread1]); } catch { blocked = true; }
  await as(A, `insert into public.messages (channel_id, content) values ($1, 'locked, sorry')`, [thread1]);
  if (!blocked) throw new Error('not blocked');
});
await expectOk('archiving, then posting, reopens a thread', async () => {
  await as(E, `select public.update_thread($1, p_archived => true)`, [priv]);
  const a = (await as(E, `select thread_archived_at from public.channels where id = $1`, [priv])).rows[0].thread_archived_at;
  await as(E, `insert into public.messages (channel_id, content) values ($1, 'back')`, [priv]);
  const b = (await as(E, `select thread_archived_at from public.channels where id = $1`, [priv])).rows[0].thread_archived_at;
  if (!a || b) throw new Error(`${a} ${b}`);
});
await expectOk('threads only count as unread once joined', async () => {
  const t2 = (await as(E, `select id from public.create_thread($1, 'unread test')`, [gen2])).rows[0].id;
  await as(E, `insert into public.messages (channel_id, content) values ($1, 'ping')`, [t2]);
  const before = (await as(C, `select count(*)::int n from public.unread_summary() where scope_id = $1`, [t2])).rows[0].n;
  await as(C, `select public.join_thread($1)`, [t2]);
  const after = (await as(C, `select count(*)::int n from public.unread_summary() where scope_id = $1`, [t2])).rows[0].n;
  if (before !== 0 || after !== 1) throw new Error(`${before} ${after}`);
});

const forum = (await expectOk('owner creates a forum with tags and required tags', () =>
  as(A, `insert into public.channels (server_id, name, subtype, forum_tags, require_tag) values ($1, 'ideas', 'forum', $2::jsonb, true) returning id`,
    [srv2, JSON.stringify([{ id: 'bug', name: 'Bug', emoji: '🐛' }, { id: 'feat', name: 'Feature', emoji: '✨' }])])))?.rows[0].id;
await expectError('no messages directly in a forum', () => as(E, `insert into public.messages (channel_id, content) values ($1, 'hi')`, [forum]), 'creating a post');
await expectError('forum posts need a tag here', () => as(E, `select public.create_thread($1, 'My idea')`, [forum]), 'requires at least one tag');
await expectError('unknown tags are rejected', () => as(E, `select public.create_thread($1, 'My idea', null, false, array['nope'])`, [forum]), 'tags');
await expectOk('erin creates a forum post and its first message bumps the forum', async () => {
  const post = (await as(E, `select id from public.create_thread($1, 'Dark mode for the dark mode', null, false, array['feat'])`, [forum])).rows[0].id;
  await as(E, `insert into public.messages (channel_id, content) values ($1, 'even darker please')`, [post]);
  const f = (await as(E, `select last_message_at from public.channels where id = $1`, [forum])).rows[0].last_message_at;
  if (!f) throw new Error('forum not bumped');
});
await expectError('forum channels cannot be converted', () => as(A, `update public.channels set subtype = null where id = $1`, [forum]), 'converted');

const ann = (await expectOk('owner creates an announcement channel', () =>
  as(A, `insert into public.channels (server_id, name, subtype) values ($1, 'news', 'announcement') returning id`, [srv2])))?.rows[0].id;
await expectError('members cannot post in announcement channels', () => as(E, `insert into public.messages (channel_id, content) values ($1, 'hi')`, [ann]), 'row-level security');
const erinServer = (await as(E, `insert into public.servers (name) values ('Erin Fans') returning id`)).rows[0].id;
const erinGeneral = (await as(E, `select id from public.channels where server_id = $1 and type = 'text' order by position limit 1`, [erinServer])).rows[0].id;
await expectError('cannot follow into a channel you do not manage', () => as(E, `select public.follow_channel($1, $2)`, [ann, gen2]), 'Manage Channels');
await expectOk('erin follows the announcements into her own server', () => as(E, `select public.follow_channel($1, $2)`, [ann, erinGeneral]));
await expectOk('publishing crossposts to followers without pinging anyone', async () => {
  const msg = (await as(A, `insert into public.messages (channel_id, content) values ($1, 'v1.0 is out @everyone') returning id`, [ann])).rows[0].id;
  const n = (await as(A, `select public.publish_message($1) n`, [msg])).rows[0].n;
  const copy = (await as(E, `select author_id, crossposted_from, mention_everyone from public.messages where channel_id = $1 and crossposted_from is not null`, [erinGeneral])).rows[0];
  if (n !== 1 || copy?.author_id !== A || copy.crossposted_from.server_name !== 'Test' || copy.mention_everyone) throw new Error(JSON.stringify({ n, copy }));
  let again = false;
  try { await as(A, `select public.publish_message($1)`, [msg]); } catch (e) { again = e.message.includes('Already'); }
  if (!again) throw new Error('published twice');
});
await expectError('erin cannot publish the owner\'s announcement', async () => {
  const msg = (await as(A, `insert into public.messages (channel_id, content) values ($1, 'second') returning id`, [ann])).rows[0].id;
  await as(E, `select public.publish_message($1)`, [msg]);
}, 'author or a moderator');

await expectError('members without Manage Events cannot schedule', () =>
  as(E, `insert into public.server_events (server_id, channel_id, name, starts_at) values ($1, $2, 'Movie night', now() + interval '1 day')`, [srv2, voice2]), 'row-level security');
const event = (await expectOk('owner schedules an event in a voice channel', () =>
  as(A, `insert into public.server_events (server_id, channel_id, name, starts_at) values ($1, $2, 'Movie night', now() + interval '1 day') returning id`, [srv2, voice2])))?.rows[0].id;
await expectError('events cannot start in the past', () =>
  as(A, `insert into public.server_events (server_id, location, name, starts_at) values ($1, 'The park', 'Picnic', now() - interval '1 day')`, [srv2]), 'future');
await expectOk('erin RSVPs; outsiders see neither the event nor RSVPs', async () => {
  await as(E, `insert into public.event_rsvps (event_id) values ($1)`, [event]);
  const n = (await as(A, `select count(*)::int n from public.event_rsvps where event_id = $1`, [event])).rows[0].n;
  const leak = (await as(B, `select count(*)::int n from public.server_events`)).rows[0].n;
  if (n !== 1 || leak !== 0) throw new Error(`${n} ${leak}`);
});
await expectOk('starting the event is audited', async () => {
  await as(A, `update public.server_events set status = 'active' where id = $1`, [event]);
  const log = (await as(A, `select count(*)::int n from public.audit_log where action = 'event_active'`)).rows[0].n;
  if (log !== 1) throw new Error(String(log));
});

// ── Batch 6: privacy, safety, accounts ──────────────────────────────────────────────────
console.log('\n# Batch 6: privacy, safety, accounts');
await expectOk('erin limits DMs to friends', () => as(E, `insert into public.privacy_settings (dm_policy) values ('friends')`));
await expectError('carol (a server-mate, not a friend) cannot open a DM with erin', () => as(C, `select public.open_dm('${E}')`), 'only accepts direct messages from friends');
const reqConv = (await expectOk('with server-mates allowed again, carol\'s DM lands in erin\'s message requests', async () => {
  await as(E, `update public.privacy_settings set dm_policy = 'servers' where user_id = '${E}'`);
  const conv = (await as(C, `select public.open_dm('${E}') id`)).rows[0].id;
  const row = (await as(E, `select request_pending from public.conversation_members where conversation_id = $1 and user_id = '${E}'`, [conv])).rows[0];
  if (!row?.request_pending) throw new Error('not pending');
  return { rows: [{ id: conv }] };
}))?.rows[0].id;
await expectOk('pending requests do not create unread badges', async () => {
  await as(C, `insert into public.messages (conversation_id, content) values ($1, 'hey erin, got a sec?')`, [reqConv]);
  const n = (await as(E, `select count(*)::int n from public.unread_summary() where scope_id = $1`, [reqConv])).rows[0].n;
  if (n !== 0) throw new Error('badged');
});
await expectOk('erin accepts the request', async () => {
  await as(E, `select public.respond_message_request($1, true)`, [reqConv]);
  const n = (await as(E, `select count(*)::int n from public.unread_summary() where scope_id = $1`, [reqConv])).rows[0].n;
  if (n !== 1) throw new Error(String(n));
});
await expectOk('switching to friends-only also stops carol sending in the existing DM', async () => {
  await as(E, `update public.privacy_settings set dm_policy = 'friends' where user_id = '${E}'`);
  let blocked = false;
  try { await as(C, `insert into public.messages (conversation_id, content) values ($1, 'still there?')`, [reqConv]); } catch { blocked = true; }
  await as(E, `update public.privacy_settings set dm_policy = 'servers' where user_id = '${E}'`);
  if (!blocked) throw new Error('not blocked');
});
await expectOk('erin turns friend requests off', () => as(E, `update public.privacy_settings set friend_request_policy = 'nobody' where user_id = '${E}'`));
await expectError('nobody can send erin a friend request', () => as(C, `select public.send_friend_request('erin')`), 'accepting friend requests');
await expectOk('with "mutuals", a server-mate can', async () => {
  await as(E, `update public.privacy_settings set friend_request_policy = 'mutuals' where user_id = '${E}'`);
  const r = (await as(C, `select public.send_friend_request('erin') r`)).rows[0].r;
  if (r !== 'sent') throw new Error(r);
});
await expectError('but a stranger cannot', () => as(B, `select public.send_friend_request('erin')`), 'share a server or a friend');
await expectOk('privacy settings are private', async () => {
  const n = (await as(A, `select count(*)::int n from public.privacy_settings`)).rows[0].n;
  if (n !== 0) throw new Error('leak');
});

await expectOk('erin sets a server profile', async () => {
  await as(E, `select public.set_server_profile($1, 'https://x.test/a.png', null, 'Here for the memes')`, [srv2]);
  const r = (await as(A, `select avatar_url, bio from public.server_members where server_id = $1 and user_id = '${E}'`, [srv2])).rows[0];
  if (r.bio !== 'Here for the memes' || !r.avatar_url) throw new Error(JSON.stringify(r));
});
await expectError('server avatars must be https', () => as(E, `select public.set_server_profile($1, 'http://x.test/a.png', null, null)`, [srv2]), 'check');
await expectOk('notes are private to their author', async () => {
  await as(E, `insert into public.user_notes (target_id, note, nickname) values ('${A}', 'runs the Test server', 'Boss')`);
  const mine = (await as(E, `select count(*)::int n from public.user_notes`)).rows[0].n;
  const theirs = (await as(A, `select count(*)::int n from public.user_notes`)).rows[0].n;
  if (mine !== 1 || theirs !== 0) throw new Error(`${mine} ${theirs}`);
});
await expectOk('mutual servers only lists servers you share', async () => {
  const r = await as(A, `select name from public.mutual_servers('${E}')`);
  const b = await as(B, `select count(*)::int n from public.mutual_servers('${E}')`);
  if (!r.rows.some((x) => x.name === 'Test') || b.rows[0].n !== 0) throw new Error(JSON.stringify(r.rows));
});

await expectOk('owner sets up AutoMod rules', async () => {
  await as(A, `insert into public.automod_rules (server_id, name, trigger, keywords, allow_list) values ($1, 'No bad words', 'keyword', '{badword,"scam*"}', '{}')`, [srv2]);
  await as(A, `insert into public.automod_rules (server_id, name, trigger, allow_list) values ($1, 'Links', 'link', '{youtube.com}')`, [srv2]);
  await as(A, `insert into public.automod_rules (server_id, name, trigger, keywords, action, timeout_minutes) values ($1, 'Zero tolerance', 'keyword', '{timeoutme}', 'block_and_timeout', 5)`, [srv2]);
});
await expectError('members cannot read or edit AutoMod rules', async () => {
  const n = (await as(E, `select count(*)::int n from public.automod_rules`)).rows[0].n;
  if (n === 0) throw new Error('hidden as expected');
}, 'hidden as expected');
await expectOk('a blocked keyword drops the message and tells the sender why', async () => {
  const r = await as(E, `insert into public.messages (channel_id, content) values ($1, 'this is a BADWORD lol') returning id`, [gen2]);
  const ev = (await as(E, `select rule_name, matched from public.automod_events where user_id = '${E}' order by id desc limit 1`)).rows[0];
  if (r.rows.length !== 0 || ev?.rule_name !== 'No bad words' || ev.matched !== 'badword') throw new Error(JSON.stringify({ r: r.rows, ev }));
});
await expectOk('wildcards match and allowed words pass', async () => {
  const blocked = await as(E, `insert into public.messages (channel_id, content) values ($1, 'free scammers here') returning id`, [gen2]);
  const fine = await as(E, `insert into public.messages (channel_id, content) values ($1, 'a perfectly good word') returning id`, [gen2]);
  if (blocked.rows.length !== 0 || fine.rows.length !== 1) throw new Error(`${blocked.rows.length} ${fine.rows.length}`);
});
await expectOk('links outside the allow list are blocked; allowed domains pass', async () => {
  const bad = await as(E, `insert into public.messages (channel_id, content) values ($1, 'go to https://evil.example.com/x') returning id`, [gen2]);
  const ok = await as(E, `insert into public.messages (channel_id, content) values ($1, 'watch https://www.youtube.com/watch?v=1') returning id`, [gen2]);
  if (bad.rows.length !== 0 || ok.rows.length !== 1) throw new Error(`${bad.rows.length} ${ok.rows.length}`);
});
await expectOk('server managers are exempt from AutoMod', async () => {
  const r = await as(A, `insert into public.messages (channel_id, content) values ($1, 'badword (testing the filter)') returning id`, [gen2]);
  if (r.rows.length !== 1) throw new Error('blocked');
});
await expectOk('"block and timeout" times the member out', async () => {
  await as(E, `insert into public.messages (channel_id, content) values ($1, 'timeoutme please')`, [gen2]);
  const t = (await as(A, `select timed_out_until from public.server_members where server_id = $1 and user_id = '${E}'`, [srv2])).rows[0].timed_out_until;
  if (!t || new Date(t) <= new Date()) throw new Error('not timed out');
  await as(A, `select public.timeout_member($1, '${E}', 0, 'test over')`, [srv2]);
});
await expectOk('moderators see AutoMod events; carol (no Manage Messages) does not', async () => {
  const a = (await as(A, `select count(*)::int n from public.automod_events where server_id = $1`, [srv2])).rows[0].n;
  const c = (await as(C, `select count(*)::int n from public.automod_events where server_id = $1`, [srv2])).rows[0].n;
  if (a < 4 || c !== 0) throw new Error(`${a} ${c}`);
});
await as(A, `delete from public.automod_rules where server_id = $1`, [srv2]);

const reported = (await as(A, `insert into public.messages (channel_id, content) values ($1, 'report me') returning id`, [gen2])).rows[0].id;
const report = (await expectOk('erin reports a message; the server and a snapshot are filled in', async () => {
  const r = await as(E, `insert into public.reports (message_id, reason, details) values ($1, 'spam', 'testing') returning id`, [reported]);
  const row = (await as(A, `select server_id, target_user_id, snapshot from public.reports where id = $1`, [r.rows[0].id])).rows[0];
  if (row.server_id !== srv2 || row.target_user_id !== A || row.snapshot.content !== 'report me') throw new Error(JSON.stringify(row));
  return r;
}))?.rows[0].id;
await expectError('outsiders cannot report messages they cannot see', () =>
  as(B, `insert into public.reports (message_id, reason) values ($1, 'spam')`, [reported]), "can't report");
await expectOk('carol (no Manage Messages) cannot see the report; the owner can resolve it', async () => {
  const c = (await as(C, `select count(*)::int n from public.reports`)).rows[0].n;
  await as(A, `select public.resolve_report($1, 'resolved', 'warned them')`, [report]);
  const mine = (await as(E, `select status from public.reports where id = $1`, [report])).rows[0].status;
  if (c !== 0 || mine !== 'resolved') throw new Error(`${c} ${mine}`);
});
await expectError('members cannot resolve reports', () => as(E, `select public.resolve_report($1, 'dismissed')`, [report]), "can't review");

await expectError('erin cannot delete her account while she owns a server', () => as(E, `select public.delete_my_account()`), 'Transfer or delete');
await expectError('only the owner can transfer a server', () => as(E, `select public.transfer_server($1, '${A}')`, [srv2]), 'Only the owner');
await expectOk('erin transfers Erin Fans to carol', async () => {
  const code = (await as(E, `insert into public.server_invites (server_id) values ($1) returning code`, [erinServer])).rows[0].code;
  await as(C, `select public.join_server($1)`, [code]);
  await as(E, `select public.transfer_server($1, '${C}')`, [erinServer]);
  const owner = (await as(C, `select owner_id from public.servers where id = $1`, [erinServer])).rows[0].owner_id;
  if (owner !== C) throw new Error(owner);
});
await expectOk('data export includes profile, servers and messages', async () => {
  const d = (await as(E, `select public.export_my_data() d`)).rows[0].d;
  if (d.profile.username !== 'erin' || !d.servers.length || !d.messages.length || !Array.isArray(d.notes)) throw new Error(Object.keys(d).join(','));
});
const F = '66666666-6666-6666-6666-666666666666';
await db.exec(`insert into auth.users (id, raw_user_meta_data) values ('${F}', '{"username":"frank"}')`);
await expectOk('a user can delete their account', async () => {
  await as(F, `select public.delete_my_account()`);
  const n = (await as(A, `select count(*)::int n from public.users where id = '${F}'`)).rows[0].n;
  if (n !== 0) throw new Error('still there');
});

// ── 1.0: admins, people search, open message requests, nameplates & widgets ─────────────
console.log('\n# 1.0: admin, search, requests');
await db.exec(`update public.users set is_admin = true where id = '${A}'`); // bootstrap, like the service role would
await expectOk('admins see platform stats; others are refused', async () => {
  const s = (await as(A, `select public.admin_stats() s`)).rows[0].s;
  if (!(s.users >= 4)) throw new Error(JSON.stringify(s));
  let refused = false;
  try { await as(E, `select public.admin_stats()`); } catch (e) { refused = e.message.includes('Admins only'); }
  if (!refused) throw new Error('not refused');
});
await expectError('users cannot make themselves admin', () => as(E, `update public.users set is_admin = true where id = '${E}'`), 'permission denied');
await expectOk('admin grants admin and badges to carol', async () => {
  await as(A, `select public.admin_set_admin('${C}', true)`);
  await as(A, `select public.admin_set_badges('${C}', '["staff","moderator"]'::jsonb)`);
  const r = (await as(C, `select is_admin, badge_ids from public.users where id = '${C}'`)).rows[0];
  if (!r.is_admin || r.badge_ids.length !== 2) throw new Error(JSON.stringify(r));
  await as(A, `select public.admin_set_admin('${C}', false)`);
});
await expectError('admins cannot remove their own admin', () => as(A, `select public.admin_set_admin('${A}', false)`), 'own admin');
await expectOk('admin search shows emails only to admins', async () => {
  const r = await as(A, `select username from public.admin_search_users('erin')`);
  if (r.rows[0]?.username !== 'erin') throw new Error(JSON.stringify(r.rows));
});
await expectOk('admin sets the message request limit to 2', () => as(A, `select public.admin_set_config('message_request_limit', '2'::jsonb)`));
await expectError('only admins change app config', () => as(E, `select public.admin_set_config('message_request_limit', '99'::jsonb)`), 'Admins only');

await expectOk('people search finds discoverable users and hides blocked ones', async () => {
  const r = await as(B, `select username from public.search_users('car')`);
  if (!r.rows.some((x) => x.username === 'carol')) throw new Error(JSON.stringify(r.rows));
  await as(E, `update public.users set discoverable = false where id = '${E}'`);
  const hidden = await as(B, `select count(*)::int n from public.search_users('erin')`);
  await as(E, `update public.users set discoverable = true where id = '${E}'`);
  if (hidden.rows[0].n !== 0) throw new Error('found');
});
const strangerConv = (await expectOk('a stranger (bob, no shared server) can message erin as a request', async () => {
  await as(E, `update public.privacy_settings set dm_policy = 'everyone' where user_id = '${E}'`);
  const conv = (await as(B, `select public.open_dm('${E}') id`)).rows[0].id;
  const pending = (await as(E, `select request_pending from public.conversation_members where conversation_id = $1 and user_id = '${E}'`, [conv])).rows[0];
  if (!pending?.request_pending) throw new Error('not a request');
  return { rows: [{ id: conv }] };
}))?.rows[0].id;
await expectOk('...up to the configured limit', async () => {
  await as(B, `insert into public.messages (conversation_id, content) values ($1, 'hi!')`, [strangerConv]);
  await as(B, `insert into public.messages (conversation_id, content) values ($1, 'saw your post')`, [strangerConv]);
  let capped = false;
  try { await as(B, `insert into public.messages (conversation_id, content) values ($1, 'hello??')`, [strangerConv]); } catch (e) { capped = e.message.includes("haven't accepted"); }
  if (!capped) throw new Error('not capped');
});
await expectOk('once accepted, the limit is gone', async () => {
  await as(E, `select public.respond_message_request($1, true)`, [strangerConv]);
  await as(B, `insert into public.messages (conversation_id, content) values ($1, 'thanks for accepting')`, [strangerConv]);
});
await expectOk('nameplates, frames and widgets are writable; bad widgets are rejected', async () => {
  await as(E, `update public.users set nameplate = 'aurora', card_frame = 'roses', profile_widgets = '[{"type":"favorite_game","name":"VALORANT"}]' where id = '${E}'`);
  let rejected = false;
  try { await as(E, `update public.users set profile_widgets = '[{"type":"malware"}]' where id = '${E}'`); } catch { rejected = true; }
  if (!rejected) throw new Error('accepted');
});
await expectOk('admins can see and resolve DM reports', async () => {
  const id = (await as(E, `insert into public.reports (target_user_id, reason, details) values ('${B}', 'spam', 'unsolicited') returning id`)).rows[0].id;
  await as(A, `select public.resolve_report($1, 'resolved', 'warned')`, [id]);
  const r = (await as(E, `select status from public.reports where id = $1`, [id])).rows[0];
  if (r.status !== 'resolved') throw new Error(r.status);
});

await expectOk('invite codes work in any case and preview the server', async () => {
  const d = (await as(B, `select name, is_member, member_count from public.invite_details('TESTVANITY')`)).rows[0];
  if (d?.name !== 'Test' || d.is_member || !(d.member_count > 1)) throw new Error(JSON.stringify(d));
});
await expectError('unknown invite codes give a friendly error', () => as(B, `select public.join_server('nope-not-real')`), "doesn't exist");

await expectOk('presence status column is writable', () => as(C, `update public.users set presence_status = 'dnd' where id = '${C}'`));
await expectError('badge_ids still not writable', () => as(C, `update public.users set badge_ids = '["staff"]' where id = '${C}'`));

console.log('\nPlatform moderation (1.1)');
const G = '77777777-7777-7777-7777-777777777777';
await db.exec(`insert into auth.users (id, raw_user_meta_data) values ('${G}', '{"username":"gina"}')`);
await expectError('non-admins cannot warn', () => as(B, `select public.admin_warn_user('${D}', 'spam', 'x', 1)`), 'Admins only');
await expectError('admins cannot warn themselves', () => as(A, `select public.admin_warn_user('${A}', 'spam', 'x', 1)`), 'own account');
await expectOk('a warning raises the danger level and shows up for the user', async () => {
  await as(A, `select public.admin_warn_user('${D}', 'harassment', 'Be nice', 3, 90)`);
  const m = (await as(D, `select public.my_moderation() m`)).rows[0].m;
  if (m.level !== 'medium' || m.points !== 3 || m.unacknowledged.length !== 1 || m.ban) throw new Error(JSON.stringify(m));
  await as(D, `select public.acknowledge_warnings()`);
  const m2 = (await as(D, `select public.my_moderation() m`)).rows[0].m;
  if (m2.unacknowledged.length !== 0) throw new Error('not acknowledged');
});
await expectOk('revoking a warning and pinning a level', async () => {
  const id = (await as(A, `select public.admin_warn_user('${D}', 'spam', null, 4, null) id`)).rows[0].id;
  let lvl = (await as(A, `select public.admin_user_detail('${D}') ->> 'level' l`)).rows[0].l;
  if (lvl !== 'high') throw new Error(lvl);
  await as(A, `select public.admin_set_warning_state($1, 'revoke')`, [id]);
  await as(A, `select public.admin_set_standing('${D}', 'low', 'watching')`);
  lvl = (await as(A, `select public.admin_user_detail('${D}') ->> 'level' l`)).rows[0].l;
  if (lvl !== 'low') throw new Error(lvl);
  await as(A, `select public.admin_set_standing('${D}', null, null)`);
  await as(A, `select public.admin_set_warning_state($1, 'delete')`, [id]);
});
await expectError('users cannot read the warnings table directly', () => as(D, `select * from public.user_warnings`), 'permission denied');
await expectOk('a timed ban locks the account out of everything', async () => {
  await as(A, `select public.admin_ban_user('${D}', 'Spamming invites', 24)`);
  const n = (await as(D, `select count(*)::int n from public.users`)).rows[0].n;
  if (n !== 0) throw new Error(`banned user still reads ${n} users`);
  const m = (await as(D, `select public.my_moderation() m`)).rows[0].m;
  if (!m.ban || !m.ban.expires_at) throw new Error(JSON.stringify(m));
});
await expectError('a banned user cannot write through definer functions', () => as(D, `select public.send_friend_request('alice')`), 'banned');
await expectError('a banned user cannot write directly', () => as(D, `update public.users set display_name = 'x' where id = '${D}' returning id`).then((r) => { if (!r.rows.length) throw new Error('no rows updated'); }));
await expectOk('a banned user can appeal once', () => as(D, `select public.submit_ban_appeal('I am sorry, it will not happen again.')`));
await expectError('only one open appeal at a time', () => as(D, `select public.submit_ban_appeal('Please, again, I am really sorry.')`), 'already');
await expectOk('admins accept the appeal and the ban is lifted', async () => {
  const list = (await as(A, `select public.admin_list_appeals('open') l`)).rows[0].l;
  const ap = list.find((a) => a.user_id === D);
  if (!ap) throw new Error('appeal not listed');
  await as(A, `select public.admin_review_appeal($1, true, 'Welcome back')`, [ap.id]);
  const n = (await as(D, `select count(*)::int n from public.users`)).rows[0].n;
  if (n === 0) throw new Error('still banned');
});
await expectOk('permanent ban and pardon', async () => {
  await as(A, `select public.admin_ban_user('${D}', 'Ban evasion', null)`);
  if (!(await as(A, `select public.is_banned('${D}') b`)).rows[0].b) throw new Error('not banned');
  await as(A, `select public.admin_unban_user('${D}', 'Pardoned')`);
  if ((await as(A, `select public.is_banned('${D}') b`)).rows[0].b) throw new Error('still banned');
});
await expectError('admins cannot ban other admins', async () => {
  await as(A, `select public.admin_set_admin('${C}', true)`);
  try { await as(A, `select public.admin_ban_user('${C}', 'x', 1)`); } finally { await as(A, `select public.admin_set_admin('${C}', false)`); }
}, 'Remove their admin');
await expectOk('admins edit profiles; taken usernames are refused', async () => {
  await as(A, `select public.admin_update_profile('${G}', 'gina_renamed', 'Gina', 'hello', true, true)`);
  const r = (await as(A, `select username::text u, display_name from public.users where id = '${G}'`)).rows[0];
  if (r.u !== 'gina_renamed' || r.display_name !== 'Gina') throw new Error(JSON.stringify(r));
  let refused = false;
  try { await as(A, `select public.admin_update_profile('${G}', 'BOB', null, null)`); } catch (e) { refused = e.message.includes('taken'); }
  if (!refused) throw new Error('duplicate username accepted');
});
await expectOk('user detail, audit log and search filters', async () => {
  const d = (await as(A, `select public.admin_user_detail('${D}') d`)).rows[0].d;
  if (d.bans.length < 2 || d.warnings.length < 1 || d.audit.length < 3) throw new Error(JSON.stringify({ b: d.bans.length, w: d.warnings.length, a: d.audit.length }));
  const log = (await as(A, `select public.admin_audit_list(50) l`)).rows[0].l;
  if (!log.some((l) => l.action === 'ban')) throw new Error('no ban in audit');
  const warned = (await as(A, `select username from public.admin_search_users('is:warned')`)).rows.map((r) => r.username);
  if (!warned.includes('dave')) throw new Error(JSON.stringify(warned));
});
await expectOk('admins delete accounts', async () => {
  await as(A, `select public.admin_delete_user('${G}', 'Test account')`);
  const n = (await as(A, `select count(*)::int n from public.users where id = '${G}'`)).rows[0].n;
  if (n !== 0) throw new Error('still there');
});
await expectError('non-admins cannot delete accounts', () => as(B, `select public.admin_delete_user('${D}', 'x')`), 'Admins only');

console.log('\nServers, bot and group size (1.2)');
const H = '88888888-8888-8888-8888-888888888888';
await db.exec(`insert into auth.users (id, raw_user_meta_data, email_confirmed_at, created_at) values ('${H}', '{"username":"hank"}', null, now())`);
const botSrv = (await as(A, `insert into public.servers (name) values ('Bot Town') returning id`)).rows[0].id;
const botCh = (await as(A, `select id from public.channels where server_id = $1 and type = 'text'`, [botSrv])).rows[0].id;
await expectError('bot commands need the bot turned on', () => as(A, `select public.bot_command($1, 'ping')`, [botCh]), 'bot is off');
await expectOk('owner turns the bot on; /ping, /roll and /help answer as the bot', async () => {
  await as(A, `update public.servers set bot_enabled = true, welcome_channel_id = $2, welcome_message = 'Hi {user}, welcome to {server}!' where id = $1`, [botSrv, botCh]);
  for (const [c, a] of [['ping', ''], ['roll', '2d6'], ['help', ''], ['coinflip', ''], ['choose', 'a | b'], ['serverinfo', ''], ['userinfo', '']]) await as(A, `select public.bot_command($1, $2, $3)`, [botCh, c, a]);
  const r = (await as(A, `select count(*)::int n, bool_and(is_bot) b, bool_and(author_id is null) a from public.messages where channel_id = $1`, [botCh])).rows[0];
  if (r.n !== 7 || !r.b || !r.a) throw new Error(JSON.stringify(r));
});
await expectError('unknown commands are explained', () => as(A, `select public.bot_command($1, 'nope')`, [botCh]), 'Unknown command');
await expectError('users cannot fake bot messages', () => as(A, `insert into public.messages (channel_id, content, is_bot) values ($1, 'fake', true)`, [botCh]), 'permission denied');
await expectError('outsiders cannot run commands', () => as(C, `select public.bot_command($1, 'ping')`, [botCh]));
await expectOk('/purge and /slowmode work for moderators', async () => {
  await as(A, `select public.bot_command($1, 'purge', '3')`, [botCh]);
  await as(A, `select public.bot_command($1, 'slowmode', '5')`, [botCh]);
  const r = (await as(A, `select rate_limit_seconds s from public.channels where id = $1`, [botCh])).rows[0];
  if (r.s !== 5) throw new Error(JSON.stringify(r));
});
const botInvite = (await as(A, `insert into public.server_invites (server_id) values ($1) returning code`, [botSrv])).rows[0].code;
await expectError('verification "low" keeps unverified emails out', async () => {
  await as(A, `update public.servers set verification_level = 'low' where id = $1`, [botSrv]);
  await as(H, `select public.join_server($1)`, [botInvite]);
}, 'verified email');
await expectOk('verified accounts join and the bot welcomes them', async () => {
  await db.exec(`update auth.users set email_confirmed_at = now() where id = '${H}'`);
  await as(H, `select public.join_server($1)`, [botInvite]);
  const r = (await as(A, `select content from public.messages where channel_id = $1 and bot_command = 'welcome'`, [botCh])).rows[0];
  if (!r?.content.includes('hank') || !r.content.includes('Bot Town')) throw new Error(JSON.stringify(r));
});
await expectOk('admins change the group DM size', async () => {
  await as(A, `select public.admin_set_config('group_dm_limit', '2'::jsonb)`);
  let refused = false;
  try { await as(A, `select public.create_group_dm(array['${B}', '${C}']::uuid[])`); } catch (e) { refused = e.message.includes('limited to 2'); }
  await as(A, `select public.admin_set_config('group_dm_limit', '25'::jsonb)`);
  if (!refused) throw new Error('limit not applied');
});

console.log('\nPlatform (1.4)');
await expectOk('decor, generated shapes and cosmetics are writable', () =>
  as(B, `update public.users set decor = '{"plate":["#ff0000"],"effectAngle":20}', avatar_shape = 'sh-star-5-45', nameplate = 'pl-sheen-violet', name_effect = 'fx-grad-soft', name_font = 'f-lobster', card_style = 'th-mesh-3' where id = '${B}'`));
await expectError('decor must be an object', () => as(B, `update public.users set decor = '[1]' where id = '${B}'`));
await expectOk('users manage only their own push subscriptions', async () => {
  await as(B, `insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/abc', 'k', 'a')`);
  const n = (await as(C, `select count(*)::int n from public.push_subscriptions`)).rows[0].n;
  if (n !== 0) throw new Error('saw others');
});
await expectOk('messages still send with the push trigger in place (no pg_net here)', () => as(A, `insert into public.messages (channel_id, content) values ($1, 'push test @carol')`, [general]));
const discSrv = (await as(A, `insert into public.servers (name) values ('Open Club') returning id`)).rows[0].id;
await expectError('servers are not joinable without discovery', () => as(C, `select public.join_discoverable($1)`, [discSrv]), "isn't open");
await expectOk('discoverable servers can be found and joined', async () => {
  await as(A, `update public.servers set discoverable = true, discovery_category = 'gaming' where id = $1`, [discSrv]);
  const found = (await as(C, `select name, is_member from public.discover_servers('open', 'gaming')`)).rows;
  if (!found.some((r) => r.name === 'Open Club' && !r.is_member)) throw new Error(JSON.stringify(found));
  await as(C, `select public.join_discoverable($1)`, [discSrv]);
});
const discCh = (await as(A, `select id from public.channels where server_id = $1 and type = 'text'`, [discSrv])).rows[0].id;
await expectOk('webhooks post with the right token only', async () => {
  const w = (await as(A, `insert into public.channel_webhooks (channel_id, server_id, name) values ($1, $2, 'CI') returning id, token`, [discCh, discSrv])).rows[0];
  await db.exec(`reset role; set role anon;`);
  try {
    await db.query(`select public.webhook_post($1, $2, 'Build passed ✅', 'GitHub')`, [w.id, w.token]);
    let refused = false;
    try { await db.query(`select public.webhook_post($1, 'wrong', 'x')`, [w.id]); } catch { refused = true; }
    if (!refused) throw new Error('bad token accepted');
  } finally { await db.exec('reset role;'); }
  const m = (await as(A, `select bot_name, is_bot from public.messages where channel_id = $1 and bot_command = 'webhook'`, [discCh])).rows[0];
  if (m?.bot_name !== 'GitHub' || !m.is_bot) throw new Error(JSON.stringify(m));
});
await expectError('members without Manage Channels cannot make webhooks', () => as(C, `insert into public.channel_webhooks (channel_id, server_id, name) values ($1, $2, 'x')`, [discCh, discSrv]));
await expectOk('custom emoji: managers add, everyone can see', async () => {
  await as(A, `insert into public.server_emojis (server_id, name, url) values ($1, 'party_cat', 'https://x.example/e.png')`, [discSrv]);
  const n = (await as(B, `select count(*)::int n from public.server_emojis where name = 'party_cat'`)).rows[0].n;
  if (n !== 1) throw new Error(String(n));
});
await expectError('members cannot add emoji without Manage Expressions', () => as(C, `insert into public.server_emojis (server_id, name, url) values ($1, 'nope', 'https://x.example/e.png')`, [discSrv]));

console.log('\nGroup DMs (1.5.1)');
const squad = (await db.query(`insert into public.conversations (type, name, owner_id) values ('group', 'Squad', '${A}') returning id`)).rows[0].id;
await db.exec(`insert into public.conversation_members (conversation_id, user_id) values ('${squad}', '${A}'), ('${squad}', '${B}'), ('${squad}', '${C}')`);
await expectError('members cannot remove others', () => as(B, `select public.remove_group_member($1, '${C}')`, [squad]), 'Only the group owner');
await expectOk('the owner removes a member', async () => {
  await as(A, `select public.remove_group_member($1, '${C}')`, [squad]);
  const n = (await db.query(`select count(*)::int n from public.conversation_members where conversation_id = $1`, [squad])).rows[0].n;
  if (n !== 2) throw new Error(String(n));
});
await expectError('ownership only goes to members', () => as(A, `select public.transfer_group_owner($1, '${C}')`, [squad]), 'not in this group');
await expectOk('the owner hands the group over', async () => {
  await as(A, `select public.transfer_group_owner($1, '${B}')`, [squad]);
  const o = (await db.query(`select owner_id from public.conversations where id = $1`, [squad])).rows[0].owner_id;
  if (o !== B) throw new Error(o);
});
await expectError('the old owner can no longer remove people', () => as(A, `select public.remove_group_member($1, '${B}')`, [squad]), 'Only the group owner');

console.log('\nStickers, drafts, scheduled messages (1.7)');
await expectOk('stickers: managers add, everyone can see', async () => {
  await as(A, `insert into public.server_stickers (server_id, name, url) values ($1, 'Wave', 'https://x.example/s.png')`, [discSrv]);
  const n = (await as(C, `select count(*)::int n from public.server_stickers where name = 'Wave'`)).rows[0].n;
  if (n !== 1) throw new Error(String(n));
});
await expectError('members cannot add stickers', () => as(C, `insert into public.server_stickers (server_id, name, url) values ($1, 'Nope', 'https://x.example/s.png')`, [discSrv]));
await expectOk('drafts are private', async () => {
  await as(A, `insert into public.message_drafts (scope_id, content) values ($1, 'half a thought')`, [dm]);
  const mine = (await as(A, `select content from public.message_drafts where scope_id = $1`, [dm])).rows[0]?.content;
  const theirs = (await as(B, `select count(*)::int n from public.message_drafts`)).rows[0].n;
  if (mine !== 'half a thought' || theirs !== 0) throw new Error(`${mine} ${theirs}`);
});
await expectOk('a scheduled DM is sent as its author when due', async () => {
  await as(A, `insert into public.scheduled_messages (conversation_id, content, send_at) values ($1, 'see you at 8', now())`, [squad]);
  const sent = (await db.query(`select public.send_due_scheduled() n`)).rows[0].n;
  const m = (await as(B, `select author_id from public.messages where conversation_id = $1 and content = 'see you at 8'`, [squad])).rows[0];
  if (sent !== 1 || m?.author_id !== A) throw new Error(`${sent} ${JSON.stringify(m)}`);
});
await expectError('you cannot schedule into a chat you are not in', () => as(C, `insert into public.scheduled_messages (conversation_id, content, send_at) values ($1, 'hi', now() + interval '1 hour')`, [dm]));
await expectOk('a scheduled message you may no longer send is kept with the reason', async () => {
  await as(C, `insert into public.scheduled_messages (channel_id, content, send_at) values ($1, 'later', now())`, [discCh]);
  await db.query(`delete from public.server_members where server_id = $1 and user_id = '${C}'`, [discSrv]);
  await db.query(`select public.send_due_scheduled()`);
  const r = (await db.query(`select failed from public.scheduled_messages where user_id = '${C}'`)).rows[0];
  if (!r?.failed) throw new Error(JSON.stringify(r));
});

console.log('\nGIF favourites (1.7.7)');
await expectOk('favourite GIFs are private', async () => {
  await as(A, `insert into public.gif_favorites (url, preview) values ('https://x.example/a.mp4', 'https://x.example/a.webp')`);
  const mine = (await as(A, `select count(*)::int n from public.gif_favorites`)).rows[0].n;
  const theirs = (await as(B, `select count(*)::int n from public.gif_favorites`)).rows[0].n;
  if (mine !== 1 || theirs !== 0) throw new Error(`${mine} ${theirs}`);
});
await expectError('favourites must be https links', () => as(A, `insert into public.gif_favorites (url, preview) values ('javascript:alert(1)', 'https://x.example/a.webp')`));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
