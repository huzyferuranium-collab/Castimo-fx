// Check of the copy engine (REPLICATION_ENGINE.ts) against PRETEND brokers.
// It proves the wiring of the "copy memory": after a restart the engine finds the copies clients already hold
// (they carry the label "CastimoCopy #<master trade id>"), closes them when the master trade closes, never copies
// a trade twice, never touches a client's own trades, and decides nothing when it cannot read a broker.
// It says nothing about the real MetaApi or real brokers.
//
// Run with:  npm run test:glue
import assert from 'node:assert/strict';

const ROOT = new URL('../../src/backend/', import.meta.url);
const load = (f) => import(new URL(f, ROOT).href);
const { ReplicationEngine } = await load('REPLICATION_ENGINE.ts');
const { Mt5ConnectionManager } = await load('MT5_CONNECTION_MANAGER.ts');
const { copyComment } = await load('copyMemory.ts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONFIRM = 250; // the "seen wrong twice" window, shortened for the test
const PAST_CONFIRM = CONFIRM + 60;

// ---------- a pretend broker terminal ----------
let seq = 1000;
class FakeTerminal {
  constructor(name) {
    this.name = name;
    this.positions = [];
    this.log = [];
    this.failReads = false;
    this.failClose = false;
    this.fillDelay = 0;
    this.reads = 0;
    this.emptyReads = 0;
  }
  async getPositions() {
    this.reads++;
    if (this.failReads) throw new Error(`${this.name}: cannot read`);
    if (this.emptyReads > 0) {
      this.emptyReads--;
      return [];
    }
    return this.positions.map((p) => ({ ...p }));
  }
  async #open(type, symbol, volume, sl, tp, opts) {
    this.log.push(['open', type, symbol, volume, opts?.comment]);
    if (this.fillDelay) await sleep(this.fillDelay);
    const id = String(++seq);
    this.positions.push({ id, type, symbol, volume, openPrice: 2650, time: new Date(), comment: opts?.comment ?? '', stopLoss: sl, takeProfit: tp });
    return { numericCode: 10009, stringCode: 'TRADE_RETCODE_DONE', orderId: id, positionId: id };
  }
  createMarketBuyOrder(s, v, sl, tp, o) {
    return this.#open('POSITION_TYPE_BUY', s, v, sl, tp, o);
  }
  createMarketSellOrder(s, v, sl, tp, o) {
    return this.#open('POSITION_TYPE_SELL', s, v, sl, tp, o);
  }
  async closePosition(id) {
    this.log.push(['close', String(id)]);
    if (this.failClose) throw new Error('market closed');
    const i = this.positions.findIndex((p) => String(p.id) === String(id));
    if (i < 0) throw new Error('position not found');
    this.positions.splice(i, 1);
    return {};
  }
  async modifyPosition(id, sl, tp) {
    this.log.push(['modify', String(id), sl, tp]);
    return {};
  }
  of(kind) {
    return this.log.filter((l) => l[0] === kind);
  }
  hold(id, comment, extra = {}) {
    const p = { id: String(id), type: 'POSITION_TYPE_BUY', symbol: 'XAUUSD', volume: 0.05, openPrice: 2650, time: new Date(Date.now() - 60_000), comment, ...extra };
    this.positions.push(p);
    return p;
  }
}

class FakeStream {
  constructor() {
    this.listeners = [];
  }
  addSynchronizationListener(l) {
    this.listeners.push(l);
  }
  async emit(method, ...args) {
    for (const l of this.listeners) await l[method]?.('0:ws', ...args);
  }
}

function makeWorld(names = ['A', 'B']) {
  const w = { master: new FakeTerminal('master'), stream: new FakeStream(), connected: true, clients: new Map() };
  const unique = () => Array.from(new Set(w.clients.values()));
  w.host = {
    getMasterStreamingConnection: () => w.stream,
    getMasterRpcConnection: () => w.master,
    isConnected: () => w.connected,
    getActiveClients: () => unique().filter((c) => c.status === 'ACTIVE' && c.isBrokerVerified && !c.billingBlocked),
    getAllClientRecords: () => Array.from(w.clients.values()), // like the real pool: each record appears under two keys
    getClientConnection: (id) => w.clients.get(id),
    getMasterMetrics: () => ({ balance: 1000 }),
  };
  for (const n of names) addClient(w, n);
  return w;
}

function addClient(w, name, over = {}) {
  const rec = {
    userId: `user-${name}`, accountId: `acc-${name}`, login: `10${name}`, server: 'Demo', status: 'ACTIVE',
    balance: 500, equity: 520, freeMargin: 480, currency: 'USD', leverage: 500, lastSync: '',
    isBrokerVerified: true, verificationTimestamp: '',
    rpcConnection: new FakeTerminal(`client-${name}`),
    ...over,
  };
  w.clients.set(rec.userId, rec);
  w.clients.set(rec.accountId, rec);
  return rec;
}
const term = (w, name) => w.clients.get(`user-${name}`).rpcConnection;

function masterTrade(w, id, over = {}) {
  const p = { id: String(id), type: 'POSITION_TYPE_BUY', symbol: 'XAUUSD', volume: 0.1, openPrice: 2650, stopLoss: 2640, takeProfit: 2680, time: new Date(), comment: '', ...over };
  w.master.positions.push(p);
  return p;
}
const masterCloses = (w, id) => {
  w.master.positions = w.master.positions.filter((p) => String(p.id) !== String(id));
};

/** A new engine "process": fresh memory, a fresh live connection, same brokers. */
function boot(w) {
  w.stream = new FakeStream();
  const e = ReplicationEngine.createFor(w.host, { confirmMs: CONFIRM });
  e.attachListenerIfNeeded();
  return e;
}

// ---------- output handling ----------
const out = { log: console.log, warn: console.warn, error: console.error };
let captured = [];
function quiet() {
  captured = [];
  const grab = (...a) => captured.push(a.join(' '));
  console.log = console.warn = console.error = grab;
}
function loud() {
  console.log = out.log;
  console.warn = out.warn;
  console.error = out.error;
}

const results = [];
async function scenario(name, fn) {
  quiet();
  let engine;
  try {
    engine = await fn((e) => (engine = e));
    loud();
    results.push([name, true]);
    console.log(`  ok  ${name}`);
  } catch (err) {
    loud();
    results.push([name, false]);
    console.log(`  FAIL ${name}\n       ${err?.stack || err}`);
    if (captured.length) console.log('       engine log:\n       ' + captured.slice(-12).join('\n       '));
  } finally {
    engine?.stop();
    loud();
  }
}

console.log('Copy engine checks against pretend brokers (not the real MetaApi):');

await scenario('A. a normal trade is copied with its label and closed with the master', async (set) => {
  const w = makeWorld();
  const e = boot(w);
  set(e);
  await e.pollMaster(); // first look: master has nothing
  assert.equal(e.isSeeded(), true);
  const t = masterTrade(w, 5001);
  await w.stream.emit('onPositionUpdated', t);
  for (const n of ['A', 'B']) {
    assert.deepEqual(term(w, n).of('open').map((o) => [o[3], o[4]]), [[0.05, 'CastimoCopy #5001']], n);
  }
  masterCloses(w, 5001);
  await w.stream.emit('onPositionRemoved', '5001');
  for (const n of ['A', 'B']) assert.equal(term(w, n).positions.length, 0, `${n} closed`);
  return e;
});

await scenario('B. restart while a trade is open: nothing is copied twice, the copies follow the master again', async (set) => {
  const w = makeWorld();
  const e1 = boot(w);
  await e1.pollMaster();
  await w.stream.emit('onPositionUpdated', masterTrade(w, 6001));
  assert.equal(term(w, 'A').positions.length, 1);
  e1.stop();

  // the server restarts: memory is gone, clients are already connected again, the trade is still open
  const e2 = boot(w);
  set(e2);
  await e2.pollMaster(); // the first look after start-up
  assert.equal(e2.isSeeded(), true);
  assert.equal(e2.getMasterPositionsCount(), 1, 'the open trade is remembered');
  await e2.pollMaster(); // and the next regular look
  for (const n of ['A', 'B']) assert.equal(term(w, n).of('open').length, 1, `${n} was not given a second copy`);

  const r = await e2.reconcileClients();
  assert.equal(r.remembered, 2);
  assert.equal(e2.getReplicationMetrics().copyMemory.copiesTracked, 2);

  masterCloses(w, 6001);
  await w.stream.emit('onPositionRemoved', '6001');
  for (const n of ['A', 'B']) {
    assert.equal(term(w, n).positions.length, 0, `${n} copy closed`);
    assert.equal(term(w, n).of('close').length, 1, `${n} closed exactly once`);
  }
  return e2;
});

await scenario('C. restart, then the master closes before the engine has compared accounts: still closed', async (set) => {
  const w = makeWorld();
  const e1 = boot(w);
  await e1.pollMaster();
  await w.stream.emit('onPositionUpdated', masterTrade(w, 6101));
  e1.stop();

  const e2 = boot(w);
  set(e2);
  await e2.pollMaster();
  masterCloses(w, 6101);
  await w.stream.emit('onPositionRemoved', '6101'); // no comparison has run yet
  for (const n of ['A', 'B']) assert.equal(term(w, n).positions.length, 0, `${n} copy closed from the broker's label`);
  return e2;
});

await scenario('D. the master closed while the server was down: leftovers go after two checks, not one', async (set) => {
  const w = makeWorld();
  term(w, 'A').hold(7001, copyComment(7777));
  term(w, 'B').hold(7002, copyComment(7777));
  const e = boot(w);
  set(e);
  await e.pollMaster(); // master has nothing open
  const r1 = await e.reconcileClients();
  assert.deepEqual([r1.ran, r1.closed, r1.waiting], [true, 0, 2]);
  assert.equal(term(w, 'A').positions.length, 1, 'not closed on the first sighting');
  await sleep(PAST_CONFIRM);
  const r2 = await e.reconcileClients();
  assert.equal(r2.closed, 2);
  assert.equal(term(w, 'A').positions.length + term(w, 'B').positions.length, 0);
  assert.equal(e.getReplicationMetrics().copyMemory.leftoversClosed, 2);
  return e;
});

await scenario('E. master trade opened and closed while the copy was still being placed: the late copy is cleaned up', async (set) => {
  const w = makeWorld();
  for (const n of ['A', 'B']) term(w, n).fillDelay = 120;
  const e = boot(w);
  set(e);
  await e.pollMaster();
  const t = masterTrade(w, 8001);
  const opening = w.stream.emit('onPositionUpdated', t);
  await sleep(30);
  masterCloses(w, 8001);
  await w.stream.emit('onPositionRemoved', '8001'); // nothing to close yet, the orders have not landed
  await opening; // now the copies land, behind the master's back
  assert.equal(term(w, 'A').positions.length, 1);
  await e.reconcileClients(); // first sighting
  await sleep(PAST_CONFIRM);
  await e.reconcileClients(); // confirmed
  for (const n of ['A', 'B']) assert.equal(term(w, n).positions.length, 0, n);
  return e;
});

await scenario('F. when the master cannot be read, nothing is closed or decided', async (set) => {
  const w = makeWorld();
  term(w, 'A').hold(7101, copyComment(4444));
  const e = boot(w);
  set(e);
  await e.pollMaster();
  w.master.failReads = true;
  for (let i = 0; i < 2; i++) {
    const r = await e.reconcileClients();
    assert.equal(r.ran, false);
    await sleep(PAST_CONFIRM);
  }
  assert.equal(term(w, 'A').positions.length, 1);
  w.master.failReads = false;
  assert.equal((await e.reconcileClients()).ran, true); // back to normal
  return e;
});

await scenario('G. one empty answer from the master does not close anyone; two do', async (set) => {
  const w = makeWorld();
  const e = boot(w);
  set(e);
  await e.pollMaster();
  await w.stream.emit('onPositionUpdated', masterTrade(w, 9001));
  assert.equal(term(w, 'A').positions.length, 1);

  w.master.emptyReads = 1; // a glitch: the master seems to have no trades for one read
  await e.pollMaster();
  assert.equal(term(w, 'A').positions.length, 1, 'still open after one empty read');
  await e.pollMaster(); // the real list is back
  assert.equal(term(w, 'A').positions.length, 1);
  assert.equal(e.getMasterPositionsCount(), 1);

  // a comparison during a glitch does not turn the copy into a suspect either
  w.master.emptyReads = 1;
  const r = await e.reconcileClients();
  assert.deepEqual([r.closed, r.waiting], [0, 0]);

  // a real close, seen only by the 2.5-second check (the live message was lost): closed on the second look
  masterCloses(w, 9001);
  await e.pollMaster();
  assert.equal(term(w, 'A').positions.length, 1, 'first empty look waits');
  await e.pollMaster();
  assert.equal(term(w, 'A').positions.length, 0);
  assert.equal(term(w, 'B').positions.length, 0);
  return e;
});

await scenario("H. a client's own trades and look-alike labels are never touched", async (set) => {
  const w = makeWorld(['A']);
  const a = term(w, 'A');
  a.hold(1, '');
  a.hold(2, 'CastimoCopy #999 extra');
  a.hold(3, 'my EA');
  a.hold(4, copyComment(12345)); // the only real leftover
  const e = boot(w);
  set(e);
  await e.pollMaster();
  await e.reconcileClients();
  await sleep(PAST_CONFIRM);
  await e.reconcileClients();
  await sleep(PAST_CONFIRM);
  await e.reconcileClients();
  assert.deepEqual(a.positions.map((p) => p.id).sort(), ['1', '2', '3']);
  assert.deepEqual(a.of('close'), [['close', '4']]);
  return e;
});

await scenario('I. a double copy of one master trade: the oldest stays, the other goes', async (set) => {
  const w = makeWorld(['A']);
  const a = term(w, 'A');
  masterTrade(w, 9101);
  a.hold('X1', copyComment(9101), { time: new Date(Date.now() - 120_000) });
  a.hold('X2', copyComment(9101), { time: new Date(Date.now() - 110_000) });
  const e = boot(w);
  set(e);
  await e.pollMaster();
  const r1 = await e.reconcileClients();
  assert.equal(r1.remembered, 1);
  assert.equal(a.positions.length, 2, 'not closed on the first sighting');
  await sleep(PAST_CONFIRM);
  await e.reconcileClients();
  assert.deepEqual(a.positions.map((p) => p.id), ['X1']);
  assert.equal(e.getReplicationMetrics().copyMemory.doublesClosed, 1);
  return e;
});

await scenario('J. after the master link is rebuilt, the engine listens on the new connection (once)', async (set) => {
  const w = makeWorld();
  const e = boot(w);
  set(e);
  await e.pollMaster();
  const old = w.stream;
  assert.equal(old.listeners.length, 1);

  w.stream = new FakeStream(); // the manager built a new streaming connection
  await e.pollMaster();
  await e.pollMaster();
  assert.equal(w.stream.listeners.length, 1, 'attached once to the new connection');
  assert.equal(old.listeners.length, 1, 'the old connection is left alone');

  // events on the new connection work: a trade is copied and a stop-loss change is passed on
  const t = masterTrade(w, 9201);
  await w.stream.emit('onPositionUpdated', t);
  assert.equal(term(w, 'A').positions.length, 1);
  await w.stream.emit('onPositionUpdated', { ...t, stopLoss: 2645 });
  const id = term(w, 'A').positions[0].id;
  assert.deepEqual(term(w, 'A').of('modify'), [['modify', id, 2645, 2680]]);
  return e;
});

await scenario('K. after a restart, a stop-loss change reaches copies the engine had not found yet', async (set) => {
  const w = makeWorld();
  const e1 = boot(w);
  await e1.pollMaster();
  const t = masterTrade(w, 9301);
  await w.stream.emit('onPositionUpdated', t);
  e1.stop();

  const e2 = boot(w);
  set(e2);
  await e2.pollMaster();
  await w.stream.emit('onPositionUpdated', { ...t, stopLoss: 2648 });
  for (const n of ['A', 'B']) {
    const id = term(w, n).positions[0].id;
    assert.deepEqual(term(w, n).of('modify'), [['modify', id, 2648, 2680]], n);
  }
  // a second change does not search the accounts again
  const before = term(w, 'A').reads;
  await w.stream.emit('onPositionUpdated', { ...t, stopLoss: 2649 });
  assert.equal(term(w, 'A').reads, before);
  assert.equal(term(w, 'A').of('modify').length, 2);
  return e2;
});

await scenario('L. a client that cannot be read does not hold up the others', async (set) => {
  const w = makeWorld();
  term(w, 'A').hold(7201, copyComment(5555));
  term(w, 'B').hold(7202, copyComment(5555));
  term(w, 'A').failReads = true;
  const e = boot(w);
  set(e);
  await e.pollMaster();
  await e.reconcileClients();
  await sleep(PAST_CONFIRM);
  await e.reconcileClients();
  assert.equal(term(w, 'B').positions.length, 0, 'B cleaned up');
  assert.equal(term(w, 'A').positions.length, 1, 'A could not be read: left alone');
  term(w, 'A').failReads = false;
  await e.reconcileClients();
  await sleep(PAST_CONFIRM);
  await e.reconcileClients();
  assert.equal(term(w, 'A').positions.length, 0, 'A cleaned up once readable');
  return e;
});

await scenario('M. a close the broker refuses is not hammered again straight away', async (set) => {
  const w = makeWorld(['A']);
  term(w, 'A').hold(7301, copyComment(6666));
  term(w, 'A').failClose = true;
  const e = boot(w);
  set(e);
  await e.pollMaster();
  await e.reconcileClients();
  await sleep(PAST_CONFIRM);
  await e.reconcileClients(); // confirmed: one attempt, refused
  assert.equal(term(w, 'A').of('close').length, 1);
  await e.reconcileClients();
  await e.reconcileClients();
  assert.equal(term(w, 'A').of('close').length, 1, 'backed off');
  assert.equal(term(w, 'A').positions.length, 1);
  return e;
});

await scenario('N. a trade heard before the start-up look is remembered, not copied', async (set) => {
  const w = makeWorld();
  const e = boot(w);
  set(e);
  const early = masterTrade(w, 9401);
  await w.stream.emit('onPositionUpdated', early); // before the first look
  assert.equal(e.isSeeded(), false);
  assert.equal(term(w, 'A').of('open').length, 0);
  assert.equal(e.getMasterPositionsCount(), 1);
  await e.pollMaster();
  assert.equal(e.isSeeded(), true);
  assert.equal(term(w, 'A').of('open').length, 0, 'the first look does not copy it either');
  await w.stream.emit('onPositionUpdated', masterTrade(w, 9402)); // a genuinely new trade
  assert.equal(term(w, 'A').of('open').length, 1);
  return e;
});

await scenario('O. a paused client keeps its copies following the master, and is not given new ones', async (set) => {
  const w = makeWorld(['A']);
  const e = boot(w);
  set(e);
  await e.pollMaster();
  await w.stream.emit('onPositionUpdated', masterTrade(w, 9501));
  assert.equal(term(w, 'A').positions.length, 1);
  w.clients.get('user-A').status = 'IDLE';
  await w.stream.emit('onPositionUpdated', masterTrade(w, 9502));
  assert.equal(term(w, 'A').of('open').length, 1, 'no new copy while paused');
  masterCloses(w, 9501);
  await w.stream.emit('onPositionRemoved', '9501');
  assert.equal(term(w, 'A').positions.length, 0, 'the old copy still closes with the master');
  return e;
});

await scenario('P. the real connection manager fits the engine, and a second attach does not start a second loop', async (set) => {
  const mgr = Mt5ConnectionManager.getInstance();
  const e = ReplicationEngine.getInstance();
  set(e);
  assert.equal(e.host, mgr);
  for (const m of [
    'getMasterStreamingConnection', 'getMasterRpcConnection', 'isConnected', 'getActiveClients',
    'getAllClientRecords', 'getClientConnection', 'getMasterMetrics',
  ]) assert.equal(typeof mgr[m], 'function', m);
  assert.equal(typeof mgr.getMasterMetrics().balance, 'number');
  e.attachToMasterStream();
  const timer = e.pollTimer;
  e.attachToMasterStream();
  assert.equal(e.pollTimer, timer);
  const m = e.getReplicationMetrics();
  assert.deepEqual(Object.keys(m.copyMemory).sort(), ['copiesTracked', 'doublesClosed', 'foundAfterRestart', 'lastCheckAt', 'leftoversClosed', 'ready', 'underWatch']);
  return e;
});

await scenario('Q. if the start-up look is impossible, the engine goes live after a grace period instead of staying silent', async (set) => {
  const w = makeWorld(['A']);
  const e = boot(w);
  set(e);
  w.master.failReads = true; // the master's trades cannot be read
  const t = masterTrade(w, 9601);
  await e.pollMaster();
  assert.equal(e.isSeeded(), false, 'not seeded yet');
  await w.stream.emit('onPositionUpdated', t);
  assert.equal(term(w, 'A').of('open').length, 0, 'inside the grace period a new trade is only remembered');
  e.attachedAt = Date.now() - 31_000; // the grace period has passed
  await e.pollMaster();
  assert.equal(e.isSeeded(), true);
  await w.stream.emit('onPositionUpdated', masterTrade(w, 9602));
  assert.equal(term(w, 'A').of('open').length, 1, 'after it, new trades are copied again');
  return e;
});

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
