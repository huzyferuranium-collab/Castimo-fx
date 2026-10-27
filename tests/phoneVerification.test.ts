import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, phoneHash, startVerification, checkVerification, PhoneError, __resetThrottleForTests,
} from '../src/backend/phoneVerification.ts';
class DocExistsError extends Error { constructor() { super('exists'); this.name = 'DocExistsError'; } }

process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'tok';
process.env.TWILIO_VERIFY_SERVICE_SID = 'VAtest';

function makeDeps(approve = true) {
  const db = new Map<string, any>();
  const calls: string[] = [];
  const deps: any = {
    secret: 'unit-test-secret-1234',
    now: () => Date.now(),
    fetchFn: async (url: string, init: any) => {
      calls.push(`${url}|${init.body}`);
      const ok = !url.endsWith('VerificationCheck') || true;
      return { ok, status: 200, json: async () => ({ status: approve ? 'approved' : 'pending' }) };
    },
    store: {
      getDoc: async (c: string, id: string) => db.get(`${c}/${id}`) ?? null,
      setDoc: async (c: string, id: string, d: any) => { db.set(`${c}/${id}`, d); },
      createDoc: async (c: string, id: string, d: any) => {
        if (db.has(`${c}/${id}`)) throw new DocExistsError();
        db.set(`${c}/${id}`, d);
      },
    },
  };
  return { deps, db, calls };
}

test('normalizePhone accepts international numbers and rejects junk', () => {
  assert.equal(normalizePhone('+256 700-123 456'), '+256700123456');
  assert.equal(normalizePhone('0700123456'), null);
  assert.equal(normalizePhone('+12'), null);
  assert.equal(normalizePhone(undefined), null);
});

test('hash is stable and does not contain the number', () => {
  const h = phoneHash('+256700123456', 'secret-secret-secret');
  assert.equal(h, phoneHash('+256700123456', 'secret-secret-secret'));
  assert.ok(!h.includes('256700'));
});

test('verify marks the account verified and stores only last 4 digits', async () => {
  __resetThrottleForTests();
  const { deps, db } = makeDeps();
  await startVerification('u1', '+256700123456', deps);
  const r = await checkVerification('u1', '+256700123456', '123456', deps);
  assert.equal(r.verified, true);
  assert.equal(db.get('phone_verifications/u1').phoneLast4, '3456');
  assert.ok(!JSON.stringify([...db.values()]).includes('+256700123456'));
});

test('a wrong code does not verify', async () => {
  __resetThrottleForTests();
  const { deps, db } = makeDeps(false);
  await assert.rejects(() => checkVerification('u1', '+256700123456', '000000', deps), (e: any) => e.code === 'CODE_WRONG');
  assert.equal(db.size, 0);
});

test('a number verified on one account cannot be used on another', async () => {
  __resetThrottleForTests();
  const { deps } = makeDeps();
  await checkVerification('u1', '+256700123456', '123456', deps);
  await assert.rejects(() => startVerification('u2', '+256700123456', deps), (e: any) => e.code === 'PHONE_IN_USE');
  await assert.rejects(() => checkVerification('u2', '+256700123456', '123456', deps), (e: any) => e.code === 'PHONE_IN_USE');
});

test('codes are throttled per account', async () => {
  __resetThrottleForTests();
  const { deps } = makeDeps();
  await startVerification('u3', '+256700123457', deps);
  await assert.rejects(() => startVerification('u3', '+256700123457', deps), (e: any) => e instanceof PhoneError && e.code === 'PHONE_TOO_SOON');
});

test('malformed code is rejected before calling Twilio', async () => {
  const { deps, calls } = makeDeps();
  await assert.rejects(() => checkVerification('u4', '+256700123458', 'abc', deps), (e: any) => e.code === 'CODE_INVALID');
  assert.equal(calls.length, 0);
});
