import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COPY_TAG,
  copyComment,
  parseCopyComment,
  planReconcile,
  suspectKey,
  knownFromTable,
  closeBackoffMs,
  type ClientPosition,
  type ReconcileClient,
} from '../src/backend/copyMemory.ts';

const T0 = 1_700_000_000_000;
const CONFIRM = 20_000;

const pos = (id: number | string, masterId: number | string | null, extra: Partial<ClientPosition> = {}): ClientPosition => ({
  id,
  comment: masterId === null ? 'my own trade' : copyComment(masterId),
  symbol: 'XAUUSD',
  volume: 0.02,
  openPrice: 2650.5,
  time: new Date(T0 - 60_000),
  ...extra,
});

const client = (userId: string, positions: ClientPosition[] | null): ReconcileClient => ({
  userId,
  accountId: `acc-${userId}`,
  positions,
});

function plan(over: Partial<Parameters<typeof planReconcile>[0]> & { clients: ReconcileClient[] }) {
  return planReconcile({
    masterOpen: new Set<string>(),
    known: new Map(),
    suspects: new Map(),
    now: T0,
    confirmMs: CONFIRM,
    ...over,
  });
}

// ---------- the label ----------

test('the label we write is the label we read back', () => {
  assert.equal(copyComment(123456789), `${COPY_TAG}123456789`);
  assert.equal(parseCopyComment(copyComment('987654321')), '987654321');
  assert.equal(parseCopyComment(copyComment(5)), '5');
});

test('only an exact "CastimoCopy #<digits>" label counts; everything else is left alone', () => {
  assert.equal(parseCopyComment('  CastimoCopy #42  '), '42');
  for (const bad of [
    '', 'CastimoCopy #', 'CastimoCopy #12a', 'castimocopy #12', 'CastimoCopy #1 [sl]', 'CastimoCopy #-5',
    'CastimoCopy 12', 'My trade', 'Castimo Master Signal', 'xCastimoCopy #12', 'CastimoCopy #' + '9'.repeat(21),
    null, undefined, 12, {}, [],
  ]) {
    assert.equal(parseCopyComment(bad as any), null, String(bad));
  }
});

// ---------- remembering copies after a restart ----------

test('a copy of a master trade that is still open is remembered', () => {
  const p = plan({
    masterOpen: new Set(['500']),
    clients: [client('u1', [pos(9001, 500)])],
  });
  assert.equal(p.adopt.length, 1);
  assert.deepEqual(
    { m: p.adopt[0].masterId, u: p.adopt[0].userId, id: p.adopt[0].positionId, a: p.adopt[0].accountId },
    { m: '500', u: 'u1', id: '9001', a: 'acc-u1' }
  );
  assert.equal(p.adopt[0].symbol, 'XAUUSD');
  assert.equal(p.adopt[0].volume, 0.02);
  assert.equal(p.adopt[0].openedAt, new Date(T0 - 60_000).toISOString());
  assert.equal(p.close.length, 0);
  assert.equal(p.copiesSeen, 1);
});

test('a copy the engine already remembers is not adopted again; a different remembered id is corrected', () => {
  const same = plan({
    masterOpen: new Set(['500']),
    known: new Map([['500', new Map([['u1', '9001']])]]),
    clients: [client('u1', [pos(9001, 500)])],
  });
  assert.equal(same.adopt.length, 0);

  const stale = plan({
    masterOpen: new Set(['500']),
    known: new Map([['500', new Map([['u1', 'order-123']])]]),
    clients: [client('u1', [pos(9001, 500)])],
  });
  assert.equal(stale.adopt.length, 1);
  assert.equal(stale.adopt[0].positionId, '9001');
});

test('positions that are not our copies are never adopted, counted or closed', () => {
  const p = plan({
    masterOpen: new Set(['500']),
    suspects: new Map([[suspectKey('u1', 7), T0 - 10 * CONFIRM]]),
    clients: [client('u1', [pos(7, null), pos(8, null, { comment: 'CastimoCopy #500 extra' }), pos(9, null, { comment: undefined })])],
  });
  assert.equal(p.adopt.length, 0);
  assert.equal(p.close.length, 0);
  assert.equal(p.copiesSeen, 0);
  assert.equal(p.suspects.size, 0);
});

// ---------- copies whose master trade is gone ----------

test('a copy with no open master trade is closed only after it was seen that way twice, far enough apart', () => {
  const clients = [client('u1', [pos(9001, 500)])];

  // first sighting: wait
  const first = plan({ masterOpen: new Set(), clients, now: T0 });
  assert.equal(first.close.length, 0);
  assert.equal(first.waiting, 1);
  assert.equal(first.suspects.get(suspectKey('u1', 9001)), T0);

  // second sighting too soon: still wait, the first time is kept
  const soon = plan({ masterOpen: new Set(), clients, suspects: first.suspects, now: T0 + CONFIRM - 1 });
  assert.equal(soon.close.length, 0);
  assert.equal(soon.waiting, 1);
  assert.equal(soon.suspects.get(suspectKey('u1', 9001)), T0);

  // confirmed
  const later = plan({ masterOpen: new Set(), clients, suspects: first.suspects, now: T0 + CONFIRM });
  assert.equal(later.close.length, 1);
  assert.deepEqual(
    { m: later.close[0].masterId, u: later.close[0].userId, id: later.close[0].positionId, why: later.close[0].reason },
    { m: '500', u: 'u1', id: '9001', why: 'master-closed' }
  );
  assert.equal(later.waiting, 0);
});

test('if the master trade shows up again the doubt is forgotten', () => {
  const clients = [client('u1', [pos(9001, 500)])];
  const first = plan({ masterOpen: new Set(), clients, now: T0 });
  const back = plan({ masterOpen: new Set(['500']), clients, suspects: first.suspects, now: T0 + 5 * CONFIRM });
  assert.equal(back.close.length, 0);
  assert.equal(back.suspects.size, 0);
  assert.equal(back.adopt.length, 1);
});

test('when the master\'s open trades are not known, nothing is closed or adopted', () => {
  const p = plan({
    masterOpen: null,
    suspects: new Map([[suspectKey('u1', 9001), T0 - 10 * CONFIRM]]),
    clients: [client('u1', [pos(9001, 500)])],
  });
  assert.equal(p.close.length, 0);
  assert.equal(p.adopt.length, 0);
  assert.equal(p.copiesSeen, 1);
  assert.equal(p.suspects.size, 0);
});

test('a client whose positions could not be read is skipped and keeps its earlier doubts', () => {
  const old = new Map([[suspectKey('u1', 9001), T0 - 10 * CONFIRM]]);
  const p = plan({
    masterOpen: new Set(),
    suspects: old,
    clients: [client('u1', null), client('u2', [pos(9002, 501)])],
  });
  assert.equal(p.close.length, 0, 'u1 is not decided on a failed read');
  assert.equal(p.suspects.get(suspectKey('u1', 9001)), T0 - 10 * CONFIRM, 'u1 doubt carried over');
  assert.equal(p.suspects.get(suspectKey('u2', 9002)), T0, 'u2 is a first sighting');
  assert.equal(p.waiting, 1);
});

test('a failed close is retried only after its back-off', () => {
  const key = suspectKey('u1', 9001);
  const clients = [client('u1', [pos(9001, 500)])];
  const suspects = new Map([[key, T0 - 10 * CONFIRM]]);
  const notBefore = new Map([[key, T0 + 30_000]]);

  const early = plan({ masterOpen: new Set(), clients, suspects, notBefore, now: T0 });
  assert.equal(early.close.length, 0);
  assert.equal(early.waiting, 1);

  const ready = plan({ masterOpen: new Set(), clients, suspects, notBefore, now: T0 + 30_000 });
  assert.equal(ready.close.length, 1);
});

test('back-off grows 30 s, 1 min, 2 min ... and stops at 10 minutes', () => {
  assert.equal(closeBackoffMs(1), 30_000);
  assert.equal(closeBackoffMs(2), 60_000);
  assert.equal(closeBackoffMs(3), 120_000);
  assert.equal(closeBackoffMs(20), 10 * 60_000);
  assert.equal(closeBackoffMs(0), 30_000);
});

// ---------- doubles ----------

test('two copies of one master trade: the oldest is kept, the other is closed once confirmed', () => {
  const older = pos(9001, 500, { time: new Date(T0 - 120_000) });
  const newer = pos(9002, 500, { time: new Date(T0 - 119_000) });
  const clients = [client('u1', [newer, older])];

  const first = plan({ masterOpen: new Set(['500']), clients, now: T0 });
  assert.equal(first.adopt.length, 1);
  assert.equal(first.adopt[0].positionId, '9001', 'the oldest is the one remembered');
  assert.equal(first.close.length, 0);
  assert.equal(first.waiting, 1);
  assert.ok(first.suspects.has(suspectKey('u1', 9002)));
  assert.ok(!first.suspects.has(suspectKey('u1', 9001)));

  const second = plan({ masterOpen: new Set(['500']), clients, suspects: first.suspects, now: T0 + CONFIRM });
  assert.deepEqual(second.close.map((c) => [c.positionId, c.reason]), [['9002', 'duplicate']]);
});

test('when only one copy is left the double is not a double any more', () => {
  const first = plan({
    masterOpen: new Set(['500']),
    clients: [client('u1', [pos(9001, 500), pos(9002, 500, { time: new Date(T0 - 59_000) })])],
  });
  const after = plan({
    masterOpen: new Set(['500']),
    suspects: first.suspects,
    now: T0 + 5 * CONFIRM,
    clients: [client('u1', [pos(9002, 500, { time: new Date(T0 - 59_000) })])],
  });
  assert.equal(after.close.length, 0);
  assert.equal(after.suspects.size, 0);
});

test('with equal times the lower id counts as the oldest', () => {
  const t = new Date(T0 - 1000);
  const p = plan({
    masterOpen: new Set(['500']),
    clients: [client('u1', [pos(30, 500, { time: t }), pos(20, 500, { time: t })])],
  });
  assert.equal(p.adopt[0].positionId, '20');
});

test('both copies go when the master trade is closed', () => {
  const clients = [client('u1', [pos(9001, 500), pos(9002, 500)])];
  const first = plan({ masterOpen: new Set(), clients });
  const second = plan({ masterOpen: new Set(), clients, suspects: first.suspects, now: T0 + CONFIRM });
  assert.deepEqual(second.close.map((c) => c.positionId).sort(), ['9001', '9002']);
  assert.ok(second.close.every((c) => c.reason === 'master-closed'));
});

// ---------- several clients and trades ----------

test('each client is judged on its own; one client\'s copy never affects another\'s', () => {
  const p = plan({
    masterOpen: new Set(['500']),
    now: T0 + CONFIRM,
    suspects: new Map([[suspectKey('u2', 9102), T0]]),
    clients: [
      client('u1', [pos(9001, 500)]),
      client('u2', [pos(9101, 500), pos(9102, 777)]), // 777 is closed at the master
      client('u3', []),
    ],
  });
  assert.deepEqual(p.adopt.map((a) => `${a.userId}:${a.positionId}`).sort(), ['u1:9001', 'u2:9101']);
  assert.deepEqual(p.close.map((c) => `${c.userId}:${c.positionId}`), ['u2:9102']);
  assert.equal(p.copiesSeen, 3);
});

test('a client with no positions causes nothing', () => {
  const p = plan({ masterOpen: new Set(['500']), clients: [client('u1', [])] });
  assert.deepEqual([p.adopt.length, p.close.length, p.waiting, p.suspects.size, p.copiesSeen], [0, 0, 0, 0, 0]);
});

test('an unusable time falls back to now instead of failing', () => {
  const p = plan({
    masterOpen: new Set(['500']),
    clients: [client('u1', [pos(9001, 500, { time: 'not a date' }), pos(9002, 500, { time: null })])],
  });
  assert.equal(p.adopt.length, 1);
  assert.equal(p.adopt[0].openedAt, new Date(T0).toISOString());
});

// ---------- helpers ----------

test('the engine\'s table is read as master -> user -> client position', () => {
  const table = new Map([
    ['500', { clientPositions: new Map([['u1', { clientPositionId: '9001' }], ['u2', { clientPositionId: 9101 as any }]]) }],
    ['501', { clientPositions: new Map() }],
  ]);
  const known = knownFromTable(table);
  assert.equal(known.get('500')?.get('u1'), '9001');
  assert.equal(known.get('500')?.get('u2'), '9101');
  assert.equal(known.get('501')?.size, 0);
});
