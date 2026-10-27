import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWithdrawal, commissionLines, availableBalance, weeklyCutoff, processingWindow,
  validateWithdrawAmount, canMoveStatus, maskName,
} from '../src/backend/referrals.ts';

test('fee is 10% of the gross and net is what is left', () => {
  assert.deepEqual(computeWithdrawal(50), { gross: 50, fee: 5, net: 45 });
  assert.deepEqual(computeWithdrawal(123.45), { gross: 123.45, fee: 12.35, net: 111.1 });
});

test('commissions are 5/3/2 percent up three levels only', () => {
  const l = commissionLines(['a', 'b', 'c', 'd'], 100);
  assert.deepEqual(l.map((x) => [x.beneficiaryUid, x.level, x.amountUsdt]), [['a', 1, 5], ['b', 2, 3], ['c', 3, 2]]);
  assert.deepEqual(commissionLines(['a'], 50).map((x) => x.amountUsdt), [2.5]);
  assert.deepEqual(commissionLines([], 100), []);
  assert.deepEqual(commissionLines(['a'], 0), []);
  assert.deepEqual(commissionLines(['a'], NaN), []);
});

test('pending, processing and completed withdrawals hold the money; rejected and failed release it', () => {
  const c = [{ amountUsdt: 60 }, { amountUsdt: 40.5 }];
  const w = [
    { status: 'pending', gross: 50 },
    { status: 'rejected', gross: 30 },
    { status: 'failed', gross: 20 },
  ];
  assert.deepEqual(availableBalance(c, w), { earned: 100.5, held: 50, available: 50.5 });
  assert.equal(availableBalance([], [{ status: 'completed', gross: 5 }]).available, 0);
});

test('cutoff is the next Thursday 23:59 UTC', () => {
  // Wed 2026-10-28 12:00Z -> Thu 2026-10-29 23:59Z
  assert.equal(new Date(weeklyCutoff(Date.parse('2026-10-28T12:00:00Z'))).toISOString(), '2026-10-29T23:59:00.000Z');
  // Thu just before the cutoff stays in this week
  assert.equal(new Date(weeklyCutoff(Date.parse('2026-10-29T23:58:59Z'))).toISOString(), '2026-10-29T23:59:00.000Z');
  // At the cutoff, or after it, moves to next week
  assert.equal(new Date(weeklyCutoff(Date.parse('2026-10-29T23:59:00Z'))).toISOString(), '2026-11-05T23:59:00.000Z');
  assert.equal(new Date(weeklyCutoff(Date.parse('2026-10-30T08:00:00Z'))).toISOString(), '2026-11-05T23:59:00.000Z');
  // Sunday
  assert.equal(new Date(weeklyCutoff(Date.parse('2026-11-01T00:00:00Z'))).toISOString(), '2026-11-05T23:59:00.000Z');
  assert.equal(processingWindow(Date.parse('2026-10-28T12:00:00Z')).expectedBy, '2026-10-30T23:59:00.000Z');
});

test('Uganda time (UTC+3) late Thursday is still judged in GMT', () => {
  // Fri 00:30 in Kampala = Thu 21:30 GMT, so it makes this week's cycle.
  assert.equal(new Date(weeklyCutoff(Date.parse('2026-10-29T21:30:00Z'))).toISOString(), '2026-10-29T23:59:00.000Z');
});

test('amount rules', () => {
  assert.equal(validateWithdrawAmount('49.99', 100).ok, false);
  assert.equal(validateWithdrawAmount(-5, 100).ok, false);
  assert.equal(validateWithdrawAmount('abc', 100).ok, false);
  assert.equal(validateWithdrawAmount(60, 59.99).ok, false);
  assert.equal(validateWithdrawAmount(50.123, 100).ok, false);
  assert.deepEqual(validateWithdrawAmount('50', 50), { ok: true, amount: 50 });
});

test('status moves only forward', () => {
  assert.equal(canMoveStatus('pending', 'processing'), true);
  assert.equal(canMoveStatus('pending', 'completed'), false);
  assert.equal(canMoveStatus('processing', 'completed'), true);
  assert.equal(canMoveStatus('completed', 'failed'), false);
  assert.equal(canMoveStatus('rejected', 'pending'), false);
});

test('names are masked', () => {
  assert.equal(maskName('Stephen Wisdom'), 'S***m');
  assert.equal(maskName('Al'), 'A***');
  assert.equal(maskName(''), 'A client');
});
