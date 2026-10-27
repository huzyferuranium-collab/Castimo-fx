import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectClient,
  ConnectJobs,
  StageTimeoutError,
  friendlyHint,
  type BrokerGateway,
  type BridgeDeps,
  type Stage,
} from '../src/backend/clientBridge.ts';
import { BrokerVerificationError, translateBrokerError } from '../src/backend/brokerVerification.ts';
import { metaApiGateway } from '../src/backend/metaApiGateway.ts';

// ---------- a fake broker / MetaApi ----------

type Behaviour = {
  existing?: Array<{ id: string; name: string; login: string; server: string }>;
  createError?: any;
  createErrors?: any[]; // consumed one per create call
  createHangs?: boolean;
  createdButSlow?: boolean; // create hangs but the account appears in the list
  deployHangs?: boolean;
  deployError?: any;
  syncHangs?: boolean;
  connectError?: any;
  info?: any;
  infoHangs?: boolean;
  listError?: any;
  loginOnAccount?: string;
};

const GOOD_INFO = {
  login: 81986889, server: 'Exness-MT5Real9', broker: 'Exness Technologies Ltd', name: 'Jane Doe',
  currency: 'USD', balance: 500, equity: 520, freeMargin: 480, leverage: 500,
  tradeAllowed: true, investorMode: false,
};

function makeFake(b: Behaviour = {}) {
  const calls = { create: [] as any[], remove: [] as string[], list: 0, deployed: 0 };
  const accounts = [...(b.existing || [])];
  const never = () => new Promise<never>(() => {});
  let createN = 0;

  const gateway: BrokerGateway = {
    async listAccounts() {
      calls.list++;
      if (b.listError) throw b.listError;
      return accounts.map((a) => ({ ...a }));
    },
    async createAccount(p) {
      calls.create.push(p);
      const queued = b.createErrors?.[createN++];
      if (queued) throw queued;
      if (b.createError) throw b.createError;
      if (b.createdButSlow) {
        accounts.push({ id: 'acc-new', name: p.name, login: p.login, server: p.server });
        return never();
      }
      if (b.createHangs) return never();
      accounts.push({ id: 'acc-new', name: p.name, login: p.login, server: p.server });
      return { id: 'acc-new' };
    },
    async getAccount(id) {
      const a = accounts.find((x) => x.id === id)!;
      return {
        id: a.id,
        name: a.name,
        login: b.loginOnAccount ?? a.login,
        server: a.server,
        async waitDeployed() {
          calls.deployed++;
          if (b.deployHangs) return never();
          if (b.deployError) throw b.deployError;
        },
        rpc: () => ({
          async connect() {
            if (b.connectError) throw b.connectError;
          },
          async waitSynchronized() {
            if (b.syncHangs) return never();
          },
          async getAccountInformation() {
            if (b.infoHangs) return never();
            return b.info === undefined ? GOOD_INFO : b.info;
          },
          raw: { rpc: true },
        }),
        raw: { entity: id },
      };
    },
    async removeAccount(id) {
      calls.remove.push(id);
      const i = accounts.findIndex((x) => x.id === id);
      if (i >= 0) accounts.splice(i, 1);
    },
  };
  return { gateway, calls, accounts };
}

const fast = { listSeconds: 0.2, createSeconds: 0.05, deploySeconds: 0.05, connectSeconds: 0.05, syncSeconds: 0.05, infoSeconds: 0.05 };

function deps(fake: ReturnType<typeof makeFake>, over: Partial<BridgeDeps> = {}): BridgeDeps & { logs: string[] } {
  const logs: string[] = [];
  return {
    gateway: fake.gateway,
    isMaster: () => false,
    linkedToOtherUser: () => false,
    limits: { maxTotal: 5, maxPerUser: 1, minEquity: 200 },
    timeouts: fast,
    log: (l, m) => logs.push(`${l}:${m}`),
    logs,
    ...over,
  } as any;
}

const input = { userId: 'user-AAA111', login: '81986889', password: 'S3cret!pw', server: 'Exness-MT5Real9' };

async function failure(p: Promise<unknown>): Promise<BrokerVerificationError> {
  try {
    await p;
  } catch (e: any) {
    assert.ok(e instanceof BrokerVerificationError, `expected BrokerVerificationError, got ${e?.name}: ${e?.message}`);
    return e;
  }
  assert.fail('expected a failure');
}

// ---------- the pipeline ----------

test('connects a new account and reports each stage in order', async () => {
  const f = makeFake();
  const stages: Stage[] = [];
  const r = await connectClient(deps(f), input, (s) => stages.push(s));
  assert.deepEqual(stages, ['checking', 'creating', 'deploying', 'syncing', 'verifying']);
  assert.equal(r.verified.equity, 520);
  assert.equal(r.resumed, false);
  assert.equal(r.account.id, 'acc-new');
  assert.equal(f.calls.create.length, 1);
  // the account name ties it to this user
  assert.equal(f.calls.create[0].name, 'CastimoFX Client user-AAA111 #81986889');
  assert.equal(f.calls.create[0].password, 'S3cret!pw');
});

test('resumes this user\'s own existing terminal without creating another', async () => {
  const f = makeFake({ existing: [{ id: 'acc-old', name: 'CastimoFX Client user-AAA111 #81986889', login: '81986889', server: 'Exness-MT5Real9' }] });
  const stages: Stage[] = [];
  const r = await connectClient(deps(f), input, (s) => stages.push(s));
  assert.equal(r.resumed, true);
  assert.equal(f.calls.create.length, 0);
  assert.ok(!stages.includes('creating'));
});

test('wrong password or login is a clear, non-retryable answer, and nothing is left behind', async () => {
  const f = makeFake({ createError: Object.assign(new Error('Authentication failed'), { details: { code: 'E_AUTH' } }) });
  const e = await failure(connectClient(deps(f), input));
  assert.equal(e.code, 'BROKER_AUTH_FAILED');
  assert.match(e.message, /81986889/);
  assert.equal(f.calls.remove.length, 0);
  assert.match(friendlyHint(e.code), /trading/i);
});

test('an unknown server name is retried once with the spelling MetaApi lists', async () => {
  const unknown = Object.assign(new Error('no .dat file for server'), {
    details: { code: 'E_SRV_NOT_FOUND', serversByBrokers: { Exness: ['Exness-MT5Real9', 'Exness-MT5Real10'] } },
  });
  const f = makeFake({ createErrors: [unknown] });
  const r = await connectClient(deps(f), { ...input, server: 'exness-mt5real9' });
  assert.equal(f.calls.create.length, 2);
  assert.equal(r.server, 'Exness-MT5Real9');
});

test('an unknown server with no match lists real servers and asks the client to copy the name', async () => {
  const unknown = Object.assign(new Error('no .dat file for server'), {
    details: { code: 'E_SRV_NOT_FOUND', serversByBrokers: { X: ['Other-Server-1'] } },
  });
  const f = makeFake({ createError: unknown });
  const e = await failure(connectClient(deps(f), { ...input, server: 'Totally-Wrong' }));
  assert.equal(e.code, 'BROKER_SERVER_NOT_FOUND');
  assert.match(e.message, /Other-Server-1/);
  assert.match(friendlyHint(e.code), /login screen/);
});

test('a create that is slow but really went through carries on with the terminal', async () => {
  const f = makeFake({ createdButSlow: true });
  const r = await connectClient(deps(f), input);
  assert.equal(r.account.id, 'acc-new');
  assert.ok(deps(f).logs !== undefined);
});

test('a create that is slow and did not go through is reported as slow, not as a wrong password', async () => {
  const f = makeFake({ createHangs: true });
  const e = await failure(connectClient(deps(f), input));
  assert.equal(e.code, 'BROKER_SLOW');
  assert.equal(e.ref, 'TIMEOUT_CREATING');
  assert.match(e.message, /press Connect again/i);
  assert.doesNotMatch(e.message, /password/i);
});

test('a slow deploy keeps the terminal, and the next attempt resumes and succeeds', async () => {
  const f = makeFake({ deployHangs: true });
  const e = await failure(connectClient(deps(f), input));
  assert.equal(e.code, 'BROKER_SLOW');
  assert.equal(e.ref, 'TIMEOUT_DEPLOYING');
  assert.equal(e.stage, 'deploying');
  assert.equal(f.calls.remove.length, 0, 'a still-starting terminal must not be deleted');
  assert.equal(f.accounts.length, 1);

  // terminal finished starting; the client presses Connect again
  const f2 = makeFake({ existing: f.accounts as any });
  const r = await connectClient(deps(f2), input);
  assert.equal(r.resumed, true);
  assert.equal(f2.calls.create.length, 0);
});

test('a slow sync and a slow account read are reported by stage', async () => {
  let e = await failure(connectClient(deps(makeFake({ syncHangs: true })), input));
  assert.equal(e.ref, 'TIMEOUT_SYNCING');
  e = await failure(connectClient(deps(makeFake({ infoHangs: true })), input));
  assert.equal(e.ref, 'TIMEOUT_VERIFYING');
});

test('the SDK\'s own TimeoutError is treated as slow too', async () => {
  const sdkTimeout = Object.assign(new Error('Timed out waiting for account to be deployed'), { name: 'TimeoutError' });
  const e = await failure(connectClient(deps(makeFake({ deployError: sdkTimeout })), input));
  assert.equal(e.code, 'BROKER_SLOW');
  assert.equal(e.ref, 'TIMEOUT_DEPLOYING');
});

test('below the minimum equity: refused with the exact figures, and the new terminal is removed', async () => {
  const f = makeFake({ info: { ...GOOD_INFO, equity: 150, balance: 150 } });
  const e = await failure(connectClient(deps(f), input));
  assert.equal(e.code, 'MIN_EQUITY');
  assert.match(e.message, /\$150\.00/);
  assert.match(e.message, /\$200\.00/);
  assert.deepEqual(f.calls.remove, ['acc-new']);
});

test('non-USD accounts are refused', async () => {
  const f = makeFake({ info: { ...GOOD_INFO, currency: 'EUR' } });
  const e = await failure(connectClient(deps(f), input));
  assert.equal(e.code, 'UNSUPPORTED_CURRENCY');
  assert.deepEqual(f.calls.remove, ['acc-new']);
});

test('an investor (read-only) login is refused and the terminal removed', async () => {
  const f = makeFake({ info: { ...GOOD_INFO, investorMode: true } });
  const e = await failure(connectClient(deps(f), input));
  assert.equal(e.code, 'TRADING_NOT_ALLOWED');
  assert.deepEqual(f.calls.remove, ['acc-new']);
});

test('the broker answering for a different login is refused', async () => {
  const f = makeFake({ loginOnAccount: '99999999' });
  const e = await failure(connectClient(deps(f), input));
  assert.equal(e.code, 'LOGIN_MISMATCH');
});

test('a broker answer with no balance figures is refused', async () => {
  const e = await failure(connectClient(deps(makeFake({ info: { ...GOOD_INFO, balance: undefined } })), input));
  assert.equal(e.code, 'BAD_BROKER_RESPONSE');
});

test('the platform master account can never be connected', async () => {
  const e = await failure(connectClient(deps(makeFake(), { isMaster: () => true }), input));
  assert.equal(e.code, 'IS_MASTER_ACCOUNT');
});

test('an account linked to another user (in memory) is refused before anything is created', async () => {
  const f = makeFake();
  const e = await failure(connectClient(deps(f, { linkedToOtherUser: () => true }), input));
  assert.equal(e.code, 'ALREADY_LINKED');
  assert.equal(f.calls.list, 0);
  assert.equal(f.calls.create.length, 0);
});

test('an account that exists in MetaApi for someone else is refused and never touched', async () => {
  const f = makeFake({ existing: [{ id: 'acc-x', name: 'CastimoFX Client someone-else #81986889', login: '81986889', server: 'Exness-MT5Real9' }] });
  const e = await failure(connectClient(deps(f), input));
  assert.equal(e.code, 'ALREADY_LINKED');
  assert.equal(f.calls.create.length, 0);
  assert.equal(f.calls.remove.length, 0);
});

test('one account per user: a second, different account is refused', async () => {
  const f = makeFake({ existing: [{ id: 'acc-a', name: 'CastimoFX Client user-AAA111 #11111111', login: '11111111', server: 'Exness-MT5Real9' }] });
  const e = await failure(connectClient(deps(f), input));
  assert.equal(e.code, 'CAPACITY');
  assert.match(e.message, /Disconnect/);
});

test('the platform-wide account limit stops new accounts but not resuming', async () => {
  const many = ['a', 'b', 'c'].map((u, i) => ({ id: `acc-${i}`, name: `CastimoFX Client ${u} #1000000${i}`, login: `1000000${i}`, server: 'S' }));
  const e = await failure(connectClient(deps(makeFake({ existing: many }), { limits: { maxTotal: 3, maxPerUser: 1, minEquity: 200 } }), input));
  assert.equal(e.code, 'CAPACITY');

  const mine = { id: 'acc-me', name: 'CastimoFX Client user-AAA111 #81986889', login: '81986889', server: 'Exness-MT5Real9' };
  const r = await connectClient(deps(makeFake({ existing: [...many, mine] }), { limits: { maxTotal: 3, maxPerUser: 1, minEquity: 200 } }), input);
  assert.equal(r.resumed, true);
});

test('typing mistakes are rejected before the broker is contacted', async () => {
  const f = makeFake();
  for (const bad of [
    { ...input, login: 'abc' },
    { ...input, login: '123' },
    { ...input, password: '' },
    { ...input, server: 'x' },
  ]) {
    const e = await failure(connectClient(deps(f), bad));
    assert.equal(e.code, 'BAD_INPUT');
  }
  assert.equal(f.calls.list, 0);
});

test('our own MetaApi token being refused is never blamed on the client, and is logged for the admin', async () => {
  const tokenError = Object.assign(new Error('Authorization token is invalid'), { status: 401 });
  const d = deps(makeFake({ listError: tokenError }));
  const e = await failure(connectClient(d, input));
  assert.equal(e.code, 'VERIFICATION_UNAVAILABLE');
  assert.doesNotMatch(e.message, /password|account number/i);
  assert.ok(d.logs.some((l) => l.startsWith('error:') && /refused our own/.test(l)));
});

test('unknown failures are calm and carry a reference, never the raw error', async () => {
  const e = await failure(connectClient(deps(makeFake({ connectError: new Error('socket hang up: secret internal detail') })), input));
  assert.equal(e.code, 'BROKER_UNREACHABLE');
  assert.doesNotMatch(e.message, /socket|secret internal/);
  assert.ok(e.ref);
});

test('translateBrokerError: rate limits and token errors are not password errors', () => {
  const c = { login: '1', server: 's' };
  assert.equal(translateBrokerError({ status: 429, message: 'Too many requests' }, c).code, 'BROKER_SLOW');
  assert.equal(translateBrokerError({ message: 'token expired' }, c).code, 'VERIFICATION_UNAVAILABLE');
  assert.equal(translateBrokerError({ details: { code: 'E_AUTH' }, message: 'x' }, c).code, 'BROKER_AUTH_FAILED');
});

// ---------- connect jobs ----------

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('a job reports its stage while running and holds the result when done', async () => {
  const jobs = new ConnectJobs<{ ok: boolean }>();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { job, started } = jobs.start('u1', { login: '1', server: 's' }, async (report) => {
    report('creating');
    await gate;
    report('verifying');
    return { ok: true };
  });
  assert.equal(started, true);
  assert.equal(job.status, 'running');
  await tick();
  assert.equal(jobs.get('u1')!.stage, 'creating');
  assert.equal(jobs.get('u1')!.percent, 25);
  release();
  await tick();
  const done = jobs.get('u1')!;
  assert.equal(done.status, 'done');
  assert.deepEqual(done.result, { ok: true });
  assert.equal(done.percent, 100);
});

test('pressing Connect twice never starts a second connection', async () => {
  const jobs = new ConnectJobs();
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const run = async () => { runs++; await gate; return {}; };
  const a = jobs.start('u1', { login: '1', server: 's' }, run);
  const b = jobs.start('u1', { login: '1', server: 's' }, run);
  assert.equal(a.started, true);
  assert.equal(b.started, false);
  assert.equal(a.job.jobId, b.job.jobId);
  assert.equal(runs, 1);
  release();
  await tick();
});

test('a failed job explains what happened and what to do, and can be retried', async () => {
  const jobs = new ConnectJobs();
  jobs.start('u1', { login: '1', server: 's' }, async () => {
    throw new BrokerVerificationError('BROKER_SLOW', 'Slow.');
  });
  await tick();
  const j = jobs.get('u1')!;
  assert.equal(j.status, 'failed');
  assert.equal(j.error!.code, 'BROKER_SLOW');
  assert.equal(j.error!.retryable, true);
  assert.match(j.error!.hint, /press Connect again/i);

  // after a failure a new attempt is allowed
  const again = jobs.start('u1', { login: '1', server: 's' }, async () => ({ fine: true }));
  assert.equal(again.started, true);
  await tick();
  assert.equal(jobs.get('u1')!.status, 'done');
});

test('a wrong-password failure is final (not retryable)', async () => {
  const jobs = new ConnectJobs();
  jobs.start('u1', { login: '1', server: 's' }, async () => {
    throw new BrokerVerificationError('BROKER_AUTH_FAILED', 'Rejected.');
  });
  await tick();
  assert.equal(jobs.get('u1')!.error!.retryable, false);
});

test('unexpected crashes show a calm message and a reference, not the internal error', async () => {
  const jobs = new ConnectJobs();
  jobs.start('u1', { login: '1', server: 's' }, async () => {
    throw new TypeError('Cannot read properties of undefined (reading secretThing)');
  });
  await tick();
  const j = jobs.get('u1')!;
  assert.equal(j.error!.code, 'UNKNOWN');
  assert.doesNotMatch(j.error!.message, /secretThing|properties/);
  assert.equal(j.error!.ref, 'TypeError');
});

test('the admin failure log keeps the technical reason but scrubs passwords and masks the user', async () => {
  const jobs = new ConnectJobs();
  jobs.start('user-AAA111', { login: '81986889', server: 'Exness-MT5Real9', secrets: ['S3cret!pw'] }, async () => {
    throw new Error('request failed for password S3cret!pw at gateway');
  });
  await tick();
  const [f] = jobs.recentFailures();
  assert.ok(f);
  assert.doesNotMatch(f.raw, /S3cret!pw/);
  assert.match(f.raw, /\*\*\*/);
  assert.equal(f.user, 'use…111');
  assert.equal(f.login, '81986889');
  // and the password is never in what the browser can read
  assert.doesNotMatch(JSON.stringify(jobs.get('user-AAA111')), /S3cret!pw/);
});

test('two users cannot connect the same broker account at the same time', async () => {
  const jobs = new ConnectJobs();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  jobs.start('u1', { login: '81986889', server: 'Exness-MT5Real9' }, async () => { await gate; return {}; });
  assert.throws(
    () => jobs.start('u2', { login: '81986889', server: 'exness-mt5real9' }, async () => ({})),
    (e: any) => e instanceof BrokerVerificationError && e.code === 'ALREADY_LINKED'
  );
  release();
  await tick();
});

test('finished jobs are forgotten after a while, running ones never', async () => {
  let now = 1_000_000;
  const jobs = new ConnectJobs({ now: () => now, keepMs: 60_000 });
  jobs.start('u1', { login: '1', server: 's' }, async () => ({}));
  await tick();
  assert.equal(jobs.get('u1')!.status, 'done');
  now += 61_000;
  assert.equal(jobs.get('u1'), null);
});

test('a connection that never finishes is stopped by the overall time limit', async () => {
  const jobs = new ConnectJobs({ maxRunMs: 30 });
  jobs.start('u1', { login: '1', server: 's' }, () => new Promise(() => {}));
  await tick(80);
  const j = jobs.get('u1')!;
  assert.equal(j.status, 'failed');
  assert.equal(j.error!.code, 'BROKER_SLOW');
});

test('end to end through a job: slow first try, quick second try', async () => {
  const jobs = new ConnectJobs();
  const f = makeFake({ deployHangs: true });
  jobs.start('user-AAA111', { login: input.login, server: input.server }, (report) => connectClient(deps(f), input, report));
  await tick(150);
  assert.equal(jobs.get('user-AAA111')!.error!.ref, 'TIMEOUT_DEPLOYING');

  const f2 = makeFake({ existing: f.accounts as any });
  jobs.start('user-AAA111', { login: input.login, server: input.server }, (report) => connectClient(deps(f2), input, report));
  await tick(50);
  const j = jobs.get('user-AAA111')!;
  assert.equal(j.status, 'done');
  assert.equal((j.result as any).resumed, true);
});

// ---------- the MetaApi adapter ----------

test('the MetaApi adapter forwards calls and exposes the underlying objects', async () => {
  const removed: string[] = [];
  const created: any[] = [];
  const entity = (state: string) => ({
    id: 'a1', name: 'CastimoFX Client u #1', login: '1', server: 'S', state,
    waited: 0,
    async waitDeployed(sec: number, ms: number) { (this as any).waited = [sec, ms]; },
    getRPCConnection() { return { connect: async () => {}, waitSynchronized: async () => {}, getAccountInformation: async () => GOOD_INFO }; },
    async remove() { removed.push('a1'); },
  });
  const e1 = entity('UNDEPLOYED');
  const e2 = entity('DEPLOYED');
  const api = {
    metatraderAccountApi: {
      getAccountsWithInfiniteScrollPagination: async () => [{ id: 'a1', name: 'n', login: '1', server: 'S', extra: 'dropped' }],
      getAccount: async (id: string) => (id === 'dep' ? e2 : e1),
      createAccount: async (p: any) => { created.push(p); return { id: 'new' }; },
    },
  };
  const gw = metaApiGateway(api as any);
  assert.deepEqual(await gw.listAccounts(), [{ id: 'a1', name: 'n', login: '1', server: 'S' }]);
  assert.deepEqual(await gw.createAccount({ name: 'n', login: '1', password: 'p', server: 'S', platform: 'mt5', magic: 5, region: 'london', reliability: 'high' }), { id: 'new' });
  assert.equal(created[0].type, 'cloud-g2');
  assert.equal(created[0].manualTrades, false);

  const h1 = await gw.getAccount('a1');
  await h1.waitDeployed(90);
  assert.deepEqual((e1 as any).waited, [90, 1000]);
  const h2 = await gw.getAccount('dep');
  await h2.waitDeployed(90);
  assert.equal((e2 as any).waited, 0, 'an already deployed terminal is not waited on');
  assert.equal(h1.raw, e1);
  assert.ok(h1.rpc().raw);
  assert.equal((await h1.rpc().getAccountInformation()).broker, 'Exness Technologies Ltd');
  await gw.removeAccount('a1');
  assert.deepEqual(removed, ['a1']);
});

test('StageTimeoutError carries the stage', () => {
  const e = new StageTimeoutError('syncing');
  assert.equal(e.stage, 'syncing');
  assert.equal(e.name, 'StageTimeoutError');
});
