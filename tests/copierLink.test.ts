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
});

test('the account list is read at the normal pace, never faster than half of what the service allows, and calmly after a request limit', async () => {
  const { nextRefreshDelayMs } = await import('../src/backend/copierLink.ts');
  assert.equal(nextRefreshDelayMs(60, 2400, null), 60_000); // plenty of room: the normal minute
  assert.equal(nextRefreshDelayMs(60, 120_000, null), 240_000); // one account linked: 30 reads an hour, so every four minutes
  assert.equal(nextRefreshDelayMs(60, 120_000, 65_000), 120_000); // after a limit answer: at least the sustainable spacing
  assert.equal(nextRefreshDelayMs(60, 1100, 3_000), 3_000); // a per-second slip: soon
  assert.equal(nextRefreshDelayMs(60, 0, null), 60_000); // a service that does not say: the normal minute
});
