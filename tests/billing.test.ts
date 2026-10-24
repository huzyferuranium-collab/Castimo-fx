import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  computeSettlement, sumAccountFlows, isSettlementDue, isOverdue, invoiceId, round2,
} from '../src/backend/profitShare.ts';
import { tronAddressToHex20, normalizeTronAddress, checkUsdtPayment, USDT_TRC20_CONTRACT } from '../src/backend/tron.ts';
import { toFsFields, fromFsFields, buildServiceAccountJwt } from '../src/backend/firestoreAdmin.ts';

test('fee is 50% of new profit above the high-water mark', () => {
  const r = computeSettlement({ hwm: 330, equity: 430, flows: 0 });
  assert.deepEqual(r, { adjustedHwm: 330, gain: 100, fee: 50, newHwm: 430 });
});

test('no fee while recovering a loss, and the HWM stays', () => {
  const r = computeSettlement({ hwm: 430, equity: 380, flows: 0 });
  assert.equal(r.fee, 0);
  assert.equal(r.newHwm, 430);
});

test('a deposit is not profit', () => {
  const r = computeSettlement({ hwm: 330, equity: 830, flows: 500 });
  assert.equal(r.gain, 0);
  assert.equal(r.fee, 0);
  assert.equal(r.newHwm, 830);
});

test('a withdrawal is not a loss, and profit after it is still charged', () => {
  const r = computeSettlement({ hwm: 330, equity: 280, flows: -100 }); // 330-100=230 -> gain 50
  assert.equal(r.adjustedHwm, 230);
  assert.equal(r.gain, 50);
  assert.equal(r.fee, 25);
});

test('HWM never goes below zero and bad inputs are rejected', () => {
  assert.equal(computeSettlement({ hwm: 50, equity: 10, flows: -200 }).adjustedHwm, 0);
  assert.throws(() => computeSettlement({ hwm: NaN, equity: 1, flows: 0 }));
  assert.throws(() => computeSettlement({ hwm: 1, equity: -1, flows: 0 }));
  assert.throws(() => computeSettlement({ hwm: 1, equity: 1, flows: 0, feePct: 120 }));
});

test('sumAccountFlows counts deposits/withdrawals/credits, not trades or commissions', () => {
  const deals = [
    { type: 'DEAL_TYPE_BALANCE', profit: 500 },
    { type: 'DEAL_TYPE_BALANCE', profit: -100 },
    { type: 'DEAL_TYPE_BUY', profit: 40 },
    { type: 'DEAL_TYPE_SELL', profit: -10 },
    { type: 'DEAL_TYPE_COMMISSION', profit: -2 },
    { type: 'DEAL_TYPE_BONUS', profit: 25 },
    { type: 'DEAL_TYPE_BALANCE', profit: 'x' },
  ];
  assert.equal(sumAccountFlows(deals), 425);
  assert.equal(sumAccountFlows([]), 0);
});

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
