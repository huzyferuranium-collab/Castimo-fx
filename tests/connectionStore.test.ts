import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryConnectionStore, firestoreConnectionStore, sanitizeRecord, verifiedTerminalLookup } from '../src/backend/connectionStore.ts';
import type { PendingConnection } from '../src/backend/terminalPolicy.ts';

const rec = (over: Partial<PendingConnection> = {}): PendingConnection => ({
  userId: 'u1', accountId: 'a1', login: '123456', server: 'S', stage: 'PENDING', verifiedBefore: false,
  startedAt: 1, updatedAt: 2, deadlineAt: 3, redeploys: 0, verifyFailures: 0, ...over,
});

test('the memory store keeps copies, so callers cannot change what is saved by accident', async () => {
  const s = new MemoryConnectionStore();
  const r = rec();
  await s.put(r);
  r.redeploys = 9;
  assert.equal((await s.get('u1'))!.redeploys, 0);
  const got = (await s.get('u1'))!;
  got.redeploys = 5;
  assert.equal((await s.get('u1'))!.redeploys, 0);
  assert.equal((await s.list()).length, 1);
  await s.delete('u1');
  assert.equal(await s.get('u1'), null);
  assert.equal(s.writes, 1);
});

test('a damaged saved record is repaired or ignored, never a crash', () => {
  assert.equal(sanitizeRecord(null), null);
  assert.equal(sanitizeRecord({}), null, 'no user or terminal: unusable');
  assert.equal(sanitizeRecord({ userId: 'u', accountId: '' }), null);
  const r = sanitizeRecord({ userId: 'u', accountId: 'a', stage: 'WEIRD', redeploys: 'many', deadlineAt: NaN, lastAction: 'WAIT', error: { code: 'X', message: 5 } })!;
  assert.equal(r.stage, 'PENDING');
  assert.equal(r.redeploys, 0);
  assert.equal(r.deadlineAt, 0);
  assert.equal(r.verifiedBefore, false);
  assert.equal(r.lastAction, 'WAIT');
  assert.deepEqual(r.error, { code: 'X', message: '', hint: '', ref: undefined });
});

test('the Firestore store writes the record as it is and reads it back; nothing secret is in it', async () => {
  const docs = new Map<string, Record<string, unknown>>();
  const store = firestoreConnectionStore({
    getDoc: async (c, id) => docs.get(`${c}/${id}`) ?? null,
    setDoc: async (c, id, data) => void docs.set(`${c}/${id}`, JSON.parse(JSON.stringify(data))),
    deleteDoc: async (c, id) => void docs.delete(`${c}/${id}`),
    listAll: async (c) => Array.from(docs.entries()).filter(([k]) => k.startsWith(`${c}/`)).map(([, v]) => v),
  });
  const r = rec({ disconnectedSince: 77, lastState: 'DEPLOYED', lastConnectionStatus: 'DISCONNECTED', lastAction: 'REDEPLOY', error: { code: 'E', message: 'm', hint: 'h' } });
  await store.put(r);
  assert.ok(docs.has('client_connections/u1'));
  assert.doesNotMatch(JSON.stringify([...docs.values()]), /password/i);
  assert.deepEqual(await store.get('u1'), { ...r, error: { code: 'E', message: 'm', hint: 'h', ref: undefined } });
  assert.equal((await store.list()).length, 1);
  await store.delete('u1');
  assert.equal(await store.get('u1'), null);
  assert.deepEqual(await store.list(), []);
});

test('"was this terminal verified before?" answers yes, no, or unknown', async () => {
  const saved: Record<string, Record<string, unknown>> = { u1: { accountId: 'a1' }, u2: { accountId: 'other' } };
  const check = verifiedTerminalLookup(async (uid) => {
    if (uid === 'boom') throw new Error('db down');
    return saved[uid] ?? null;
  });
  assert.equal(await check('u1', 'a1'), 'yes');
  assert.equal(await check('u2', 'a1'), 'no', 'a saved record for a different terminal');
  assert.equal(await check('nobody', 'a1'), 'no', 'no saved record');
  assert.equal(await check('boom', 'a1'), 'unknown', 'a failing lookup is never a "no"');
});
