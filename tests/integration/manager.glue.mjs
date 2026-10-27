// Check of the server glue (MT5_CONNECTION_MANAGER.ts) against a PRETEND MetaApi.
// It proves the wiring between the bridge, the supervisor, the store and the client pool:
// a normal connect, a slow broker finishing in the background, a restart, a stopped terminal,
// a restore on demand, a disconnect, a wrong password and an old failure notice.
// It says nothing about the real MetaApi or real brokers.
//
// Run with:  npm run test:glue
// (the loader in this folder lets Node read the project's TypeScript and swaps the MetaApi library
//  for an empty stand-in, so nothing needs to be installed)
import assert from 'node:assert/strict';

process.env.CONNECT_CREATE_WAIT_SECONDS = '2';
process.env.CONNECT_DEPLOY_WAIT_SECONDS = '2';
process.env.CONNECT_SYNC_WAIT_SECONDS = '1';
process.env.MAX_CLIENT_ACCOUNTS = '10';

const ROOT = new URL('../../src/backend/', import.meta.url);
const load = (f) => import(new URL(f, ROOT).href);
const { Mt5ConnectionManager } = await load('MT5_CONNECTION_MANAGER.ts');
const { MemoryConnectionStore } = await load('connectionStore.ts');
const { ConnectJobs, HandedOff, pendingFor } = await load('clientBridge.ts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- a pretend MetaApi ----------
function makeWorld() {
  const w = {
    accounts: new Map(),
    createdParams: [],
    removed: [],
    deployed: [],
    redeployed: [],
    rpcClosed: 0,
    seq: 0,
    nextSim: { deployed: true, connected: true },
    infoFor: (e) => ({
      login: Number(e.login),
      server: e.server,
      broker: 'Exness Technologies Ltd',
      name: 'Jane Doe',
      currency: 'USD',
      balance: 500,
      equity: 520,
      freeMargin: 480,
      leverage: 500,
      tradeAllowed: true,
      investorMode: false,
    }),
  };
  class Entity {
    constructor(dto) {
      Object.assign(this, dto);
    }
    async reload() {}
    async deploy() {
      w.deployed.push(this.id);
      this.state = 'DEPLOYED';
      this.connectionStatus = this.sim.connected ? 'CONNECTED' : 'DISCONNECTED';
    }
    async redeploy() {
      w.redeployed.push(this.id);
      this.state = 'DEPLOYED';
      this.connectionStatus = this.sim.connected ? 'CONNECTED' : 'DISCONNECTED';
    }
    async remove() {
      w.removed.push(this.id);
      w.accounts.delete(this.id);
    }
    async waitDeployed(seconds) {
      const end = Date.now() + seconds * 1000;
      while (Date.now() < end) {
        if (this.state === 'DEPLOYED') return;
        await sleep(30);
      }
      throw Object.assign(new Error('Timed out waiting for the account to be deployed'), { name: 'TimeoutError' });
    }
    getRPCConnection() {
      const e = this;
      return {
        async connect() {},
        async waitSynchronized(seconds) {
          const end = Date.now() + seconds * 1000;
          while (Date.now() < end) {
            if (e.connectionStatus === 'CONNECTED') return;
            await sleep(30);
          }
          throw Object.assign(new Error('Timed out waiting for the account to synchronize'), { name: 'TimeoutError' });
        },
        async getAccountInformation() {
          if (e.connectionStatus !== 'CONNECTED') throw Object.assign(new Error('The account is not connected to the broker yet'), { name: 'NotConnectedError' });
          return w.infoFor(e);
        },
        async close() {
          w.rpcClosed++;
        },
      };
    }
  }
  w.api = {
    metatraderAccountApi: {
      async getAccountsWithInfiniteScrollPagination() {
        return Array.from(w.accounts.values());
      },
      async getAccount(id) {
        const e = w.accounts.get(id);
        if (!e) throw Object.assign(new Error(`Account ${id} not found`), { name: 'NotFoundError', status: 404 });
        return e;
      },
      async createAccount(p) {
        const id = `acc-${++w.seq}`;
        const sim = { ...w.nextSim };
        w.createdParams.push(p);
        w.accounts.set(
          id,
          new Entity({
            id,
            name: p.name,
            login: p.login,
            server: p.server,
            state: sim.deployed ? 'DEPLOYED' : 'UNDEPLOYED',
            connectionStatus: sim.deployed && sim.connected ? 'CONNECTED' : 'DISCONNECTED',
            sim,
          })
        );
        return { id };
      },
    },
  };
  return w;
}

/** A manager as the server builds it at start-up (same wiring as server.ts, with an in-memory store). */
async function boot(world, store, { known = 'no' } = {}) {
  const mgr = new Mt5ConnectionManager(); // a new one each time = a server restart
  mgr.api = world.api;
  mgr.isSimulatedMode = false;
  mgr.setConnectionStore(store);
  mgr.wasVerified = async () => known;
  mgr.hasBillingHistory = async () => false;
  mgr.loadSavedStatus = async () => 'ACTIVE';
  mgr.newConnections = [];
  mgr.onNewConnection = (uid) => mgr.newConnections.push(uid);
  await mgr.startSupervisor();
  return mgr;
}

const results = [];
const ok = (name) => {
  results.push(name);
  console.log(`  ✓ ${name}`);
};

async function main() {
  const world = makeWorld();
  const store = new MemoryConnectionStore();

  // ---------- A: a normal connect ----------
  const mgr = await boot(world, store);
  const sup = mgr.getSupervisor();
  assert.ok(sup, 'the supervisor starts');
  const stages = [];
  const recA = await mgr.provisionClientTerminal({ userId: 'userA', login: '81986889', password: 'secret-A', server: 'Exness-MT5Real9' }, (s) => stages.push(s));
  assert.equal(recA.isBrokerVerified, true);
  assert.equal(recA.status, 'ACTIVE');
  assert.equal(recA.equity, 520);
  assert.equal(mgr.getClientConnection('userA'), recA);
  assert.equal(sup.isTracked('userA'), false, 'nothing left to look after once connected');
  assert.deepEqual(await store.list(), [], 'nothing pending is saved');
  assert.deepEqual(mgr.newConnections, ['userA'], 'a new connection is announced once');
  assert.ok(stages.includes('syncing') && stages.includes('verifying'));
  assert.equal(world.createdParams.length, 1);
  assert.ok(!JSON.stringify(await store.list()).includes('secret-A'));
  ok('a normal connect puts the client into service and leaves nothing pending');

  // the same account again passes straight through
  const again = await mgr.provisionClientTerminal({ userId: 'userA', login: '81986889', password: 'other', server: 'Exness-MT5Real9' });
  assert.equal(again, recA);
  assert.equal(world.createdParams.length, 1, 'no second terminal');
  ok('connecting the same account again passes straight through');

  // a different account while connected is refused kindly
  await assert.rejects(
    mgr.provisionClientTerminal({ userId: 'userA', login: '555555555', password: 'x', server: 'Exness-MT5Real9' }),
    (e) => e.code === 'ALREADY_CONNECTED'
  );
  ok('a second, different account is refused kindly while one is connected');

  // ---------- B: a slow broker carries on in the background ----------
  world.nextSim = { deployed: true, connected: false };
  const jobs = new ConnectJobs({ canContinueInBackground: (uid) => mgr.continueInBackground(uid) });
  const started = jobs.start('userB', { login: '90001', server: 'Exness-MT5Real9', secrets: ['pw-B'] }, (report) =>
    mgr.provisionClientTerminal({ userId: 'userB', login: '90001', password: 'pw-B', server: 'Exness-MT5Real9' }, report)
  );
  assert.equal(started.started, true);
  assert.equal(pendingFor(sup.view('userB'), jobs.get('userB')).kind, 'working');
  let job = jobs.get('userB');
  for (let i = 0; i < 400 && job.status === 'running'; i++) {
    await sleep(25);
    job = jobs.get('userB');
  }
  assert.equal(job.status, 'background', `expected background, got ${job.status} ${JSON.stringify(job.error)}`);
  assert.match(job.message, /keep going in the background/);
  assert.equal(job.error, undefined);
  const view = sup.view('userB');
  assert.equal(view.kind, 'working');
  assert.equal(view.login, '90001');
  assert.equal(mgr.getClientConnection('userB'), undefined, 'not in service yet');
  assert.equal(world.removed.length, 0, 'a slow terminal is kept, never removed');
  const saved = await store.list();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].userId, 'userB');
  assert.equal(saved[0].stage, 'PENDING');
  assert.ok(!JSON.stringify(saved).includes('pw-B'), 'no password is ever saved');
  assert.equal(mgr.isConnecting('userB'), false, 'the supervisor may now look after it');
  ok('a slow broker is handed to the supervisor: the job says "background", the terminal is kept and remembered');

  // the broker finishes: the supervisor puts the client into service by itself
  const entB = Array.from(world.accounts.values()).find((e) => e.login === '90001');
  entB.connectionStatus = 'CONNECTED';
  assert.equal(await sup.step('userB'), 'verified');
  const recB = mgr.getClientConnection('userB');
  assert.ok(recB && recB.isBrokerVerified && recB.status === 'ACTIVE');
  assert.deepEqual(mgr.newConnections, ['userA', 'userB'], 'a new connection finished in the background is announced once');
  assert.equal(sup.view('userB'), null);
  assert.deepEqual(await store.list(), []);
  assert.equal(pendingFor(sup.view('userB'), jobs.get('userB')), null, 'job is still "background" but nothing pending is shown');
  ok('when the broker finishes, the supervisor puts the client into service and the pending record is gone');

  // ---------- C: a server restart brings everyone back ----------
  const mgr2 = await boot(world, store, { known: 'yes' });
  const a2 = mgr2.getClientConnection('userA');
  const b2 = mgr2.getClientConnection('userB');
  assert.ok(a2 && a2.isBrokerVerified && a2.status === 'ACTIVE', 'userA restored');
  assert.ok(b2 && b2.isBrokerVerified && b2.status === 'ACTIVE', 'userB restored');
  assert.deepEqual(mgr2.newConnections, [], 'a restored client is not announced as a new connection');
  assert.equal(world.removed.length, 0);
  ok('after a restart both clients are found in MetaApi and put back into service, nobody is announced twice');

  // ---------- D: a restart finds a stopped terminal and starts it ----------
  const entA = Array.from(world.accounts.values()).find((e) => e.login === '81986889');
  entA.state = 'UNDEPLOYED';
  entA.connectionStatus = 'DISCONNECTED';
  const mgr3 = await boot(world, store, { known: 'yes' });
  assert.ok(world.deployed.includes(entA.id), 'the stopped terminal was started');
  const sup3 = mgr3.getSupervisor();
  for (let i = 0; i < 5 && !mgr3.getClientConnection('userA'); i++) await sup3.step('userA');
  const a3 = mgr3.getClientConnection('userA');
  assert.ok(a3 && a3.isBrokerVerified, 'userA is back in service');
  assert.equal(world.removed.length, 0, 'nothing was removed');
  ok('a terminal MetaApi left stopped is started again and the client is restored');

  // ---------- E: lazy restore when a client opens the dashboard ----------
  world.nextSim = { deployed: true, connected: true };
  await world.api.metatraderAccountApi.createAccount({ name: 'CastimoFX Client placeholder', login: '1', server: 's' }); // not a client name: must be ignored
  const mgr4 = await boot(world, store, { known: 'yes' });
  // a new terminal appears for userC after the start-up search
  const { clientAccountName } = await load('brokerVerification.ts');
  await world.api.metatraderAccountApi.createAccount({ name: clientAccountName('userC', '70001'), login: '70001', server: 'Exness-MT5Real9' });
  assert.equal(mgr4.getClientConnection('userC'), undefined);
  const c4 = await mgr4.restoreClientForUser('userC');
  assert.ok(c4 && c4.isBrokerVerified, 'found and restored on demand');
  ok('a client who opens the dashboard is restored on demand');

  // ---------- F: disconnect removes the terminal and forgets it ----------
  const before = world.removed.length;
  const res = await mgr4.removeClientTerminal('userC');
  assert.equal(res.removed, 1);
  assert.equal(world.removed.length, before + 1);
  assert.equal(mgr4.getClientConnection('userC'), undefined);
  assert.equal(mgr4.getSupervisor().isTracked('userC'), false);
  assert.ok(world.rpcClosed >= 1, 'the link is closed');
  ok('disconnect removes the terminal, closes the link and forgets the client');

  // ---------- G: a rejected login is removed at once and reported plainly ----------
  const world2 = makeWorld();
  world2.api.metatraderAccountApi.createAccount = async () => {
    throw Object.assign(new Error('E_AUTH: authorization failed'), { name: 'ValidationError', details: { code: 'E_AUTH' }, status: 400 });
  };
  const mgr5 = await boot(world2, new MemoryConnectionStore());
  await assert.rejects(
    mgr5.provisionClientTerminal({ userId: 'userD', login: '81986800', password: 'wrong', server: 'Exness-MT5Real9' }),
    (e) => e.code === 'BROKER_AUTH_FAILED' && !(e instanceof HandedOff)
  );
  assert.equal(mgr5.getSupervisor().isTracked('userD'), false);
  ok('a wrong password is reported plainly and nothing is left behind');

  // ---------- H: a failure notice is cleared when the client tries again ----------
  const world3 = makeWorld();
  const store3 = new MemoryConnectionStore();
  const mgr6 = await boot(world3, store3);
  const sup6 = mgr6.getSupervisor();
  await store3.put({ userId: 'userE', accountId: 'gone-1', login: '1', server: 's', stage: 'FAILED', verifiedBefore: false, startedAt: Date.now(), updatedAt: Date.now(), deadlineAt: 0, redeploys: 2, verifyFailures: 0, error: { code: 'BROKER_SLOW', message: 'tidied', hint: 'again' } });
  const mgr7 = await boot(world3, store3);
  assert.equal(mgr7.getSupervisor().view('userE').kind, 'failed', 'the notice survives a restart');
  const recE = await mgr7.provisionClientTerminal({ userId: 'userE', login: '70070', password: 'pw', server: 'Exness-MT5Real9' });
  assert.ok(recE.isBrokerVerified);
  assert.equal(mgr7.getSupervisor().view('userE'), null, 'the old notice is gone');
  assert.deepEqual(await store3.list(), []);
  void sup6;
  ok('an old "could not connect" notice survives a restart and disappears when the client connects');

  console.log(`\nGLUE OK: ${results.length} checks passed against a pretend MetaApi.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('\nGLUE CHECK FAILED:', e);
    process.exit(1);
  }
);
