import test from 'node:test';
import assert from 'node:assert/strict';
import { computeIncome, invoiceIncome } from '../src/backend/income.ts';

const NOW = new Date('2026-11-10T12:00:00Z');

test('no records: every figure is zero and there are no months', () => {
  const r = computeIncome([], [], [], NOW);
  assert.equal(r.total.total, 0);
  assert.equal(r.subscriptions.total, 0);
  assert.equal(r.profitShare.total, 0);
  assert.equal(r.withdrawalFees.total, 0);
  assert.deepEqual(r.months, []);
});

test('three streams add up to the total, split by UTC month', () => {
  const subs = [
    { amountUsdt: 100, at: '2026-10-05T10:00:00Z' },
    { amountUsdt: 100, at: '2026-11-02T10:00:00Z' },
  ];
  const invoices = [
    { status: 'paid', amountDueUsdt: 80, amountReceivedUsdt: 78.5, paidAt: '2026-11-04T00:00:00Z', createdAt: '2026-11-03T00:00:00Z' },
    { status: 'paid', amountDueUsdt: 40, paidAt: '2026-10-30T23:59:00Z', createdAt: '2026-10-29T00:00:00Z' },
    { status: 'pending', amountDueUsdt: 25, createdAt: '2026-11-08T00:00:00Z' },
  ];
  const wd = [
    { status: 'completed', gross: 100, fee: 10, net: 90, updatedAt: '2026-11-06T00:00:00Z', requestedAt: '2026-11-05T00:00:00Z' },
    { status: 'pending', gross: 50, fee: 5, net: 45, requestedAt: '2026-11-09T00:00:00Z' },
    { status: 'rejected', gross: 60, fee: 6, net: 54, requestedAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' },
    { status: 'failed', gross: 60, fee: 6, net: 54, requestedAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' },
  ];
  const r = computeIncome(subs, invoices, wd, NOW);
  assert.equal(r.subscriptions.total, 200);
  assert.equal(r.subscriptions.thisMonth, 100);
  assert.equal(r.profitShare.total, 118.5, 'what arrived (78.5) is counted, else the amount due (40)');
  assert.equal(r.profitShare.thisMonth, 78.5);
  assert.equal(r.profitShare.awaitingPayment, 25);
  assert.equal(r.profitShare.awaitingCount, 1);
  assert.equal(r.withdrawalFees.total, 10, 'only a paid-out withdrawal earns its fee');
  assert.equal(r.withdrawalFees.pendingFees, 5);
  assert.equal(r.withdrawalFees.count, 1);
  assert.equal(r.total.total, 328.5);
  assert.equal(r.total.thisMonth, 100 + 78.5 + 10);
  assert.equal(r.referralPayoutsSent, 90);
  assert.deepEqual(r.months.map((m) => [m.month, m.total]), [['2026-11', 188.5], ['2026-10', 140]]);
});

test('unreadable or non-positive amounts are ignored, never guessed', () => {
  const r = computeIncome(
    [{ amountUsdt: 'abc', at: '2026-11-01T00:00:00Z' }, { amountUsdt: -5, at: '2026-11-01T00:00:00Z' }, { amountUsdt: 100, at: 'not a date' }],
    [{ status: 'paid' }],
    [{ status: 'completed', fee: null, net: 10 }],
    NOW,
  );
  assert.equal(r.subscriptions.total, 100, 'a payment with a bad date still counts in the total');
  assert.equal(r.subscriptions.thisMonth, 0);
  assert.deepEqual(r.months, []);
  assert.equal(r.profitShare.total, 0);
  assert.equal(r.withdrawalFees.total, 0);
  assert.equal(invoiceIncome({ amountDueUsdt: 12.5 }), 12.5);
});
