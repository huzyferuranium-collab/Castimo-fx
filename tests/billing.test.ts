import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  isSettlementDue, isOverdue, invoiceId, round2,
} from '../src/backend/profitShare.ts';
import { tronAddressToHex20, normalizeTronAddress, checkUsdtPayment, USDT_TRC20_CONTRACT } from '../src/backend/tron.ts';
import { toFsFields, fromFsFields, buildServiceAccountJwt } from '../src/backend/firestoreAdmin.ts';

test('settlement timing, overdue and ids', () => {
  const t0 = '2026-10-01T00:00:00.000Z';
  const day = 24 * 3600 * 1000;
  assert.equal(isSettlementDue(t0, Date.parse(t0) + 6 * day, 7), false);
  assert.equal(isSettlementDue(t0, Date.parse(t0) + 7 * day, 7), true);
  assert.equal(isOverdue({ status: 'pending', dueAt: t0 }, Date.parse(t0) + 1), true);
  assert.equal(isOverdue({ status: 'paid', dueAt: t0 }, Date.parse(t0) + 1), false);
  assert.equal(invoiceId('u1', '2026-10-08T10:00:00Z'), 'inv-u1-20261008');
  assert.equal(round2(1.005 + 0.0001), 1.01);
});

test('TRON address decoding checks the checksum (real USDT contract and zero address)', () => {
  assert.equal(tronAddressToHex20(USDT_TRC20_CONTRACT), 'a614f803b6fd780986a42c78ec9c7f77e6ded13c');
  assert.equal(tronAddressToHex20('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'), '0'.repeat(40));
  assert.equal(tronAddressToHex20('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'), null); // one character wrong
  assert.equal(tronAddressToHex20('TJzM7N4VvUq82Yx8fD3A6P4L8otSzgjLj6t'), null); // the old fake address
  assert.equal(normalizeTronAddress('0x' + 'a614f803b6fd780986a42c78ec9c7f77e6ded13c'), 'a614f803b6fd780986a42c78ec9c7f77e6ded13c');
});

const TREASURY = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const ev = (over: any = {}) => ({
  event_name: 'Transfer',
  contract_address: USDT_TRC20_CONTRACT,
  result: { from: '0x' + '11'.repeat(20), to: '0x' + '0'.repeat(40), value: '50000000' },
  ...over,
});

test('payment check accepts a USDT transfer to our wallet of enough value', () => {
  const r = checkUsdtPayment([ev()], { treasury: TREASURY, minUsdt: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.amountUsdt, 50);
});

test('payment check rejects wrong token, wrong recipient, too small, and empty', () => {
  assert.equal(checkUsdtPayment([ev({ contract_address: TREASURY })], { treasury: TREASURY, minUsdt: 50 }).ok, false);
  assert.equal(checkUsdtPayment([ev({ result: { to: '0x' + '22'.repeat(20), value: '50000000' } })], { treasury: TREASURY, minUsdt: 50 }).ok, false);
  assert.equal(checkUsdtPayment([ev({ result: { to: '0x' + '0'.repeat(40), value: '49990000' } })], { treasury: TREASURY, minUsdt: 50 }).ok, false);
  assert.equal(checkUsdtPayment([], { treasury: TREASURY, minUsdt: 50 }).ok, false);
  assert.equal(checkUsdtPayment([ev()], { treasury: 'not-an-address', minUsdt: 50 }).ok, false);
});

test('Firestore value conversion round-trips', () => {
  const obj = { a: 'x', b: 3, c: 1.5, d: true, e: null, f: { g: [1, 'two'] } };
  assert.deepEqual(fromFsFields(toFsFields(obj)), obj);
});

test('service-account login request is signed correctly', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwt = buildServiceAccountJwt({ client_email: 'svc@proj.iam.gserviceaccount.com', private_key: pem }, 1_000_000);
  const [h, p, s] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(claims.iss, 'svc@proj.iam.gserviceaccount.com');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')), true);
});

test('a profit-share payment up to 4 USDT short of the invoice is accepted', async () => {
  const { acceptedMinimum } = await import('../src/backend/billing.ts');
  const { checkUsdtPayment } = await import('../src/backend/tron.ts');
  assert.equal(acceptedMinimum(80.7, 4), 76.7);
  assert.equal(acceptedMinimum(80.7, 0), 80.7);
  assert.equal(acceptedMinimum(3, 4), 1, 'never under 1 USDT');
  const T = 'TR8vTWMkt3hGBfzWZ8fngejXLoCzzrdR2E';
  const ev = (usdt: number) => [{ event_name: 'Transfer', contract_address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', result: { to: T, value: String(Math.round(usdt * 1e6)) } }];
  const min = acceptedMinimum(80.7, 4);
  assert.equal(checkUsdtPayment(ev(76.7), { treasury: T, minUsdt: min }).ok, true);
  assert.equal(checkUsdtPayment(ev(84.7), { treasury: T, minUsdt: min }).ok, true);
  assert.equal(checkUsdtPayment(ev(79.7), { treasury: T, minUsdt: min }).ok, true, 'a Binance withdrawal 1 USDT short after its fee');
  assert.equal(checkUsdtPayment(ev(76.69), { treasury: T, minUsdt: min }).ok, false);
});

test('a transfer made before the invoice existed cannot pay it (and an undated event is not refused)', async () => {
  const { checkUsdtPayment, USDT_TRC20_CONTRACT } = await import('../src/backend/tron.ts');
  const { sinceMs } = await import('../src/backend/billing.ts');
  const T = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const ev = (ts?: number) => [{ event_name: 'Transfer', contract_address: USDT_TRC20_CONTRACT, result: { to: T, value: '50000000' }, ...(ts === undefined ? {} : { block_timestamp: ts }) }];
  const created = Date.parse('2026-11-04T10:00:00Z');
  const since = sinceMs('2026-11-04T10:00:00Z');
  assert.equal(since, created - 15 * 60_000);
  const old = checkUsdtPayment(ev(created - 3_600_000), { treasury: T, minUsdt: 50, notBeforeMs: since });
  assert.equal(old.ok, false);
  assert.match(old.error || '', /before this payment was requested/);
  assert.equal(checkUsdtPayment(ev(created + 60_000), { treasury: T, minUsdt: 50, notBeforeMs: since }).ok, true);
  assert.equal(checkUsdtPayment(ev(created - 60_000), { treasury: T, minUsdt: 50, notBeforeMs: since }).ok, true, 'inside the 15 minute allowance');
  assert.equal(checkUsdtPayment(ev(undefined), { treasury: T, minUsdt: 50, notBeforeMs: since }).ok, true, 'undated: not refused on this ground');
  assert.equal(checkUsdtPayment(ev(created - 3_600_000), { treasury: T, minUsdt: 50 }).ok, true, 'no cut-off given: unchanged');
  assert.equal(sinceMs('not a date'), 0);
});

test('the weekly referral commission is never paid on a demo account, or on one that is disconnected, not USD, or has no equity', async () => {
  const { weeklyCommissionEligible } = await import('../src/backend/billing.ts');
  const ok = { connectionState: 'CONNECTED', equity: 500, currency: 'USD', accountType: 'real' };
  assert.equal(weeklyCommissionEligible(ok), true);
  assert.equal(weeklyCommissionEligible({ ...ok, accountType: 'demo' }), false, 'free practice accounts would farm commission');
  assert.equal(weeklyCommissionEligible({ ...ok, accountType: undefined, server: 'ExnessKE-MT5Trial9' }), false, 'a demo server name is enough');
  assert.equal(weeklyCommissionEligible({ ...ok, connectionState: 'DISCONNECTED' }), false);
  assert.equal(weeklyCommissionEligible({ ...ok, connectionState: 'ERROR' }), false);
  assert.equal(weeklyCommissionEligible({ ...ok, currency: 'EUR' }), false);
  assert.equal(weeklyCommissionEligible({ ...ok, equity: 0 }), false);
  assert.equal(weeklyCommissionEligible({ ...ok, billingBlocked: true }), false, 'copying held for an unpaid invoice or an expired plan');
  assert.equal(weeklyCommissionEligible({ ...ok, lowFunds: true }), false, 'below the copying minimum');
  assert.equal(weeklyCommissionEligible({ ...ok, figuresPending: true }), false);
  assert.equal(weeklyCommissionEligible({ ...ok, equity: 'abc' }), false);
  assert.equal(weeklyCommissionEligible({ ...ok, accountType: undefined }), true, 'unknown type: judged on the other rules');
});

test('a demo account is recognised by its type or its server name', async () => {
  const { isDemoAccount } = await import('../src/backend/billing.ts');
  assert.equal(isDemoAccount({ accountType: 'demo' }), true);
  assert.equal(isDemoAccount({ accountType: 'real', server: 'ExnessKE-MT5Trial9' }), true);
  assert.equal(isDemoAccount({ accountType: 'real', server: 'HFMarketsSV-Live Server' }), false);
  assert.equal(isDemoAccount({}), false);
});

test('referrers are paid only after the account has been connected for 24 hours', async () => {
  const { connectedLongEnough } = await import('../src/backend/billing.ts');
  const now = Date.parse('2026-11-04T12:00:00Z');
  assert.equal(connectedLongEnough('2026-11-03T11:59:00Z', now), true);
  assert.equal(connectedLongEnough('2026-11-03T12:00:00Z', now), true, 'exactly 24 hours is enough');
  assert.equal(connectedLongEnough('2026-11-03T12:01:00Z', now), false, 'a minute short');
  assert.equal(connectedLongEnough(undefined, now), false, 'an unknown connect time never pays');
  assert.equal(connectedLongEnough('not a date', now), false);
});
