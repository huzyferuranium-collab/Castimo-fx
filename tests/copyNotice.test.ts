import test from 'node:test';
import assert from 'node:assert/strict';
import { copyNoticeFor } from '../src/backend/copyNotice.ts';

const NOW = Date.parse('2026-11-02T16:00:00Z');

test('an account held back for low equity gets a plain "connected, not copying yet" notice', () => {
  const n = copyNoticeFor({ copyHeld: 'LOW_FUNDS', copyMinimumUsd: 200, copyHeldSince: '2026-11-02T15:00:00.000Z' }, NOW)!;
  assert.equal(n.title, 'Connected, not copying yet');
  assert.match(n.message, /\$200\.00/);
  assert.match(n.message, /by ourselves/);
  assert.equal(n.at, '2026-11-02T15:00:00.000Z');
  assert.equal(n.id, 'held-2026-11-02T15:00:00.000Z');
});

test('the notice follows a changed minimum', () => {
  const n = copyNoticeFor({ copyHeld: 'LOW_FUNDS', copyMinimumUsd: 100, copyHeldSince: '2026-11-02T15:00:00.000Z' }, NOW)!;
  assert.match(n.message, /\$100\.00/);
});

test('when copying starts the client is told, for two weeks', () => {
  const recent = copyNoticeFor({ copyHeld: null, copyMinimumUsd: 200, copyStartedAt: '2026-11-01T10:00:00.000Z' }, NOW)!;
  assert.equal(recent.title, 'Copying has started');
  assert.match(recent.message, /\$200\.00/);
  assert.equal(copyNoticeFor({ copyHeld: null, copyStartedAt: '2026-10-01T10:00:00.000Z' }, NOW), null, 'old news is dropped');
});

test('an account that was never held back has no such notice, and a missing record is fine', () => {
  assert.equal(copyNoticeFor({ copyHeld: null, copyStartedAt: null }, NOW), null);
  assert.equal(copyNoticeFor({}, NOW), null);
  assert.equal(copyNoticeFor(null, NOW), null);
  assert.equal(copyNoticeFor(undefined, NOW), null);
});

test('without a saved minimum the notice still reads naturally', () => {
  const n = copyNoticeFor({ copyHeld: 'LOW_FUNDS', copyHeldSince: '2026-11-02T15:00:00.000Z' }, NOW)!;
  assert.match(n.message, /reaches the minimum/);
});
