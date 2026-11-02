// A client can never be stuck on "please accept the Terms": the server keeps its own record, reads it itself, and repeats are harmless.
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedAccordingToServer, recordAcceptance, termsDocId, type TermsDb } from '../src/backend/termsRecord.ts';
import { DocExistsError } from '../src/backend/firestoreAdmin.ts';

class FakeDb implements TermsDb {
  docs = new Map<string, Record<string, unknown>>();
  failReads = false;
  async getDoc(c: string, id: string) {
    if (this.failReads) throw new Error('database unavailable');
    return this.docs.get(`${c}/${id}`) ?? null;
  }
  async createDoc(c: string, id: string, data: Record<string, unknown>) {
    if (this.docs.has(`${c}/${id}`)) throw new DocExistsError();
    this.docs.set(`${c}/${id}`, data);
  }
}

const V = '2026-10-v3';

test('the record has the same name and shape the database rules expect', async () => {
  const db = new FakeDb();
  const when = new Date('2026-11-02T15:00:00Z');
  assert.equal(await recordAcceptance(db, 'u1', V, 'Mozilla/5.0 test', when), 'recorded');
  const doc = db.docs.get(`agreements/u1_${V}`)!;
  assert.equal(termsDocId('u1', V), `u1_${V}`);
  assert.equal(doc.userId, 'u1');
  assert.equal(doc.version, V);
  assert.equal(doc.acceptedAt, '2026-11-02T15:00:00.000Z');
  assert.equal(doc.userAgent, 'Mozilla/5.0 test');
  assert.equal(doc.savedBy, 'server');
});

test('before accepting: no record, so the client is asked; after accepting: the server sees it', async () => {
  const db = new FakeDb();
  assert.equal(await acceptedAccordingToServer(db, 'u1', V), false);
  await recordAcceptance(db, 'u1', V, 'ua');
  assert.equal(await acceptedAccordingToServer(db, 'u1', V), true);
  // another client, or an older version of the terms, is not covered
  assert.equal(await acceptedAccordingToServer(db, 'u2', V), false);
  assert.equal(await acceptedAccordingToServer(db, 'u1', '2026-01-v1'), false);
});

test('accepting twice changes nothing and is not an error (the browser and the server both save it)', async () => {
  const db = new FakeDb();
  await recordAcceptance(db, 'u1', V, 'first', new Date('2026-11-02T10:00:00Z'));
  assert.equal(await recordAcceptance(db, 'u1', V, 'second', new Date('2026-11-02T11:00:00Z')), 'exists');
  assert.equal(db.docs.get(`agreements/u1_${V}`)!.userAgent, 'first', 'the first record is kept as it was');
});

test('a database that cannot be read is "could not tell", never "not accepted"', async () => {
  const db = new FakeDb();
  db.failReads = true;
  assert.equal(await acceptedAccordingToServer(db, 'u1', V), null);
});

test('a very long browser description is cut, other errors are not hidden', async () => {
  const db = new FakeDb();
  await recordAcceptance(db, 'u1', V, 'x'.repeat(500));
  assert.equal((db.docs.get(`agreements/u1_${V}`)!.userAgent as string).length, 200);
  const broken: TermsDb = { getDoc: async () => null, createDoc: async () => { throw new Error('write refused'); } };
  await assert.rejects(() => recordAcceptance(broken, 'u9', V, 'ua'), /write refused/);
});
