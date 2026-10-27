import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalSupervisor, type SupervisorDeps, type VerifiedClient, type ActiveLink } from '../src/backend/terminalSupervisor.ts';
import { MemoryConnectionStore } from '../src/backend/connectionStore.ts';
import type { AccountHandle, BrokerGateway } from '../src/backend/clientBridge.ts';
import { DEFAULT_POLICY as CFG } from '../src/backend/terminalPolicy.ts';

// ---------- a fake MetaApi with a few terminals in it ----------

interface FakeTerminal {
  id: string;
  name: string;
  login: string;
  server: string;
  state: string;
  connectionStatus: string;
}

const T0 = 1_000_000_000;
const SEC = 1000;
const MIN = 60_000;
const HOUR = 60 * MIN;

const nameOf = (userId: string, login: string) => `CastimoFX Client ${userId} #${login}`;
const term = (userId: string, login: string, state = 'DEPLOYED', connectionStatus = 'CONNECTED', id = `acc-${userId}`): FakeTerminal => ({
  id,
  name: nameOf(userId, login),
  login,
  server: 'Exness-MT5Real9',
  state,
  connectionStatus,
});

function world(terminals: FakeTerminal[]) {
  const calls = { deploy: [] as string[], redeploy: [] as string[], remove: [] as string[], find: 0, rpcOpened: 0, rpcClosed: 0 };
  const ctl = {
    lookError: undefined as any,
    /** per-terminal answer to "what is the account?" (undefined = a normal good answer) */
    info: new Map<string, any>(),
    infoFailures: new Map<string, number>(),
    redeployError: undefined as any,
    hangFind: false,
  };
  const goodInfo = (t: FakeTerminal) => ({
    login: Number(t.login), server: t.server, broker: 'Exness Technologies Ltd', name: 'Jane Doe',
    currency: 'USD', balance: 500, equity: 520, freeMargin: 480, leverage: 500, tradeAllowed: true, investorMode: false,
  });

  const handleOf = (t: FakeTerminal): AccountHandle => ({
    id: t.id,
    name: t.name,
    login: t.login,
    server: t.server,
    state: t.state,
    connectionStatus: t.connectionStatus,
    async waitDeployed() {},
    async deploy() {
      calls.deploy.push(t.id);
      t.state = 'DEPLOYING';
    },
    async redeploy() {
      if (ctl.redeployError) throw ctl.redeployError;
      calls.redeploy.push(t.id);
      t.state = 'UNDEPLOYING';
    },
    rpc: () => ({
      async connect() {
        calls.rpcOpened++;
      },
      async waitSynchronized() {},
      async getAccountInformation() {
        const left = ctl.infoFailures.get(t.id) ?? 0;
        if (left > 0) {
          ctl.infoFailures.set(t.id, left - 1);
          throw new Error('Terminal is not connected to broker yet');
        }
        return ctl.info.has(t.id) ? ctl.info.get(t.id) : goodInfo(t);
      },
      async close() {
        calls.rpcClosed++;
      },
      raw: { rpc: t.id },
    }),
    raw: t,
  });

  const gateway: BrokerGateway = {
    async listAccounts() {
      if (ctl.lookError) throw ctl.lookError;
      return terminals.map((t) => ({ id: t.id, name: t.name, login: t.login, server: t.server, state: t.state, connectionStatus: t.connectionStatus }));
    },
    async createAccount() {
      throw new Error('not used here');
    },
    async getAccount(id) {
      const t = terminals.find((x) => x.id === id);
      if (!t) throw new Error('not found');
      return handleOf(t);
    },
    async findAccount(id) {
      calls.find++;
      if (ctl.hangFind) return new Promise<never>(() => {});
      if (ctl.lookError) throw ctl.lookError;
      const t = terminals.find((x) => x.id === id);
      return t ? handleOf(t) : null;
    },
    async removeAccount(id) {
      calls.remove.push(id);
      const i = terminals.findIndex((x) => x.id === id);
      if (i >= 0) terminals.splice(i, 1);
    },
  };
  return { gateway, calls, ctl, terminals };
}

function make(terminals: FakeTerminal[], over: Partial<SupervisorDeps> = {}) {
  const w = world(terminals);
  const store = new MemoryConnectionStore();
  const clock = { t: T0 };
  const verified: VerifiedClient[] = [];
  const active = new Set<string>();
  const connecting = new Set<string>();
  const known = new Map<string, 'yes' | 'no' | 'unknown'>(); // key: `${user}|${account}`; default 'no'
  const billing = new Set<string>();
  const links: ActiveLink[] = [];
  const logs: string[] = [];
  const sup = new TerminalSupervisor({
    gateway: w.gateway,
    store,
    limits: { minEquity: 200 },
    isActive: (u) => active.has(u),
    isConnecting: (u) => connecting.has(u),
    wasVerified: async (u, a) => known.get(`${u}|${a}`) ?? 'no',
    hasBillingHistory: async (u) => billing.has(u),
    onVerified: async (c) => {
      verified.push(c);
      active.add(c.rec.userId);
    },
    activeLinks: () => links,
    now: () => clock.t,
    timeouts: { listSeconds: 1, connectSeconds: 1, syncSeconds: 1, infoSeconds: 1, probeEveryMs: 5 },
    log: (l, m) => logs.push(`${l}:${m}`),
    ...over,
  });
  const track = (userId: string, login = '81986889', verifiedBefore = false) =>
    sup.track({ userId, accountId: `acc-${userId}`, login, server: 'Exness-MT5Real9', verifiedBefore });
  return { sup, w, store, clock, verified, active, connecting, known, billing, links, logs, track };
}

const U = 'user-AAA111';

// ---------- moving a terminal forward ----------

test('a connected terminal is read from the broker and put into service', async () => {
  const m = make([term(U, '81986889')]);
  await m.track(U);
  assert.equal(await m.sup.step(U), 'verified');
  assert.equal(m.verified.length, 1);
  const v = m.verified[0];
  assert.equal(v.verified.equity, 520);
  assert.equal(v.handle.id, `acc-${U}`);
  assert.deepEqual(v.rpc.raw, { rpc: `acc-${U}` });
  assert.equal(m.w.calls.rpcClosed, 0, 'the link is kept open for the copy engine');
  assert.equal(m.sup.isTracked(U), false);
  assert.deepEqual(await m.store.list(), []);
  assert.equal(m.sup.view(U), null);
});

test('an undeployed terminal is started, then verified once it connects', async () => {
  const t = term(U, '81986889', 'UNDEPLOYED', 'DISCONNECTED');
  const m = make([t]);
  await m.track(U);
  assert.equal(await m.sup.step(U), 'waiting');
  assert.deepEqual(m.w.calls.deploy, [`acc-${U}`]);
  assert.equal(m.sup.view(U)!.label, 'Starting your trading terminal…');
  // MetaApi finishes starting it
  t.state = 'DEPLOYED';
  t.connectionStatus = 'CONNECTED';
  m.clock.t += 20 * SEC;
  assert.equal(await m.sup.step(U), 'verified');
});

test('deployed but disconnected: waits, restarts, then verifies when it connects', async () => {
  const t = term(U, '81986889', 'DEPLOYED', 'DISCONNECTED');
  const m = make([t]);
  await m.track(U);
  assert.equal(await m.sup.step(U), 'waiting');
  assert.equal(m.sup.view(U)!.label, 'Waiting for your broker to accept the terminal…');
  m.clock.t += 30 * SEC;
  await m.sup.step(U);
  assert.equal(m.w.calls.redeploy.length, 0, 'given time first');
  m.clock.t += 65 * SEC; // 95 s since first seen disconnected
  assert.equal(await m.sup.step(U), 'waiting');
  assert.deepEqual(m.w.calls.redeploy, [`acc-${U}`]);
  assert.equal(m.sup.records()[0].redeploys, 1);
  assert.equal(m.sup.view(U)!.label, 'Restarting your terminal to help it connect…');
  // the restart worked
  t.state = 'DEPLOYED';
  t.connectionStatus = 'CONNECTED';
  m.clock.t += 40 * SEC;
  assert.equal(await m.sup.step(U), 'verified');
  assert.equal(m.w.calls.redeploy.length, 1);
});

test('restarts are paced and capped, never a storm', async () => {
  const m = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  await m.track(U);
  const t = m.w.terminals[0];
  await m.sup.step(U);
  for (let i = 0; i < 40; i++) {
    m.clock.t += 20 * SEC;
    t.state = 'DEPLOYED'; // the restart did not help
    t.connectionStatus = 'DISCONNECTED';
    await m.sup.step(U);
    if (m.sup.records()[0]?.stage === 'FAILED') break;
  }
  assert.equal(m.w.calls.redeploy.length, CFG.maxRedeploys, 'at most the allowed number of restarts');
});

test('a terminal that never connects is given up on, tidied away, and the client is told calmly', async () => {
  const m = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  await m.track(U);
  await m.sup.step(U);
  m.clock.t += 16 * MIN;
  assert.equal(await m.sup.step(U), 'failed');
  assert.deepEqual(m.w.calls.remove, [`acc-${U}`]);
  const view = m.sup.view(U)!;
  assert.equal(view.kind, 'failed');
  assert.match(view.error!.message, /tidy/);
  assert.match(view.error!.hint, /Connect again/);
  // the record stays a day so the client can read it, then goes
  m.clock.t += 2 * HOUR;
  assert.equal(await m.sup.step(U), 'skipped');
  assert.equal(m.sup.isTracked(U), true);
  m.clock.t += 24 * HOUR;
  assert.equal(await m.sup.step(U), 'gone');
  assert.equal(m.sup.isTracked(U), false);
  assert.deepEqual(await m.store.list(), []);
});

test('a client verified on this terminal before is never given up on or removed', async () => {
  const m = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  await m.track(U, '81986889', true);
  await m.sup.step(U);
  for (let h = 0; h < 8; h++) {
    m.clock.t += HOUR;
    assert.notEqual(await m.sup.step(U), 'failed');
  }
  assert.equal(m.w.calls.remove.length, 0);
  assert.equal(m.sup.records()[0].stage, 'PENDING');
  assert.ok(m.w.calls.redeploy.length >= 1, 'it is restarted now and then, patiently');
  assert.ok(m.w.calls.redeploy.length <= 8);
});

test('billing history, or not knowing, protects a terminal from clean-up', async () => {
  const a = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  a.billing.add(U);
  await a.track(U);
  await a.sup.step(U);
  a.clock.t += 16 * MIN;
  assert.equal(await a.sup.step(U), 'failed');
  assert.equal(a.w.calls.remove.length, 0);
  assert.doesNotMatch(a.sup.view(U)!.error!.message, /tidy/, 'it was not cleared, so it does not say so');

  const b = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  b.known.set(`${U}|acc-${U}`, 'unknown');
  await b.track(U);
  await b.sup.step(U);
  b.clock.t += 16 * MIN;
  assert.equal(await b.sup.step(U), 'failed');
  assert.equal(b.w.calls.remove.length, 0);

  const c = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')], {
    hasBillingHistory: async () => {
      throw new Error('db down');
    },
  });
  await c.track(U);
  await c.sup.step(U);
  c.clock.t += 16 * MIN;
  await c.sup.step(U);
  assert.equal(c.w.calls.remove.length, 0, 'if the billing check fails, nothing is removed');
});

// ---------- the broker's answer ----------

test('below the minimum equity: refused with the figures, the terminal is removed and the link closed', async () => {
  const t = term(U, '81986889');
  const m = make([t]);
  m.w.ctl.info.set(t.id, { login: 81986889, broker: 'Exness', currency: 'USD', balance: 120, equity: 120, freeMargin: 120, leverage: 500, tradeAllowed: true, investorMode: false });
  await m.track(U);
  assert.equal(await m.sup.step(U), 'failed');
  assert.equal(m.verified.length, 0);
  assert.deepEqual(m.w.calls.remove, [t.id]);
  assert.equal(m.w.calls.rpcClosed, 1);
  const v = m.sup.view(U)!;
  assert.equal(v.error!.code, 'MIN_EQUITY');
  assert.match(v.error!.message, /\$120\.00/);
  assert.match(v.error!.hint, /press Connect again/i);
});

test('a client verified before is brought back even below the minimum equity', async () => {
  const t = term(U, '81986889');
  const m = make([t]);
  m.w.ctl.info.set(t.id, { login: 81986889, broker: 'Exness', currency: 'USD', balance: 120, equity: 120, freeMargin: 120, leverage: 500, tradeAllowed: true, investorMode: false });
  await m.track(U, '81986889', true);
  assert.equal(await m.sup.step(U), 'verified');
  assert.equal(m.verified[0].verified.equity, 120);
});

test('a login that can only view the account is refused for good, but a verified client keeps their terminal', async () => {
  const investor = { login: 81986889, broker: 'Exness', currency: 'USD', balance: 500, equity: 500, tradeAllowed: true, investorMode: true };
  const a = make([term(U, '81986889')]);
  a.w.ctl.info.set(`acc-${U}`, investor);
  await a.track(U);
  assert.equal(await a.sup.step(U), 'failed');
  assert.equal(a.sup.view(U)!.error!.code, 'TRADING_NOT_ALLOWED');
  assert.deepEqual(a.w.calls.remove, [`acc-${U}`]);

  const b = make([term(U, '81986889')]);
  b.w.ctl.info.set(`acc-${U}`, investor);
  await b.track(U, '81986889', true);
  assert.equal(await b.sup.step(U), 'failed');
  assert.equal(b.w.calls.remove.length, 0, 'never removed');
});

test('a broker that is not ready is asked again; an empty answer is retried, and after a few misses the terminal is restarted', async () => {
  const t = term(U, '81986889');
  const m = make([t]);
  m.w.ctl.infoFailures.set(t.id, 1000); // the broker keeps saying "not yet"
  await m.track(U);
  assert.equal(await m.sup.step(U), 'waiting');
  assert.equal(m.sup.records()[0].verifyFailures, 1);
  assert.equal(await m.sup.step(U), 'waiting');
  assert.equal(m.sup.records()[0].verifyFailures, 2);
  m.w.ctl.infoFailures.set(t.id, 0); // now it answers
  assert.equal(await m.sup.step(U), 'verified');
  assert.equal(m.w.calls.rpcClosed, 2, 'each failed attempt closed its link');

  const t2 = term('user-BBB222', '22222222');
  const m2 = make([t2]);
  m2.w.ctl.info.set(t2.id, {}); // half-synced terminal reporting nothing
  await m2.track('user-BBB222', '22222222');
  for (let i = 0; i < 3; i++) assert.equal(await m2.sup.step('user-BBB222'), 'waiting');
  assert.equal(m2.sup.records()[0].verifyFailures, 3);
  assert.equal(m2.w.calls.redeploy.length, 0);
  await m2.sup.step('user-BBB222');
  assert.equal(m2.w.calls.redeploy.length, 1, 'restarted after repeated misses');
  assert.equal(m2.sup.records()[0].verifyFailures, 0);
});

test('if putting the client into service fails, the link is closed and the check is repeated', async () => {
  let fail = true;
  const m = make([term(U, '81986889')], {
    onVerified: async (c) => {
      if (fail) throw new Error('could not register');
      m2verified.push(c);
    },
  });
  const m2verified: VerifiedClient[] = [];
  await m.track(U);
  assert.equal(await m.sup.step(U), 'waiting');
  assert.equal(m.w.calls.rpcClosed, 1);
  assert.equal(m.sup.records()[0].verifyFailures, 1);
  fail = false;
  assert.equal(await m.sup.step(U), 'verified');
  assert.equal(m2verified.length, 1);
});

// ---------- other things that can happen ----------

test('a terminal that vanished from MetaApi is reported at once and nothing is removed', async () => {
  const m = make([]);
  await m.track(U);
  assert.equal(await m.sup.step(U), 'failed');
  assert.equal(m.w.calls.remove.length, 0);
  assert.equal(m.sup.view(U)!.error!.code, 'TERMINAL_MISSING');
});

test('users already in service, or connecting right now, are left alone', async () => {
  const m = make([term(U, '81986889')]);
  await m.track(U);
  m.connecting.add(U);
  const before = m.w.calls.find;
  assert.equal(await m.sup.step(U), 'skipped');
  assert.equal(m.w.calls.find, before, 'MetaApi was not even asked');
  m.connecting.delete(U);
  m.active.add(U);
  assert.equal(await m.sup.step(U), 'verified');
  assert.equal(m.verified.length, 0, 'the existing link is not replaced');
  assert.equal(m.sup.isTracked(U), false);
});

test('two checks of the same user never overlap', async () => {
  const m = make([term(U, '81986889')]);
  await m.track(U);
  const [a, b] = await Promise.all([m.sup.step(U), m.sup.step(U)]);
  assert.deepEqual([a, b].sort(), ['skipped', 'verified']);
  assert.equal(m.verified.length, 1);
});

test('when MetaApi cannot be reached nothing changes, and the time limit is paused', async () => {
  const m = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  await m.track(U);
  const rec0 = m.sup.records()[0];
  await m.sup.tick(); // a normal tick first
  m.w.ctl.lookError = new Error('ECONNRESET');
  for (let i = 0; i < 4; i++) {
    m.clock.t += 15 * SEC;
    await m.sup.tick();
  }
  const rec = m.sup.records()[0];
  assert.equal(rec.stage, 'PENDING');
  assert.equal(rec.redeploys, 0);
  assert.equal(rec.deadlineAt, rec0.deadlineAt + 4 * 15 * SEC, 'the clock did not run while nobody could look');
  assert.equal(m.w.calls.remove.length, 0);
});

test('idle ticks write nothing: only real changes are saved', async () => {
  const m = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  await m.track(U);
  await m.sup.step(U); // first sight: disconnected clock starts
  const writes = m.store.writes;
  for (let i = 0; i < 4; i++) {
    m.clock.t += 5 * SEC;
    await m.sup.step(U);
  }
  assert.equal(m.store.writes, writes);
});

test('a tick looks after several clients at once and summarises', async () => {
  const m = make([term('u1', '1111', 'DEPLOYED', 'CONNECTED'), term('u2', '2222', 'DEPLOYED', 'DISCONNECTED'), term('u4', '4444')], { maxParallel: 2 });
  await m.track('u1', '1111');
  await m.track('u2', '2222');
  await m.track('u3', '3333'); // no such terminal
  await m.track('u4', '4444');
  const s = await m.sup.tick();
  assert.deepEqual(s, { looked: 4, verified: 2, failed: 1 });
  assert.equal(m.sup.isTracked('u2'), true);
});

// ---------- remembering across restarts ----------

test('unfinished connections survive a restart and get a few minutes of grace', async () => {
  const m = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  await m.track(U);
  await m.sup.step(U);

  // a new server process, much later, with the same saved records
  const t = world(m.w.terminals);
  const later = { t: T0 + 3 * HOUR };
  const sup2 = new TerminalSupervisor({
    gateway: t.gateway,
    store: m.store,
    limits: { minEquity: 200 },
    isActive: () => false,
    isConnecting: () => false,
    wasVerified: async () => 'no',
    hasBillingHistory: async () => false,
    onVerified: async () => {},
    now: () => later.t,
    timeouts: { listSeconds: 1 },
  });
  assert.equal(await sup2.load(), 1);
  const rec = sup2.records()[0];
  assert.equal(rec.userId, U);
  assert.equal(rec.deadlineAt, later.t + 5 * MIN, 'a lapsed time limit is renewed for a few minutes');
  assert.equal(await sup2.step(U), 'waiting', 'not given up on the very first look');
  assert.equal(t.calls.remove.length, 0);
});

test('a store that fails never stops the supervisor', async () => {
  const bad = new MemoryConnectionStore();
  bad.put = async () => {
    throw new Error('firestore down');
  };
  bad.delete = async () => {
    throw new Error('firestore down');
  };
  const m = make([term(U, '81986889')], { store: bad });
  await m.track(U);
  assert.equal(await m.sup.step(U), 'verified');
  assert.equal(m.verified.length, 1);
});

// ---------- tracking calls from the browser flow ----------

test('tracking a terminal again keeps what was learned and renews the time window; a new terminal starts fresh', async () => {
  const m = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  const first = await m.track(U);
  await m.sup.step(U);
  m.clock.t += 5 * MIN;
  const again = await m.track(U);
  assert.equal(again.startedAt, first.startedAt);
  assert.equal(again.deadlineAt, m.clock.t + CFG.windowMs);
  assert.equal(again.lastState, 'DEPLOYED');

  const other = await m.sup.track({ userId: U, accountId: 'acc-other', login: '5555', server: 'S' });
  assert.equal(other.accountId, 'acc-other');
  assert.equal(other.redeploys, 0);
  assert.equal(other.lastState, undefined);
});

test('handing off gives a fresh window; untrack forgets; untrack for another terminal does nothing', async () => {
  const m = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  assert.equal(await m.sup.handOff(U), false, 'nothing to hand off');
  await m.track(U);
  m.clock.t += 10 * MIN;
  assert.equal(await m.sup.handOff(U), true);
  assert.equal(m.sup.records()[0].deadlineAt, m.clock.t + CFG.windowMs);
  await m.sup.untrack(U, 'some-other-terminal');
  assert.equal(m.sup.isTracked(U), true);
  await m.sup.untrack(U, `acc-${U}`);
  assert.equal(m.sup.isTracked(U), false);
  assert.deepEqual(await m.store.list(), []);
});

test('a new attempt clears the old "could not connect" notice, but never a terminal that is still connecting', async () => {
  const m = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  assert.equal(await m.sup.clearFailure(U), false, 'nothing to clear');
  await m.track(U);
  assert.equal(await m.sup.clearFailure(U), false, 'a terminal that is still connecting is left alone');
  assert.equal(m.sup.isTracked(U), true);
  await m.sup.step(U);
  m.clock.t += 16 * MIN;
  assert.equal(await m.sup.step(U), 'failed');
  assert.equal(m.sup.view(U)!.kind, 'failed');
  assert.equal(await m.sup.clearFailure(U), true);
  assert.equal(m.sup.view(U), null);
  assert.deepEqual(await m.store.list(), []);
});

test('stepNow gives up waiting but never throws', async () => {
  const m = make([term(U, '81986889')]);
  await m.track(U);
  m.w.ctl.hangFind = true;
  assert.equal(await m.sup.stepNow(U, 30), 'timeout');
});

// ---------- finding terminals nobody is looking after ----------

test('discovery adopts leftover client terminals, ignores the master, and is repeatable', async () => {
  const master = { id: 'master-1', name: 'CastimoFX Master', login: '261089492', server: 'HFMarketsGlobal-Live20', state: 'DEPLOYED', connectionStatus: 'CONNECTED' };
  const m = make([
    master,
    term('u-new', '1111', 'DEPLOYED', 'DISCONNECTED'), // never verified
    term('u-old', '2222', 'DEPLOYED', 'CONNECTED'), // verified in the past
    term('u-unsure', '3333'), // cannot tell
    term('u-live', '4444'), // already in service
    term('u-busy', '5555'), // connecting right now
  ]);
  m.known.set('u-old|acc-u-old', 'yes');
  m.known.set('u-unsure|acc-u-unsure', 'unknown');
  m.active.add('u-live');
  m.connecting.add('u-busy');

  const r = await m.sup.discover();
  assert.equal(r.adopted, 3);
  const by = Object.fromEntries(m.sup.records().map((x) => [x.userId, x]));
  assert.deepEqual(Object.keys(by).sort(), ['u-new', 'u-old', 'u-unsure']);
  assert.equal(by['u-new'].verifiedBefore, false);
  assert.ok(by['u-new'].deadlineAt > T0, 'a new terminal has a time limit');
  assert.equal(by['u-old'].verifiedBefore, true);
  assert.equal(by['u-old'].deadlineAt, 0, 'a verified client has none');
  assert.equal(by['u-unsure'].verifiedBefore, true, 'in doubt, never treated as disposable');
  assert.equal(by['u-new'].lastConnectionStatus, 'DISCONNECTED');
  assert.equal((await m.store.list()).length, 3, 'saved');

  assert.equal((await m.sup.discover()).adopted, 0, 'nothing is adopted twice');
  assert.ok(m.sup.stats.lastDiscoverAt > 0);
});

test('discovery for one user only looks at that user; it never replaces a connection that is still being worked on', async () => {
  const m = make([term('u1', '1111', 'DEPLOYED', 'CONNECTED', 'acc-1'), term('u2', '2222', 'DEPLOYED', 'CONNECTED', 'acc-2')]);
  assert.equal((await m.sup.discover({ userId: 'u1' })).adopted, 1);
  assert.deepEqual(m.sup.records().map((r) => r.userId), ['u1']);

  // u2 is already being worked on for a DIFFERENT terminal: that is left alone
  await m.sup.track({ userId: 'u2', accountId: 'acc-elsewhere', login: '9999', server: 'S' });
  assert.equal((await m.sup.discover({ userId: 'u2' })).adopted, 0);

  // once that attempt has failed (its terminal is gone), the terminal that really exists takes its place
  assert.equal(await m.sup.step('u2'), 'failed');
  assert.equal((await m.sup.discover({ userId: 'u2' })).adopted, 1);
  assert.equal(m.sup.records().find((r) => r.userId === 'u2')!.accountId, 'acc-2');
});

test('an adopted leftover then finds its way: restarted if stuck, put into service when connected', async () => {
  const t = term('u1', '1111', 'UNDEPLOYED', 'DISCONNECTED', 'acc-1');
  const m = make([t]);
  m.known.set('u1|acc-1', 'yes');
  await m.sup.discover();
  assert.equal(await m.sup.step('u1'), 'waiting');
  assert.deepEqual(m.w.calls.deploy, ['acc-1']);
  t.state = 'DEPLOYED';
  t.connectionStatus = 'CONNECTED';
  assert.equal(await m.sup.step('u1'), 'verified');
  assert.equal(m.verified[0].rec.verifiedBefore, true);
});

// ---------- links of clients already in service ----------

test('a live client whose link stays down gets their terminal restarted, gently', async () => {
  const t = term(U, '81986889', 'DEPLOYED', 'DISCONNECTED');
  const m = make([t]);
  m.links.push({ userId: U, accountId: t.id, login: '81986889', connectionState: 'ERROR' });
  assert.equal(await m.sup.healActive(), 0, 'just noticed: wait');
  m.clock.t += 60 * SEC;
  assert.equal(await m.sup.healActive(), 0);
  m.clock.t += 40 * SEC; // 100 s in error
  assert.equal(await m.sup.healActive(), 1);
  assert.deepEqual(m.w.calls.redeploy, [t.id]);
  // the pause between restarts is respected
  t.state = 'DEPLOYED';
  m.clock.t += 5 * MIN;
  assert.equal(await m.sup.healActive(), 0);
  m.clock.t += 6 * MIN;
  assert.equal(await m.sup.healActive(), 1);
  assert.equal(m.w.calls.redeploy.length, 2);
});

test('a live link that is only quiet on our side is not restarted; a stopped terminal is started; recovery resets', async () => {
  const t = term(U, '81986889', 'DEPLOYED', 'CONNECTED');
  const m = make([t]);
  m.links.push({ userId: U, accountId: t.id, login: '81986889', connectionState: 'ERROR' });
  await m.sup.healActive();
  m.clock.t += 2 * MIN;
  assert.equal(await m.sup.healActive(), 0);
  assert.equal(m.w.calls.redeploy.length, 0, 'MetaApi says connected: the manager rebuilds the link itself');

  t.state = 'UNDEPLOYED';
  t.connectionStatus = 'DISCONNECTED';
  m.clock.t += 20 * MIN;
  await m.sup.healActive();
  assert.deepEqual(m.w.calls.deploy, [t.id]);

  // the link recovers: the error clock stops
  m.links[0].connectionState = 'CONNECTED';
  await m.sup.healActive();
  m.links[0].connectionState = 'ERROR';
  t.state = 'DEPLOYED';
  t.connectionStatus = 'DISCONNECTED';
  m.clock.t += 30 * MIN;
  await m.sup.healActive();
  assert.equal(m.w.calls.redeploy.length, 0, 'a new error spell starts a new wait');
});

test('a failing restart call is not repeated every tick', async () => {
  const t = term(U, '81986889', 'DEPLOYED', 'DISCONNECTED');
  const m = make([t]);
  m.w.ctl.redeployError = new Error('MetaApi busy');
  m.links.push({ userId: U, accountId: t.id, login: '81986889', connectionState: 'ERROR' });
  await m.sup.healActive();
  m.clock.t += 2 * MIN;
  await m.sup.healActive();
  m.clock.t += 15 * SEC;
  await m.sup.healActive();
  assert.equal(m.logs.filter((l) => /Could not restart the live terminal/.test(l)).length, 1);
});

// ---------- administrator tools ----------

test('the inventory lists client terminals with their status, and never the master', async () => {
  const master = { id: 'master-1', name: 'CastimoFX Master', login: '261089492', server: 'HFMarketsGlobal-Live20', state: 'DEPLOYED', connectionStatus: 'CONNECTED' };
  const m = make([master, term('u1', '1111', 'DEPLOYED', 'DISCONNECTED'), term('u2', '2222')]);
  m.active.add('u2');
  await m.track('u1', '1111');
  await m.sup.step('u1');
  await m.sup.track({ userId: 'u3', accountId: 'acc-lost', login: '3333', server: 'S' });
  const rows = await m.sup.inventory();
  assert.equal(rows.find((r) => r.accountId === 'master-1'), undefined);
  const r1 = rows.find((r) => r.userId === 'u1')!;
  assert.equal(r1.state, 'DEPLOYED');
  assert.equal(r1.connectionStatus, 'DISCONNECTED');
  assert.equal(r1.tracked, 'PENDING');
  assert.equal(r1.live, false);
  assert.ok(r1.disconnectedSince);
  assert.equal(r1.minutesLeft, 15);
  assert.equal(rows.find((r) => r.userId === 'u2')!.live, true);
  const lost = rows.find((r) => r.userId === 'u3')!;
  assert.equal(lost.missing, true);
  assert.equal(lost.state, undefined);
});

test('administrator restart: a client terminal is restarted (or started), anything else is refused', async () => {
  const master = { id: 'master-1', name: 'CastimoFX Master', login: '261089492', server: 'X', state: 'DEPLOYED', connectionStatus: 'CONNECTED' };
  const m = make([master, term('u1', '1111'), term('u2', '2222', 'UNDEPLOYED', 'DISCONNECTED')]);
  assert.deepEqual(await m.sup.redeployTerminal('master-1'), { ok: false, reason: 'NOT_CLIENT' });
  assert.deepEqual(await m.sup.redeployTerminal('nope'), { ok: false, reason: 'NOT_FOUND' });
  assert.deepEqual(await m.sup.redeployTerminal('acc-u1'), { ok: true });
  assert.deepEqual(await m.sup.redeployTerminal('acc-u2'), { ok: true });
  assert.deepEqual(m.w.calls.redeploy, ['acc-u1']);
  assert.deepEqual(m.w.calls.deploy, ['acc-u2']);
});

test('administrator removal never touches the master or a live client, and protects verified clients unless forced', async () => {
  const master = { id: 'master-1', name: 'CastimoFX Master', login: '261089492', server: 'X', state: 'DEPLOYED', connectionStatus: 'CONNECTED' };
  const m = make([master, term('u-live', '1111'), term('u-old', '2222'), term('u-bill', '3333'), term('u-stale', '4444', 'DEPLOYED', 'DISCONNECTED')]);
  m.active.add('u-live');
  m.known.set('u-old|acc-u-old', 'yes');
  m.billing.add('u-bill');

  assert.deepEqual(await m.sup.removeTerminal('master-1', { force: true }), { ok: false, reason: 'NOT_CLIENT' });
  assert.deepEqual(await m.sup.removeTerminal('acc-u-live', { force: true }), { ok: false, reason: 'LIVE' });
  assert.deepEqual(await m.sup.removeTerminal('acc-u-old'), { ok: false, reason: 'PROTECTED' });
  assert.deepEqual(await m.sup.removeTerminal('acc-u-bill'), { ok: false, reason: 'PROTECTED' });
  assert.deepEqual(await m.sup.removeTerminal('missing'), { ok: false, reason: 'NOT_FOUND' });
  assert.equal(m.w.calls.remove.length, 0);

  assert.deepEqual(await m.sup.removeTerminal('acc-u-stale'), { ok: true });
  assert.deepEqual(await m.sup.removeTerminal('acc-u-old', { force: true }), { ok: true });
  assert.deepEqual(m.w.calls.remove, ['acc-u-stale', 'acc-u-old']);
});

test('removing a terminal also forgets its record; a record whose terminal is gone can be cleared', async () => {
  const m = make([term(U, '81986889', 'DEPLOYED', 'DISCONNECTED')]);
  await m.track(U);
  assert.deepEqual(await m.sup.removeTerminal(`acc-${U}`), { ok: true });
  assert.equal(m.sup.isTracked(U), false);

  await m.sup.track({ userId: 'u9', accountId: 'acc-ghost', login: '999', server: 'S' });
  assert.deepEqual(await m.sup.removeTerminal('acc-ghost'), { ok: true });
  assert.equal(m.sup.isTracked('u9'), false);
});

test('clean-up removes failed and forgotten leftovers only', async () => {
  const m = make([
    term('u-live', '1111'),
    term('u-pending', '2222', 'DEPLOYED', 'DISCONNECTED'),
    term('u-failed', '3333', 'DEPLOYED', 'DISCONNECTED'),
    term('u-old', '4444'),
    term('u-leftover', '5555', 'UNDEPLOYED', 'DISCONNECTED'),
  ]);
  m.active.add('u-live');
  m.known.set('u-old|acc-u-old', 'yes');
  await m.track('u-pending', '2222');
  await m.track('u-failed', '3333');
  m.billing.add('u-failed'); // not removed by the time-out below...
  await m.sup.step('u-pending');
  await m.sup.step('u-failed');
  m.clock.t += 16 * MIN;
  await m.sup.step('u-failed'); // ...so it is now a FAILED record whose terminal still exists
  m.billing.delete('u-failed');
  await m.sup.track({ userId: 'u-pending', accountId: 'acc-u-pending', login: '2222', server: 'S' }); // still connecting

  const r = await m.sup.cleanupStale();
  assert.deepEqual(r.removed.sort(), ['acc-u-failed', 'acc-u-leftover']);
  assert.equal(r.kept, 3);
  assert.ok(!m.w.calls.remove.includes('acc-u-live'));
  assert.ok(!m.w.calls.remove.includes('acc-u-old'));
  assert.ok(!m.w.calls.remove.includes('acc-u-pending'));
});

test('the supervisor timers start and stop cleanly', async () => {
  const m = make([]);
  m.sup.start({ tickMs: 5, discoverMs: 5 });
  await new Promise((r) => setTimeout(r, 30));
  m.sup.stop();
  const ticks = m.sup.stats.ticks;
  assert.ok(ticks >= 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(m.sup.stats.ticks, ticks, 'stopped');
});

test('an orphan whose owner has billing history is treated as connected before, even without a saved record', async () => {
  const m = make([term('u1', '1111', 'DEPLOYED', 'DISCONNECTED', 'acc-1'), term('u2', '2222', 'DEPLOYED', 'DISCONNECTED', 'acc-2')]);
  m.billing.add('u1');
  await m.sup.discover();
  const by = Object.fromEntries(m.sup.records().map((r) => [r.userId, r]));
  assert.equal(by['u1'].verifiedBefore, true);
  assert.equal(by['u1'].deadlineAt, 0);
  assert.equal(by['u2'].verifiedBefore, false);

  // and if the billing lookup itself fails, nobody is treated as new
  const m2 = make([term('u3', '3333', 'DEPLOYED', 'DISCONNECTED', 'acc-3')], {
    hasBillingHistory: async () => {
      throw new Error('db down');
    },
  });
  await m2.sup.discover();
  assert.equal(m2.sup.records()[0].verifiedBefore, true);
});
