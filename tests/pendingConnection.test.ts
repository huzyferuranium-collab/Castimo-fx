import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePending, pendingNote, pendingAccountLine } from '../src/services/pendingConnection.ts';

test('a working report is read as it was sent', () => {
  const p = normalizePending({
    kind: 'working',
    label: 'Waiting for your broker to accept the terminal…',
    minutesLeft: 11,
    login: '133227028',
    server: 'HFMarketsGlobal-Live20',
  });
  assert.deepEqual(p, {
    kind: 'working',
    label: 'Waiting for your broker to accept the terminal…',
    minutesLeft: 11,
    login: '133227028',
    server: 'HFMarketsGlobal-Live20',
  });
});

test('a failed report keeps the reason, the hint and the reference', () => {
  const p = normalizePending({
    kind: 'failed',
    label: 'Could not connect',
    login: '1',
    server: 'S',
    error: { code: 'BROKER_SLOW', message: 'We tidied it away.', hint: 'Connect again.', ref: 'X1' },
  });
  assert.equal(p!.kind, 'failed');
  assert.deepEqual(p!.error, { code: 'BROKER_SLOW', message: 'We tidied it away.', hint: 'Connect again.', ref: 'X1' });
});

test('anything unexpected becomes null, and a missing label gets a kind default', () => {
  for (const bad of [null, undefined, 0, 'x', [], {}, { kind: 'weird' }, { label: 'no kind' }]) {
    assert.equal(normalizePending(bad), null);
  }
  assert.equal(normalizePending({ kind: 'working' })!.label, 'Getting your terminal ready…');
  assert.equal(normalizePending({ kind: 'failed', label: '   ' })!.label, 'Could not connect');
});

test('odd numbers and empty fields are dropped, not shown', () => {
  const p = normalizePending({ kind: 'working', label: 'x', minutesLeft: -3, login: '', server: 5, error: { code: 'A' } });
  assert.equal(p!.minutesLeft, undefined);
  assert.equal(p!.login, undefined);
  assert.equal(p!.server, undefined);
  assert.equal(p!.error, undefined, 'an error without a message is not shown');
  assert.equal(normalizePending({ kind: 'working', label: 'x', minutesLeft: NaN })!.minutesLeft, undefined);
  assert.equal(normalizePending({ kind: 'working', label: 'x', minutesLeft: 4.9 })!.minutesLeft, 4);
});

test('the note is gentle: time left, or a reassurance, or what to do next', () => {
  assert.match(pendingNote({ kind: 'working', label: 'x', minutesLeft: 12 }), /about 12 more minutes/);
  assert.match(pendingNote({ kind: 'working', label: 'x', minutesLeft: 1 }), /about another minute/);
  assert.match(pendingNote({ kind: 'working', label: 'x', minutesLeft: 0 }), /about another minute/);
  assert.match(pendingNote({ kind: 'working', label: 'x' }), /nothing you need to do/);
  assert.equal(pendingNote({ kind: 'failed', label: 'x', error: { code: 'A', message: 'm', hint: 'Try Connect again.' } }), 'Try Connect again.');
  assert.match(pendingNote({ kind: 'failed', label: 'x' }), /try again whenever you are ready/);
  for (const p of [{ kind: 'working', label: 'x' }, { kind: 'failed', label: 'x' }] as const) {
    assert.doesNotMatch(pendingNote(p), /fail|error|denied|wrong/i, 'no alarming words');
  }
});

test('the account line shows what is known', () => {
  assert.equal(pendingAccountLine({ kind: 'working', label: 'x', login: '5', server: 'S' }), '#5 · S');
  assert.equal(pendingAccountLine({ kind: 'working', label: 'x', login: '5' }), '#5');
  assert.equal(pendingAccountLine({ kind: 'working', label: 'x' }), '');
});
