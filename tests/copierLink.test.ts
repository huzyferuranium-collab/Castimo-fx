import test from 'node:test';
import assert from 'node:assert/strict';
import { decideLink, desiredCopierStatus, DISCONNECT_GRACE_MS } from '../src/backend/copierLink.ts';
import { COPIER, type DuplikiumAccount } from '../src/backend/duplikiumClient.ts';

const acc = (over: Partial<DuplikiumAccount> = {}): DuplikiumAccount => ({
  accountId: 'A', name: 'CastimoFX Client u1 #1234', login: '1234', server: 'S', broker: 'mt5', type: 'slave', enabled: true,
  balance: 500, equity: 510, freeMargin: 400, currency: 'USD', state: 'CONNECTED', lastUpdate: null, groupId: null, subscriptionKey: null, openTrades: 0,
  ...over,
});
const mem = (over = {}) => ({ startedAt: 0, deadlineAt: 0, ...over });

test('logged in with real figures: verify', () => {
  assert.deepEqual(decideLink(acc(), mem(), 1000), { action: 'VERIFY' });
});

test('logged in but the figures have not arrived yet: wait (never verify on empty numbers)', () => {
  for (const over of [{ balance: null }, { equity: null }, { currency: '' }]) {
    const d = decideLink(acc(over), mem(), 1000);
    assert.equal(d.action, 'WAIT');
  }
});

test('a failed order or a protection stop does not mean the login is wrong', () => {
  for (const state of ['ORDER_FAILED', 'ORDER_FAILED_MARGIN', 'SYMBOL_NOT_FOUND', 'SELLOUT_SL', 'FROZEN_TP', 'CLOSE_ONLY_SL']) {
    assert.equal(decideLink(acc({ state }), mem(), 1000).action, 'VERIFY', state);
  }
});

test('the read-only (investor) password is refused at once', () => {
  assert.deepEqual(decideLink(acc({ state: 'INVESTOR_PASSWORD' }), mem(), 1000), { action: 'REJECT', reason: 'TRADING_NOT_ALLOWED' });
});

test('not logged in: wait through the grace period, then judge the login wrong', () => {
  const first = decideLink(acc({ state: 'DISCONNECTED' }), mem(), 10_000);
  assert.equal(first.action, 'WAIT');
  assert.equal((first as any).disconnectedSince, 10_000);
  const during = decideLink(acc({ state: 'DISCONNECTED' }), mem({ disconnectedSince: 10_000 }), 10_000 + DISCONNECT_GRACE_MS - 1);
  assert.equal(during.action, 'WAIT');
  const after = decideLink(acc({ state: 'DISCONNECTED' }), mem({ disconnectedSince: 10_000 }), 10_000 + DISCONNECT_GRACE_MS);
  assert.deepEqual(after, { action: 'REJECT', reason: 'BROKER_AUTH_FAILED' });
});

test('a login that comes through during the grace period is accepted', () => {
  assert.equal(decideLink(acc({ state: 'CONNECTED' }), mem({ disconnectedSince: 1 }), 20_000).action, 'VERIFY');
});

test('the service running out of its own credit is never the client\'s fault: wait', () => {
  const d = decideLink(acc({ state: 'EMPTY_EWALLET' }), mem(), 1000);
  assert.equal(d.action, 'WAIT');
});

test('an account that vanished is reported as gone', () => {
  assert.deepEqual(decideLink(null, mem(), 1000), { action: 'REJECT', reason: 'GONE' });
});

test('no answer yet: wait; and a new connection is given up on after its deadline', () => {
  assert.equal(decideLink(acc({ state: 'NONE', balance: null, equity: null }), mem({ deadlineAt: 5000 }), 1000).action, 'WAIT');
  assert.deepEqual(decideLink(acc({ state: 'NONE', balance: null, equity: null }), mem({ deadlineAt: 5000 }), 5001), { action: 'GIVE_UP' });
});

test('a returning client (no deadline) is never given up on', () => {
  assert.equal(decideLink(acc({ state: 'NONE', balance: null }), mem({ deadlineAt: 0 }), 10 ** 12).action, 'WAIT');
});

test('a ready account is verified even when the deadline has passed', () => {
  assert.equal(decideLink(acc(), mem({ deadlineAt: 5000 }), 9999).action, 'VERIFY');
});

test('copying: on for active clients, close-only when paused or unpaid, frozen before verification', () => {
  assert.equal(desiredCopierStatus({ status: 'ACTIVE', isBrokerVerified: true }), COPIER.ON);
  assert.equal(desiredCopierStatus({ status: 'IDLE', isBrokerVerified: true }), COPIER.CLOSE_ONLY);
  assert.equal(desiredCopierStatus({ status: 'ACTIVE', billingBlocked: true, isBrokerVerified: true }), COPIER.CLOSE_ONLY);
  assert.equal(desiredCopierStatus({ status: 'ACTIVE', isBrokerVerified: false }), COPIER.FROZEN);
  // connected but below the minimum equity: nothing new is copied, and it follows closes only
  assert.equal(desiredCopierStatus({ status: 'ACTIVE', lowFunds: true, isBrokerVerified: true }), COPIER.CLOSE_ONLY);
  assert.equal(desiredCopierStatus({ status: 'ACTIVE', lowFunds: false, isBrokerVerified: true }), COPIER.ON);
});

test('the account list is read at the normal pace, never faster than half of what the service allows, and calmly after a request limit', async () => {
  const { nextRefreshDelayMs } = await import('../src/backend/copierLink.ts');
  assert.equal(nextRefreshDelayMs(60, 2400, null), 60_000); // plenty of room: the normal minute
  assert.equal(nextRefreshDelayMs(60, 120_000, null), 240_000); // one account linked: 30 reads an hour, so every four minutes
  assert.equal(nextRefreshDelayMs(60, 120_000, 65_000), 120_000); // after a limit answer: at least the sustainable spacing
  assert.equal(nextRefreshDelayMs(60, 1100, 3_000), 3_000); // a per-second slip: soon
  assert.equal(nextRefreshDelayMs(60, 0, null), 60_000); // a service that does not say: the normal minute
});

// ---------- when to read the list, and the grace for a new account that is not listed yet ----------

test('a new account that is not in the list yet is waited for briefly, then called gone', async () => {
  const { GONE_GRACE_MS } = await import('../src/backend/copierLink.ts');
  assert.equal(decideLink(null, mem({ startedAt: 1000 }), 2000).action, 'REJECT', 'without a grace, not listed means gone (restores, old links)');
  assert.equal(decideLink(null, mem({ startedAt: 1000 }), 2000, DISCONNECT_GRACE_MS, GONE_GRACE_MS).action, 'WAIT', 'a few seconds after the add: wait');
  const late = decideLink(null, mem({ startedAt: 1000 }), 1000 + GONE_GRACE_MS, DISCONNECT_GRACE_MS, GONE_GRACE_MS);
  assert.deepEqual(late, { action: 'REJECT', reason: 'GONE' }, 'still missing after the grace: gone');
});

test('reads of the list: counted from the last read by anyone, quick while a new client waits, calm after a limit answer', async () => {
  const { nextReadDelayMs, QUICK_FOR_MS, RELAXED_FOR_MS } = await import('../src/backend/copierLink.ts');
  const base = { baseSeconds: 60, spacingMs: 33_000, waitLeftMs: null, sinceLastReadMs: null, waitingForMs: null, readyInMs: 0, quickMs: 5000 };
  // idle: the normal minute, but never faster than twice the sustainable spacing
  assert.equal(nextReadDelayMs({ ...base, spacingMs: 2400 }), 60_000);
  assert.equal(nextReadDelayMs(base), 66_000);
  assert.equal(nextReadDelayMs({ ...base, spacingMs: 120_000 }), 240_000, 'one account linked: every four minutes');
  // a read made 40 seconds ago by a connecting client counts: only the rest of the gap is waited
  assert.equal(nextReadDelayMs({ ...base, sinceLastReadMs: 40_000 }), 26_000);
  assert.equal(nextReadDelayMs({ ...base, sinceLastReadMs: 500_000 }), 1000, 'overdue: soon, never a busy loop');
  // a new client waiting in the background: quick, then relaxed, then back to normal
  assert.equal(nextReadDelayMs({ ...base, waitingForMs: 10_000 }), 5000);
  assert.equal(nextReadDelayMs({ ...base, waitingForMs: QUICK_FOR_MS + 1 }), 15_000);
  assert.equal(nextReadDelayMs({ ...base, waitingForMs: RELAXED_FOR_MS + 1 }), 66_000);
  assert.equal(nextReadDelayMs({ ...base, waitingForMs: 10_000, sinceLastReadMs: 2000 }), 3000, 'counted from the last read');
  // a client being watched (connected, balance not reported yet; or still connecting after the relaxed phase): the sustainable pace
  assert.equal(nextReadDelayMs({ ...base, watching: true }), 33_000, 'watching: the sustainable spacing, not twice it');
  assert.equal(nextReadDelayMs({ ...base, spacingMs: 2400, watching: true }), 15_000, 'watching: never under 15 seconds');
  assert.equal(nextReadDelayMs({ ...base, spacingMs: 2400 }), 60_000, 'not watching: the normal minute');
  assert.equal(nextReadDelayMs({ ...base, spacingMs: 120_000, watching: true }), 120_000, 'watching with one account linked: still inside the limits');
  assert.equal(nextReadDelayMs({ ...base, waitingForMs: 10_000, watching: true }), 5000, 'the quick phase still wins');
  assert.equal(nextReadDelayMs({ ...base, waitingForMs: RELAXED_FOR_MS + 1, watching: true }), 33_000, 'after the relaxed phase: watched');
  assert.equal(nextReadDelayMs({ ...base, watching: true, sinceLastReadMs: 20_000 }), 13_000, 'counted from the last read');
  assert.equal(nextReadDelayMs({ ...base, watching: true, readyInMs: 50_000 }), 50_000, 'never before the limits allow');
  // never before the limits let a read through
  assert.equal(nextReadDelayMs({ ...base, waitingForMs: 10_000, readyInMs: 20_000 }), 20_000);
  // after a request-limit answer nothing is read until the service's wait is over
  assert.equal(nextReadDelayMs({ ...base, waitLeftMs: 400_000, waitingForMs: 10_000 }), 400_000);
  assert.equal(nextReadDelayMs({ ...base, waitLeftMs: 3000 }), 33_000, 'a short wait: at least the sustainable spacing');
});
