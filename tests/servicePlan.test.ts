import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionActive, nextPeriod, canSelectModel, daysLeft, isServiceModel } from '../src/backend/servicePlan.ts';

const DAY = 24 * 3600 * 1000;
const now = Date.parse('2026-11-01T00:00:00Z');
const sub = (endMs: number): any => ({
  userId: 'u', model: 'subscription', selectedAt: 'x',
  subscription: { periodStart: new Date(endMs - 30 * DAY).toISOString(), periodEnd: new Date(endMs).toISOString() },
});

test('subscription is active only before its end date', () => {
  assert.equal(subscriptionActive(sub(now + DAY), now), true);
  assert.equal(subscriptionActive(sub(now - 1), now), false);
  assert.equal(subscriptionActive(sub(now), now), false);
  assert.equal(subscriptionActive({ model: 'profit_share' } as any, now), false);
  assert.equal(subscriptionActive(null, now), false);
});

test('paying early adds to the time left; paying late starts now', () => {
  const early = nextPeriod(new Date(now + 5 * DAY).toISOString(), now, 30);
  assert.equal(Date.parse(early.end), now + 35 * DAY);
  const late = nextPeriod(new Date(now - 5 * DAY).toISOString(), now, 30);
  assert.equal(Date.parse(late.start), now);
  assert.equal(Date.parse(late.end), now + 30 * DAY);
  assert.equal(Date.parse(nextPeriod(undefined, now, 30).end), now + 30 * DAY);
});

test('first choice is always allowed; switching is guarded', () => {
  const ctx = { connected: false, hasPendingInvoice: false, nowMs: now };
  assert.equal(canSelectModel(null, 'subscription', { ...ctx, connected: true }).ok, true);
  const ps: any = { userId: 'u', model: 'profit_share', selectedAt: 'x' };
  assert.equal(canSelectModel(ps, 'profit_share', { ...ctx, connected: true }).ok, true);
  assert.equal(canSelectModel(ps, 'subscription', { ...ctx, connected: true }).ok, false);
  assert.equal(canSelectModel(ps, 'subscription', { ...ctx, hasPendingInvoice: true }).ok, false);
  assert.equal(canSelectModel(ps, 'subscription', ctx).ok, true);
  assert.equal(canSelectModel(sub(now + DAY), 'profit_share', ctx).ok, false);
  assert.equal(canSelectModel(sub(now - DAY), 'profit_share', ctx).ok, true);
});

test('daysLeft and model validation', () => {
  assert.equal(daysLeft(new Date(now + 2.2 * DAY).toISOString(), now), 3);
  assert.equal(daysLeft(new Date(now - DAY).toISOString(), now), 0);
  assert.equal(daysLeft(undefined, now), 0);
  assert.equal(isServiceModel('subscription'), true);
  assert.equal(isServiceModel('free'), false);
});

import { billingStanding } from '../src/backend/servicePlan.ts';
import { DEFAULT_INVOICE_DUE_HOURS } from '../src/backend/profitShare.ts';

const overdueInv: any = { status: 'pending', dueAt: new Date(now - 1000).toISOString() };
const freshInv: any = { status: 'pending', dueAt: new Date(now + 3600_000).toISOString() };
const paidInv: any = { status: 'paid', dueAt: new Date(now - DAY).toISOString() };

test('a paid-up subscriber owes no 50% and is never paused by invoices', () => {
  assert.equal(billingStanding(sub(now + DAY), [], now).blocked, false);
  // even a stray overdue invoice from before they switched does not pause a running subscription
  assert.equal(billingStanding(sub(now + DAY), [overdueInv], now).blocked, false);
});

test('a subscriber is paused when the paid month is not running', () => {
  assert.equal(billingStanding(sub(now - 1), [], now).blocked, true);
  assert.equal(billingStanding({ model: 'subscription' } as any, [], now).blocked, true);
});

test('profit-share clients are paused only by an invoice unpaid past its due time', () => {
  const ps: any = { userId: 'u', model: 'profit_share', selectedAt: 'x' };
  assert.equal(billingStanding(ps, [], now).blocked, false);
  assert.equal(billingStanding(ps, [freshInv], now).blocked, false);
  assert.equal(billingStanding(ps, [paidInv], now).blocked, false);
  assert.equal(billingStanding(ps, [freshInv, overdueInv], now).blocked, true);
});

test('invoices are due within 24 hours by default', () => {
  assert.equal(DEFAULT_INVOICE_DUE_HOURS, 24);
});
