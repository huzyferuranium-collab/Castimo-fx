import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideNext,
  observe,
  clientProgress,
  failureFor,
  DEFAULT_POLICY as CFG,
  type PendingConnection,
} from '../src/backend/terminalPolicy.ts';

const T0 = 1_000_000_000;
const MIN = 60_000;

function rec(over: Partial<PendingConnection> = {}): PendingConnection {
  return {
    userId: 'u1', accountId: 'a1', login: '123456', server: 'S',
    stage: 'PENDING', verifiedBefore: false,
    startedAt: T0, updatedAt: T0, deadlineAt: T0 + 15 * MIN,
    redeploys: 0, verifyFailures: 0,
    ...over,
  };
}

test('a terminal that is deployed and connected is verified', () => {
  const d = decideNext(rec(), { state: 'DEPLOYED', connectionStatus: 'CONNECTED' }, T0 + 5_000);
  assert.equal(d.action, 'VERIFY');
});

test('a terminal that is not deployed is started; transitional states are waited out', () => {
  assert.equal(decideNext(rec(), { state: 'UNDEPLOYED' }, T0).action, 'DEPLOY');
  assert.equal(decideNext(rec(), { state: 'DRAFT' }, T0).action, 'DEPLOY');
  for (const s of ['DEPLOYING', 'UNDEPLOYING', 'DELETING']) {
    assert.equal(decideNext(rec(), { state: s }, T0).action, 'WAIT', s);
  }
  assert.equal(decideNext(rec(), {}, T0).action, 'WAIT');
});

test('a deployed but disconnected terminal is given time, then restarted, with pauses and a cap', () => {
  const snap = { state: 'DEPLOYED', connectionStatus: 'DISCONNECTED' };
  // just noticed: wait
  let r = rec({ disconnectedSince: T0 });
  assert.equal(decideNext(r, snap, T0 + 30_000).action, 'WAIT');
  // 90 seconds in: restart
  assert.equal(decideNext(r, snap, T0 + 90_000).action, 'REDEPLOY');

  // restarted once; the pause after a restart is respected
  r = rec({ disconnectedSince: T0, redeploys: 1, lastRedeployAt: T0 + 100_000 });
  assert.equal(decideNext(r, snap, T0 + 200_000).action, 'WAIT');
  assert.equal(decideNext(r, snap, T0 + 100_000 + CFG.redeployGapMs).action, 'REDEPLOY');

  // the cap is respected
  r = rec({ disconnectedSince: T0, redeploys: CFG.maxRedeploys, lastRedeployAt: T0 + 100_000 });
  assert.equal(decideNext(r, snap, T0 + 10 * MIN).action, 'WAIT');
});

test('"disconnected from broker" is treated the same as disconnected', () => {
  const r = rec({ disconnectedSince: T0 });
  assert.equal(decideNext(r, { state: 'DEPLOYED', connectionStatus: 'DISCONNECTED_FROM_BROKER' }, T0 + 95_000).action, 'REDEPLOY');
});

test('without a "disconnected since" marker the clock starts now, so nothing is restarted early', () => {
  assert.equal(decideNext(rec(), { state: 'DEPLOYED', connectionStatus: 'DISCONNECTED' }, T0 + 10 * MIN - 1).action, 'WAIT');
});

test('observe() starts and clears the disconnected clock', () => {
  let r = observe(rec(), { state: 'DEPLOYED', connectionStatus: 'DISCONNECTED' }, T0 + 1000);
  assert.equal(r.disconnectedSince, T0 + 1000);
  assert.equal(r.lastConnectionStatus, 'DISCONNECTED');
  // it keeps the first time, not the latest
  r = observe(r, { state: 'DEPLOYED', connectionStatus: 'DISCONNECTED' }, T0 + 9000);
  assert.equal(r.disconnectedSince, T0 + 1000);
  // connected clears it
  r = observe(r, { state: 'DEPLOYED', connectionStatus: 'CONNECTED' }, T0 + 10_000);
  assert.equal(r.disconnectedSince, undefined);
  // not deployed: no disconnect clock either
  r = observe(r, { state: 'UNDEPLOYED' }, T0 + 11_000);
  assert.equal(r.disconnectedSince, undefined);
  // unknown fields keep what we knew
  r = observe({ ...r, lastState: 'DEPLOYED' }, {}, T0 + 12_000);
  assert.equal(r.lastState, 'DEPLOYED');
});

test('connected but the account keeps failing to be read: restart, but only while restarts are allowed', () => {
  const snap = { state: 'DEPLOYED', connectionStatus: 'CONNECTED' };
  assert.equal(decideNext(rec({ verifyFailures: 2 }), snap, T0 + 1000).action, 'VERIFY');
  assert.equal(decideNext(rec({ verifyFailures: 3 }), snap, T0 + 1000).action, 'REDEPLOY');
  assert.equal(decideNext(rec({ verifyFailures: 3, redeploys: CFG.maxRedeploys }), snap, T0 + 1000).action, 'VERIFY');
});

test('past the time window an unverified terminal is given up on', () => {
  const d = decideNext(rec(), { state: 'DEPLOYED', connectionStatus: 'DISCONNECTED' }, T0 + 15 * MIN);
  assert.equal(d.action, 'GIVE_UP');
  assert.equal(d.code, 'TERMINAL_NOT_CONNECTING');
});

test('past the window but now connected gets one last check, unless reading it has kept failing', () => {
  const snap = { state: 'DEPLOYED', connectionStatus: 'CONNECTED' };
  assert.equal(decideNext(rec(), snap, T0 + 20 * MIN).action, 'VERIFY');
  assert.equal(decideNext(rec({ verifyFailures: 3 }), snap, T0 + 20 * MIN).action, 'GIVE_UP');
});

test('a terminal that vanished from MetaApi is reported at once', () => {
  const d = decideNext(rec(), { missing: true }, T0 + 1000);
  assert.equal(d.action, 'GIVE_UP');
  assert.equal(d.code, 'TERMINAL_MISSING');
});

test('a client verified before is never given up on, and is restarted gently and more patiently', () => {
  const restored = rec({ verifiedBefore: true, deadlineAt: 0, disconnectedSince: T0 });
  const snap = { state: 'DEPLOYED', connectionStatus: 'DISCONNECTED' };
  assert.equal(decideNext(restored, snap, T0 + 24 * 60 * MIN).action, 'REDEPLOY', 'no deadline: still being looked after a day later');
  const after = { ...restored, redeploys: 5, lastRedeployAt: T0 + 100_000 };
  assert.equal(decideNext(after, snap, T0 + 100_000 + 5 * MIN).action, 'WAIT', 'longer pause between restarts');
  assert.equal(decideNext(after, snap, T0 + 100_000 + CFG.restoredRedeployGapMs).action, 'REDEPLOY');
  assert.equal(decideNext({ ...after, redeploys: CFG.restoredMaxRedeploys }, snap, T0 + 99 * MIN).action, 'WAIT');
});

test('failed records are kept for the client to read, then forgotten', () => {
  const failed = rec({ stage: 'FAILED', updatedAt: T0 });
  assert.equal(decideNext(failed, { state: 'DEPLOYED' }, T0 + 60 * MIN).action, 'WAIT');
  assert.equal(decideNext(failed, { state: 'DEPLOYED' }, T0 + CFG.failedKeepMs).action, 'FORGET');
});

test('the client is told in plain words what is happening, and how long is left', () => {
  assert.equal(clientProgress(rec({ lastAction: 'REDEPLOY' }), T0).label, 'Restarting your terminal to help it connect…');
  assert.equal(clientProgress(rec({ lastAction: 'DEPLOY' }), T0).label, 'Starting your trading terminal…');
  assert.equal(clientProgress(rec({ lastAction: 'VERIFY' }), T0).label, 'Reading your account from the broker…');
  assert.equal(
    clientProgress(rec({ lastAction: 'WAIT', lastState: 'DEPLOYED', lastConnectionStatus: 'DISCONNECTED' }), T0).label,
    'Waiting for your broker to accept the terminal…'
  );
  assert.equal(clientProgress(rec(), T0).label, 'Getting your terminal ready…');
  assert.equal(clientProgress(rec(), T0 + 5 * MIN).minutesLeft, 10);
  assert.equal(clientProgress(rec(), T0 + 99 * MIN).minutesLeft, 0);
  assert.equal(clientProgress(rec({ verifiedBefore: true, deadlineAt: 0 }), T0).minutesLeft, undefined);
});

test('failure messages are calm, helpful and never blame the client', () => {
  const f = failureFor('TERMINAL_NOT_CONNECTING', true);
  assert.match(f.message, /tidy/);
  assert.match(f.hint, /Connect again/);
  assert.match(failureFor('TERMINAL_MISSING', false).hint, /Connect/);
  for (const x of [f, failureFor('TERMINAL_MISSING', false)]) {
    assert.doesNotMatch(x.message + x.hint, /[A-Z]{6,}|!{2,}|\bwrong\b|\binvalid\b|\bfault\b/);
  }
  assert.equal(clientProgress(rec({ stage: 'FAILED', error: f }), T0).kind, 'failed');
});
