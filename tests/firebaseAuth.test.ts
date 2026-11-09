import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { verifyFirebaseIdToken, parseRoleFromFirestoreDoc, AuthError } from '../src/backend/firebaseAuth.ts';

const PROJECT = 'elaborate-analogy-jvxch';
const NOW = 1_800_000_000;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys: Record<string, KeyObject> = { kid1: publicKey };

const b64 = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function makeToken(payload: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: KeyObject } = {}) {
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'kid1', typ: 'JWT' };
  const body = {
    aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'user-123',
    iat: NOW - 10, exp: NOW + 3000, email: 'a@b.com', ...payload,
  };
  const signingInput = `${b64(header)}.${b64(body)}`;
  const sig = sign('RSA-SHA256', Buffer.from(signingInput), opts.key ?? privateKey).toString('base64url');
  return `${signingInput}.${sig}`;
}
const run = (t: string, over: Partial<{ projectId: string; nowSec: number }> = {}) =>
  verifyFirebaseIdToken(t, { projectId: PROJECT, keys, nowSec: NOW, ...over });
const fails = (fn: () => unknown) => { try { fn(); return null; } catch (e: any) { return e instanceof AuthError ? e.message : 'OTHER:' + e.message; } };

test('accepts a valid token and returns the signed user id', () => {
  const u = run(makeToken({}));
  assert.equal(u.uid, 'user-123');
  assert.equal(u.email, 'a@b.com');
});

test('rejects garbage and wrong shapes', () => {
  assert.ok(fails(() => run('')));
  assert.ok(fails(() => run('a.b')));
  assert.ok(fails(() => run('not.a.token')));
  assert.ok(fails(() => run('mock-token')));
});

test('rejects a token signed with someone else\'s key', () => {
  assert.equal(fails(() => run(makeToken({}, { key: other.privateKey }))), 'Invalid token signature.');
});

test('rejects a forged user id (payload changed after signing)', () => {
  const t = makeToken({});
  const [h, , s] = t.split('.');
  const forged = `${h}.${b64({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'admin-user', iat: NOW - 10, exp: NOW + 3000 })}.${s}`;
  assert.equal(fails(() => run(forged)), 'Invalid token signature.');
});

test('rejects unknown key id and non-RS256 algorithms (including "none")', () => {
  assert.equal(fails(() => run(makeToken({}, { kid: 'nope' }))), 'Unknown signing key.');
  assert.equal(fails(() => run(makeToken({}, { alg: 'HS256' }))), 'Unsupported token algorithm.');
  const none = `${b64({ alg: 'none', kid: 'kid1' })}.${b64({ sub: 'x', aud: PROJECT })}.`;
  assert.ok(fails(() => run(none)));
});

test('rejects wrong project, wrong issuer, expired, future-issued, no subject', () => {
  assert.equal(fails(() => run(makeToken({ aud: 'other-project' }))), 'Token is for a different project.');
  assert.equal(fails(() => run(makeToken({ iss: 'https://evil.example/' }))), 'Bad token issuer.');
  assert.match(fails(() => run(makeToken({ exp: NOW - 1 }))) || '', /expired/);
  assert.equal(fails(() => run(makeToken({ iat: NOW + 4000 }))), 'Token issued in the future.');
  assert.equal(fails(() => run(makeToken({ sub: '' }))), 'Token has no user.');
});

test('role parsing: only an exact "admin" string counts', () => {
  assert.equal(parseRoleFromFirestoreDoc({ fields: { role: { stringValue: 'admin' } } }), 'admin');
  assert.equal(parseRoleFromFirestoreDoc({ fields: { role: { stringValue: 'Admin' } } }), 'client');
  assert.equal(parseRoleFromFirestoreDoc({ fields: { role: { stringValue: 'client' } } }), 'client');
  assert.equal(parseRoleFromFirestoreDoc({ fields: {} }), 'client');
  assert.equal(parseRoleFromFirestoreDoc(null), 'client');
  assert.equal(parseRoleFromFirestoreDoc({ fields: { role: { booleanValue: true } } }), 'client');
});

test('the email-verified flag is passed through only when the token says true', () => {
  assert.equal(run(makeToken({ email_verified: true })).emailVerified, true);
  assert.equal(run(makeToken({ email_verified: false })).emailVerified, false);
  assert.equal(run(makeToken({})).emailVerified, false);
});
