#!/usr/bin/env node
/**
 * Verifies the public update feed the same way the in-app updater does:
 *   1. download latest.json from the feed URL in tauri.conf.json
 *   2. check the version is newer than `--from` (default: current package.json version - for CI use)
 *   3. download the installer and verify its minisign (Ed25519, BLAKE2b-prehashed) signature
 *      against the public key embedded in the app
 *   node scripts/verify-feed.mjs --from 0.3.0
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const conf = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const fromIdx = process.argv.indexOf('--from');
const from = fromIdx > 0 ? process.argv[fromIdx + 1] : JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

const newer = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
};

const endpoint = conf.plugins.updater.endpoints[0];
const feed = await (await fetch(endpoint)).json();
const target = feed.platforms['windows-x86_64'];
console.log(`feed:      ${endpoint}`);
console.log(`latest:    ${feed.version} (published ${feed.pub_date})`);
console.log(`installed: ${from} -> update offered: ${newer(feed.version, from)}`);

const res = await fetch(target.url);
if (!res.ok) throw new Error(`installer download HTTP ${res.status}`);
const bytes = Buffer.from(await res.arrayBuffer());
console.log(`installer: ${target.url.split('/').pop()} (${(bytes.length / 1024 / 1024).toFixed(2)} MB)`);

// Public key: base64("untrusted comment: …\n" + base64(alg[2] | keyId[8] | ed25519[32]))
const pubText = Buffer.from(conf.plugins.updater.pubkey, 'base64').toString('utf8').trim().split('\n');
const pub = Buffer.from(pubText[pubText.length - 1], 'base64');
const keyId = pub.subarray(2, 10);
const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub.subarray(10, 42).toString('base64url') }, format: 'jwk' });

// Signature: base64(untrusted comment / base64(alg | keyId | sig[64]) / trusted comment / base64(globalSig[64]))
const sigLines = Buffer.from(target.signature, 'base64').toString('utf8').trim().split('\n');
const sigBlob = Buffer.from(sigLines[1], 'base64');
const alg = sigBlob.subarray(0, 2).toString('ascii');
const sigKeyId = sigBlob.subarray(2, 10);
const signature = sigBlob.subarray(10, 74);
const trustedComment = sigLines[2].replace(/^trusted comment: /, '');
const globalSig = Buffer.from(sigLines[3], 'base64');

if (!keyId.equals(sigKeyId)) throw new Error('signature was made with a different key than the app trusts');
const message = alg === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
const fileOk = verify(null, message, key, signature);
const commentOk = verify(null, Buffer.concat([signature, Buffer.from(trustedComment)]), key, globalSig);
console.log(`signature: algorithm ${alg}, key id matches, file ${fileOk ? 'VALID' : 'INVALID'}, trusted comment ${commentOk ? 'VALID' : 'INVALID'}`);
if (!fileOk || !commentOk || !newer(feed.version, from)) process.exit(1);
console.log('\nOK: an installed copy on', from, 'will be offered', feed.version, 'and will accept the download.');
