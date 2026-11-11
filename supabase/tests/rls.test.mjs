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
  as(E, `update public.users set profile_effect = 'explode' where id = '${E}'`), 'check');

await expectOk('presence status column is writable', () => as(C, `update public.users set presence_status = 'dnd' where id = '${C}'`));
await expectError('badge_ids still not writable', () => as(C, `update public.users set badge_ids = '["staff"]' where id = '${C}'`));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
