import test from 'node:test';
import assert from 'node:assert/strict';
import { planSync } from '../src/services/clientSync.ts';

const mine = { userId: 'admin-1', login: '477627851', isBrokerVerified: true, status: 'ACTIVE' };
const other = { userId: 'client-9', login: '555', isBrokerVerified: true, status: 'ACTIVE' };

test('an ordinary client: their own account is the one the dashboard shows', () => {
  const plan = planSync({ connected: true, client: mine }, null);
  assert.equal(plan.reachable, true);
  assert.deepEqual(plan.entries, [{ client: mine, own: true }]);
  assert.equal(plan.listed, false, 'they are not sent the list of all clients');
  assert.deepEqual(plan.pending, { value: null }, 'connected: nothing is left to wait for');
});

test('an administrator who connected their own account sees it on the Client Terminal, even after a reload', () => {
  // The server has the account (the admin console lists it) and says it is theirs. Before, the dashboard only looked through the
  // admin list for an account whose user id it already knew, which it does not after a reload, so it said "Not connected".
  const plan = planSync({ connected: true, client: mine }, [mine, other]);
  assert.equal(plan.reachable, true);
  assert.deepEqual(plan.entries[0], { client: mine, own: true }, 'their own account first, flagged as theirs');
  assert.deepEqual(plan.entries.slice(1).map((e) => [e.client.userId, e.own]), [['admin-1', false], ['client-9', false]], 'then the list for the admin console');
  assert.equal(plan.listed, true);
});

test('an administrator whose own account is held back is still shown it (the admin list leaves such accounts out)', () => {
  const plan = planSync({ connected: true, client: { ...mine, lowFunds: true } }, [other]);
  assert.equal(plan.entries.filter((e) => e.own).length, 1);
  assert.equal(plan.entries.find((e) => e.own)!.client.lowFunds, true);
});

test('an administrator with no account of their own, and one still connecting: the notice is shown, the admin list still arrives', () => {
  const connecting = { kind: 'working', label: 'Waiting for your broker to accept the login…' };
  const plan = planSync({ connected: false, client: null, pending: connecting }, [other]);
  assert.deepEqual(plan.entries, [{ client: other, own: false }], 'nothing of their own to show yet');
  assert.deepEqual(plan.pending, { value: connecting });
});

test('nothing connected and nothing pending clears an old notice', () => {
  assert.deepEqual(planSync({ connected: false, client: null }, null).pending, { value: null });
  assert.deepEqual(planSync({ connected: false, client: null, pending: undefined }, []).pending, { value: null });
});

test('when the user\'s own answer is missing, the notice is left as it is (not cleared by a failed request)', () => {
  const plan = planSync(null, [other]);
  assert.equal(plan.reachable, true);
  assert.equal(plan.pending, null);
  assert.deepEqual(plan.entries, [{ client: other, own: false }]);
});

test('when nothing could be read, nothing changes', () => {
  const plan = planSync(null, null);
  assert.equal(plan.reachable, false);
  assert.deepEqual(plan.entries, []);
  assert.equal(plan.pending, null);
});

test('answers that are not accounts are ignored instead of breaking the page', () => {
  const plan = planSync({ connected: true, client: 'oops' }, [null, 7, 'x', other] as unknown[]);
  assert.deepEqual(plan.entries, [{ client: other, own: false }]);
});
