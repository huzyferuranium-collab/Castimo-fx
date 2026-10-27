import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectClient,
  ConnectJobs,
  HandedOff,
  ProvisionGate,
  StageTimeoutError,
  friendlyHint,
  pendingFor,
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
  infoFailsFirst?: number; // the broker is not ready for the first N direct asks
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
  let made = 0;
  let infoAsks = 0;

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
      const id = made++ === 0 ? 'acc-new' : `acc-new-${made}`;
      if (b.createdButSlow) {
        accounts.push({ id, name: p.name, login: p.login, server: p.server });
        return never();
      }
      if (b.createHangs) return never();
      accounts.push({ id, name: p.name, login: p.login, server: p.server });
      return { id };
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
        async snapshot() {
          return { state: 'DEPLOYED', connectionStatus: 'DISCONNECTED' };
        },
        async deploy() {},
        async redeploy() {},
        rpc: () => ({
          async connect() {
            if (b.connectError) throw b.connectError;
          },
          async waitSynchronized() {
            if (b.syncHangs) return never();
          },
          async getAccountInformation() {
            if (b.infoHangs) return never();
            if (b.infoFailsFirst && infoAsks++ < b.infoFailsFirst) throw new Error('Terminal is not connected to broker yet');
            return b.info === undefined ? { ...GOOD_INFO, login: Number(a.login) } : b.info;
          },
          raw: { rpc: true },
        }),
        raw: { entity: id },
      };
    },
    async findAccount(id) {
      return accounts.some((x) => x.id === id) ? gateway.getAccount(id) : null;
    },
    async removeAccount(id) {
      calls.remove.push(id);
      const i = accounts.findIndex((x) => x.id === id);
      if (i >= 0) accounts.splice(i, 1);
    },
  };
  return { gateway, calls, accounts };
}

const fast = { listSeconds: 0.2, createSeconds: 0.05, deploySeconds: 0.05, connectSeconds: 0.05, syncSeconds: 0.05, infoSeconds: 0.05, probeEveryMs: 5 };

function deps(fake: ReturnType<typeof makeFake>, over: Partial<BridgeDeps> = {}): BridgeDeps & { logs: string[] } {
  const logs: string[] = [];
  return {
    gateway: fake.gateway,
    isMaster: () => false,
    linkedToOtherUser: () => false,
    limits: { maxTotal: 5, maxPerUser: 1, minEquity: 200 },
    timeouts: fast,
    log: (l: string, m: string) => logs.push(`${l}:${m}`),
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
  let e = await failure(connectClient(deps(makeFake({ syncHangs: true, infoHangs: true })), input));
  assert.equal(e.ref, 'TIMEOUT_SYNCING');
  e = await failure(connectClient(deps(makeFake({ infoHangs: true })), input));
  assert.equal(e.ref, 'TIMEOUT_VERIFYING');
});

test('the connection does not wait for a lagging sync signal: it finishes as soon as the broker answers', async () => {
  const d = deps(makeFake({ syncHangs: true }), { timeouts: { ...fast, syncSeconds: 2, infoSeconds: 1 } });
  const t0 = Date.now();
  const r = await connectClient(d, input);
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0}ms`);
  assert.equal(r.verified.equity, 520);
});

test('a broker that is not ready yet is asked again until it answers', async () => {
  const d = deps(makeFake({ syncHangs: true, infoFailsFirst: 3 }), { timeouts: { ...fast, syncSeconds: 1, infoSeconds: 0.5 } });
  const r = await connectClient(d, input);
  assert.equal(r.verified.equity, 520);
});

test('when a terminal is slow, the admin gets MetaApi\'s own status in the log, the client does not', async () => {
  const d = deps(makeFake({ syncHangs: true, infoHangs: true }));
  const e = await failure(connectClient(d, input));
  assert.match(e.detail!, /state=DEPLOYED/);
  assert.match(e.detail!, /connection=DISCONNECTED/);
  assert.doesNotMatch(e.message, /DISCONNECTED/);
  assert.ok(d.logs.some((l) => /DISCONNECTED/.test(l)));

  const jobs = new ConnectJobs();
  jobs.start('u9', { login: '1', server: 's' }, async () => { throw e; });
  await tick();
  assert.match(jobs.recentFailures()[0].raw, /connection=DISCONNECTED/);
});

test('if the sync signal lags but the broker answers directly, the connection still succeeds', async () => {
  const d = deps(makeFake({ syncHangs: true }));
  const r = await connectClient(d, input);
  assert.equal(r.verified.equity, 520);
  assert.ok(d.logs.some((l) => /Broker answered directly/.test(l)));
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

const OLD = { id: 'acc-a', name: 'CastimoFX Client user-AAA111 #11111111', login: '11111111', server: 'Exness-MT5Real9' };

test('an unfinished terminal from an earlier try is cleared automatically, so the client is never stuck', async () => {
  const f = makeFake({ existing: [OLD] });
  const r = await connectClient(deps(f), input);
  assert.deepEqual(f.calls.remove, ['acc-a']);
  assert.equal(r.account.id, 'acc-new');
  assert.equal(f.calls.create.length, 1);
});

test('a truly connected client is protected: a different account gets a kind explanation, nothing is touched', async () => {
  const f = makeFake({ existing: [OLD] });
  const e = await failure(connectClient(deps(f, { activeAccountOf: () => ({ login: '11111111', server: 'Exness-MT5Real9' }) }), input));
  assert.equal(e.code, 'ALREADY_CONNECTED');
  assert.match(e.message, /#11111111/);
  assert.match(e.message, /keeps copying/);
  assert.match(friendlyHint(e.code), /Profile/);
  assert.equal(f.calls.remove.length, 0);
  assert.equal(f.calls.create.length, 0);
  assert.equal(f.calls.list, 0, 'refused before the broker or MetaApi is contacted');
});

test('a client with billing history is protected even if their link is not loaded yet', async () => {
  const f = makeFake({ existing: [OLD] });
  const e = await failure(connectClient(deps(f, { hasBillingHistory: async () => true }), input));
  assert.equal(e.code, 'ALREADY_CONNECTED');
  assert.equal(f.calls.remove.length, 0, 'their terminal must never be cleaned up');
});

test('if the billing check itself fails, the terminal is kept (safe side)', async () => {
  const f = makeFake({ existing: [OLD] });
  const e = await failure(connectClient(deps(f, { hasBillingHistory: async () => { throw new Error('db down'); } }), input));
  assert.equal(e.code, 'ALREADY_CONNECTED');
  assert.equal(f.calls.remove.length, 0);
});

test('the same account while already connected is not refused: it resumes', async () => {
  const mine = { id: 'acc-me', name: 'CastimoFX Client user-AAA111 #81986889', login: '81986889', server: 'Exness-MT5Real9' };
  const f = makeFake({ existing: [mine] });
  const r = await connectClient(deps(f, { activeAccountOf: () => ({ login: '81986889', server: 'Exness-MT5Real9' }) }), input);
  assert.equal(r.resumed, true);
});

test('if an unfinished terminal cannot be cleared, the client is told kindly to retry', async () => {
  const f = makeFake({ existing: [OLD] });
  f.gateway.removeAccount = async () => { throw new Error('MetaApi busy'); };
  const e = await failure(connectClient(deps(f), input));
  assert.equal(e.code, 'CAPACITY');
  assert.match(e.message, /try again in a minute/i);
});

test('messages stay calm and helpful: no shouting, no blame', async () => {
  const msgs: string[] = [];
  for (const bad of [{ ...input, login: 'abc' }, { ...input, password: '' }, { ...input, server: 'x' }]) {
    msgs.push((await failure(connectClient(deps(makeFake()), bad))).message);
  }
  msgs.push((await failure(connectClient(deps(makeFake({ info: { ...GOOD_INFO, equity: 150, balance: 150 } })), input))).message);
  msgs.push((await failure(connectClient(deps(makeFake({ createError: Object.assign(new Error('Authentication failed'), { details: { code: 'E_AUTH' } }) })), input))).message);
  for (const m of msgs) {
    assert.match(m, /please/i, m);
    assert.doesNotMatch(m, /[A-Z]{6,}|!{2,}|\binvalid\b|\bwrong\b|\bforbidden\b|\bdenied\b/, m);
  }
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
    connectionStatus: 'DISCONNECTED',
    deployed: 0,
    async deploy() { (this as any).deployed++; },
    async reload() {},
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
  assert.equal((e1 as any).deployed, 1, 'an undeployed terminal is started before waiting');
  assert.deepEqual(await h1.snapshot!(), { state: 'UNDEPLOYED', connectionStatus: 'DISCONNECTED' });
  const h2 = await gw.getAccount('dep');
  await h2.waitDeployed(90);
  assert.equal((e2 as any).waited, 0, 'an already deployed terminal is not waited on');
  assert.equal((e2 as any).deployed, 0);
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

// ---------- the gate: a queue for busy moments, and claims on the limited account slots ----------

test('the gate lets only N through at once and hands slots over in order', async () => {
  const gate = new ProvisionGate(2);
  const order: string[] = [];
  const releases: Array<() => void> = [];
  let running = 0;
  let peak = 0;
  const job = (name: string) =>
    gate.run(
      async () => {
        running++;
        peak = Math.max(peak, running);
        order.push(`start ${name}`);
        await new Promise<void>((r) => releases.push(r));
        running--;
        order.push(`end ${name}`);
      },
      () => order.push(`wait ${name}`)
    );
  const all = ['a', 'b', 'c', 'd'].map(job);
  await tick();
  assert.deepEqual(order, ['start a', 'start b', 'wait c', 'wait d']);
  releases[0]();
  await tick();
  assert.deepEqual(order.slice(4), ['end a', 'start c']);
  releases[1]();
  await tick();
  assert.deepEqual(order.slice(6), ['end b', 'start d']);
  releases[2]();
  releases[3]();
  await Promise.all(all);
  assert.equal(peak, 2);
});

test('a task that fails still hands its slot on; 0 means no limit', async () => {
  const gate = new ProvisionGate(1);
  const p1 = gate.run(async () => {
    throw new Error('boom');
  });
  const p2 = gate.run(async () => 'ok');
  await assert.rejects(p1, /boom/);
  assert.equal(await p2, 'ok');

  const open = new ProvisionGate(0);
  let waited = 0;
  await Promise.all([1, 2, 3, 4, 5].map(() => open.run(async () => tick(2), () => waited++)));
  assert.equal(waited, 0);
});

test('capacity claims count other users until their terminal shows in the list', () => {
  const gate = new ProvisionGate(3);
  gate.reserve('u1');
  gate.reserve('u2');
  assert.equal(gate.pendingClaimsOf('u1', []), 1, "only the other user's claim counts");
  gate.attach('u2', 'acc-2');
  assert.equal(gate.pendingClaimsOf('u1', []), 1, 'not listed yet, still counts');
  assert.equal(gate.pendingClaimsOf('u1', [{ id: 'acc-2' }]), 0, 'listed: counted by the list, not twice');
  gate.release('u2');
  assert.equal(gate.pendingClaimsOf('u1', []), 0);
});

function slowCreate(f: ReturnType<typeof makeFake>, ms: number) {
  const original = f.gateway.createAccount;
  f.gateway.createAccount = async (p) => {
    await tick(ms);
    return original(p);
  };
}

const OTHER = { userId: 'user-BBB222', login: '22222222', password: 'Other!pw1', server: 'Exness-MT5Real9' };
const roomy = { ...fast, createSeconds: 2, deploySeconds: 2, connectSeconds: 2, syncSeconds: 2, infoSeconds: 2 };

test('two clients racing for the last account slot: the second is told kindly, not given a free account', async () => {
  const f = makeFake();
  slowCreate(f, 40);
  const d = deps(f, { gate: new ProvisionGate(3), limits: { maxTotal: 1, maxPerUser: 1, minEquity: 200 }, timeouts: roomy });
  const first = connectClient(d, input);
  await tick(10);
  const e = await failure(connectClient(d, OTHER));
  assert.equal(e.code, 'CAPACITY');
  await first;
  assert.equal(f.calls.create.length, 1, 'only one account was ever created');
  // once the first exists, MetaApi's own list holds the slot
  assert.equal((await failure(connectClient(d, OTHER))).code, 'CAPACITY');
  assert.equal(f.calls.create.length, 1);
});

test('a failed attempt gives its slot back', async () => {
  const gate = new ProvisionGate(3);
  const f = makeFake({ createError: Object.assign(new Error('Authentication failed'), { details: { code: 'E_AUTH' } }) });
  await failure(connectClient(deps(f, { gate, limits: { maxTotal: 1, maxPerUser: 1, minEquity: 200 } }), input));
  assert.equal(gate.pendingClaimsOf('someone-else', []), 0);
});

test('a connection that has to wait its turn says so, then carries on', async () => {
  const f = makeFake();
  slowCreate(f, 30);
  const d = deps(f, { gate: new ProvisionGate(1), timeouts: roomy });
  const a = connectClient(d, input);
  await tick(5);
  const stages: Stage[] = [];
  const b = connectClient(d, OTHER, (s) => stages.push(s));
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(stages, ['checking', 'queued', 'creating', 'deploying', 'syncing', 'verifying']);
  assert.equal(ra.account.id, 'acc-new');
  assert.equal(rb.account.id, 'acc-new-2');
});

test('after waiting in line the limit is checked again against a fresh list', async () => {
  const f = makeFake();
  slowCreate(f, 40);
  const d = deps(f, { gate: new ProvisionGate(1), limits: { maxTotal: 2, maxPerUser: 1, minEquity: 200 }, timeouts: roomy });
  const a = connectClient(d, input);
  await tick(5);
  const b = connectClient(d, OTHER); // passes the first check: 0 listed + 1 claim < 2, then waits in line
  await tick(5);
  // someone else's account appears in MetaApi while B waits
  f.accounts.push({ id: 'x', name: 'CastimoFX Client user-CCC333 #55555555', login: '55555555', server: 'Exness-MT5Real9' });
  await a;
  const e = await failure(b);
  assert.equal(e.code, 'CAPACITY');
  assert.equal(f.calls.create.length, 1);
});

test('a terminal cleared to make room does not count against the limit', async () => {
  const removed: string[] = [];
  const f = makeFake({ existing: [OLD] });
  const r = await connectClient(
    deps(f, { limits: { maxTotal: 1, maxPerUser: 1, minEquity: 200 }, onTerminalRemoved: (x) => { removed.push(x.accountId); } }),
    input
  );
  assert.deepEqual(removed, ['acc-a']);
  assert.equal(r.account.id, 'acc-new');
});

// ---------- hooks, reconnects and kept terminals ----------

test('the terminal hook fires for new and resumed terminals, and a failing hook never fails the connection', async () => {
  const events: any[] = [];
  const f = makeFake();
  const r = await connectClient(
    deps(f, { onTerminalCreated: (e) => { events.push(e); throw new Error('store down'); } }),
    input
  );
  assert.equal(r.account.id, 'acc-new');
  assert.deepEqual(events, [
    { userId: 'user-AAA111', accountId: 'acc-new', login: '81986889', server: 'Exness-MT5Real9', resumed: false, previouslyVerified: false },
  ]);

  const mine = { id: 'acc-me', name: 'CastimoFX Client user-AAA111 #81986889', login: '81986889', server: 'Exness-MT5Real9' };
  const f2 = makeFake({ existing: [mine] });
  const r2 = await connectClient(
    deps(f2, { wasVerified: async () => true, onTerminalCreated: (e) => { events.push(e); } }),
    input
  );
  assert.equal(r2.resumed, true);
  assert.equal(r2.previouslyVerified, true);
  assert.equal(events[1].resumed, true);
  assert.equal(events[1].previouslyVerified, true);
  assert.equal(events[1].accountId, 'acc-me');
});

test('a client verified on this terminal before is reconnected even below the minimum equity; a new one is not', async () => {
  const mine = { id: 'acc-me', name: 'CastimoFX Client user-AAA111 #81986889', login: '81986889', server: 'Exness-MT5Real9' };
  const low = { ...GOOD_INFO, equity: 120, balance: 120 };

  const f1 = makeFake({ existing: [mine], info: low });
  const e = await failure(connectClient(deps(f1), input));
  assert.equal(e.code, 'MIN_EQUITY');
  assert.equal(e.accountId, undefined, 'a final refusal names no kept terminal');

  const f2 = makeFake({ existing: [mine], info: low });
  const r = await connectClient(deps(f2, { wasVerified: async (u, id) => u === 'user-AAA111' && id === 'acc-me' }), input);
  assert.equal(r.previouslyVerified, true);
  assert.equal(r.verified.equity, 120);

  // if the lookup itself fails, an explicit connect stays on the strict side
  const f3 = makeFake({ existing: [mine], info: low });
  const e3 = await failure(connectClient(deps(f3, { wasVerified: async () => { throw new Error('db down'); } }), input));
  assert.equal(e3.code, 'MIN_EQUITY');

  // even a reconnect must still pass the broker's own checks (here: investor password)
  const f4 = makeFake({ existing: [mine], info: { ...GOOD_INFO, investorMode: true } });
  const e4 = await failure(connectClient(deps(f4, { wasVerified: async () => true }), input));
  assert.equal(e4.code, 'TRADING_NOT_ALLOWED');
});

test('a slow failure keeps the terminal and names it, so it can finish in the background', async () => {
  const f = makeFake({ deployHangs: true });
  const e = await failure(connectClient(deps(f), input));
  assert.equal(e.code, 'BROKER_SLOW');
  assert.equal(e.accountId, 'acc-new');
  assert.equal(f.calls.remove.length, 0);

  // a resumed terminal is named too
  const mine = { id: 'acc-me', name: 'CastimoFX Client user-AAA111 #81986889', login: '81986889', server: 'Exness-MT5Real9' };
  const f2 = makeFake({ existing: [mine], syncHangs: true, infoHangs: true });
  const e2 = await failure(connectClient(deps(f2), input));
  assert.equal(e2.accountId, 'acc-me');
});

test('a final refusal removes the new terminal, tells the hook, and names none', async () => {
  const removed: string[] = [];
  const f = makeFake({ info: { ...GOOD_INFO, equity: 50, balance: 50 } });
  const e = await failure(connectClient(deps(f, { onTerminalRemoved: (x) => { removed.push(x.accountId); } }), input));
  assert.equal(e.code, 'MIN_EQUITY');
  assert.equal(e.accountId, undefined);
  assert.deepEqual(removed, ['acc-new']);
  assert.deepEqual(f.calls.remove, ['acc-new']);
});

test('translateBrokerError: broker settings still being detected is a wait, not a wrong password', () => {
  const e = translateBrokerError(
    Object.assign(new Error('Failed to detect broker server time zone, retry later'), { details: { code: 'E_SERVER_TIMEZONE' } }),
    { login: '1', server: 'S' }
  );
  assert.equal(e.code, 'BROKER_SLOW');
  assert.equal(e.ref, 'BROKER_SETTINGS_DETECTION');
  assert.doesNotMatch(e.message, /password/i);
});

// ---------- jobs that carry on in the background ----------

test('a job whose terminal carries on in the background shows a calm state, not a failure', async () => {
  const jobs = new ConnectJobs();
  jobs.start('u1', { login: '1', server: 's' }, async (report) => {
    report('deploying');
    throw new HandedOff('still going', { stage: 'deploying', ref: 'TIMEOUT_DEPLOYING', detail: 'terminal state=DEPLOYED, broker connection=DISCONNECTED' });
  });
  await tick();
  const j = jobs.get('u1')!;
  assert.equal(j.status, 'background');
  assert.equal(j.stage, 'background');
  assert.equal(j.percent, 50, 'keeps the progress it had reached');
  assert.match(j.message!, /do not need to wait/i);
  assert.equal(j.error, undefined);
  const [f] = jobs.recentFailures();
  assert.equal(f.background, true);
  assert.equal(f.code, 'BACKGROUND');
  assert.equal(f.ref, 'TIMEOUT_DEPLOYING');
  assert.match(f.raw, /DISCONNECTED/);
  // and pressing Connect again is allowed
  assert.equal(jobs.start('u1', { login: '1', server: 's' }, async () => ({})).started, true);
});

test('at the overall time limit a job that can carry on goes to the background; otherwise it fails', async () => {
  const jobs = new ConnectJobs({ maxRunMs: 20, canContinueInBackground: (u) => u === 'u1' });
  jobs.start('u1', { login: '1', server: 's' }, () => new Promise(() => {}));
  jobs.start('u2', { login: '2', server: 's' }, () => new Promise(() => {}));
  await tick(60);
  assert.equal(jobs.get('u1')!.status, 'background');
  assert.equal(jobs.get('u2')!.status, 'failed');
  assert.equal(jobs.get('u2')!.error!.code, 'BROKER_SLOW');
});

test('a late success after the time limit still turns the job green', async () => {
  const jobs = new ConnectJobs({ maxRunMs: 20 });
  let finish!: (v: any) => void;
  jobs.start('u1', { login: '1', server: 's' }, () => new Promise((r) => (finish = r)));
  await tick(60);
  assert.equal(jobs.get('u1')!.status, 'failed');
  finish({ fine: true });
  await tick();
  const j = jobs.get('u1')!;
  assert.equal(j.status, 'done');
  assert.equal(j.error, undefined);
  assert.deepEqual(j.result, { fine: true });
});

test('a late failure after the time limit changes nothing', async () => {
  const jobs = new ConnectJobs({ maxRunMs: 20, canContinueInBackground: () => true });
  let fail!: (e: any) => void;
  jobs.start('u1', { login: '1', server: 's' }, () => new Promise((_, rej) => (fail = rej)));
  await tick(60);
  assert.equal(jobs.get('u1')!.status, 'background');
  fail(new BrokerVerificationError('BROKER_AUTH_FAILED', 'Rejected.'));
  await tick();
  assert.equal(jobs.get('u1')!.status, 'background');
});

test('the admin sees how long each step took', async () => {
  let now = 1_000_000;
  const jobs = new ConnectJobs({ now: () => now });
  jobs.start('user-AAA111', { login: '81986889', server: 'S' }, async (report) => {
    report('checking');
    now += 2000;
    report('creating');
    now += 10_000;
    report('deploying');
    now += 30_000;
    return {};
  });
  await tick();
  const [s] = jobs.recentSuccesses();
  assert.equal(s.totalSeconds, 42);
  assert.deepEqual(s.timings, { queued: 0, checking: 2, creating: 10, deploying: 30 });
  assert.equal(s.user, 'use…111');
  assert.equal(s.login, '81986889');
});

test('failures also carry the step timings, so the slow step is visible', async () => {
  let now = 5_000_000;
  const jobs = new ConnectJobs({ now: () => now });
  jobs.start('user-AAA111', { login: '1', server: 'S' }, async (report) => {
    report('syncing');
    now += 90_000;
    throw new BrokerVerificationError('BROKER_SLOW', 'Slow.');
  });
  await tick();
  const [f] = jobs.recentFailures();
  assert.equal(f.timings!.syncing, 90);
});

// ---------- the MetaApi adapter, second part ----------

test('the MetaApi adapter lists terminal status, finds missing terminals, restarts, and tolerates removing what is already gone', async () => {
  const calls: string[] = [];
  const notFound = Object.assign(new Error('Trading account gone not found'), { name: 'NotFoundError', status: 404 });
  const entity = {
    id: 'a1', name: 'n', login: '1', server: 'S', state: 'DEPLOYED', connectionStatus: 'DISCONNECTED',
    async deploy() { calls.push('deploy'); },
    async redeploy() { calls.push('redeploy'); },
    async remove() { calls.push('remove'); },
    async reload() {},
    getRPCConnection() {
      return { connect: async () => {}, waitSynchronized: async () => {}, getAccountInformation: async () => GOOD_INFO, close: async () => { calls.push('close'); } };
    },
  };
  const api = {
    metatraderAccountApi: {
      getAccountsWithInfiniteScrollPagination: async () => [{ id: 'a1', name: 'n', login: '1', server: 'S', state: 'DEPLOYED', connectionStatus: 'DISCONNECTED' }],
      getAccount: async (id: string) => {
        if (id === 'gone') throw notFound;
        if (id === 'broken') throw Object.assign(new Error('boom'), { status: 500 });
        return entity;
      },
      createAccount: async () => ({ id: 'x' }),
    },
  };
  const gw = metaApiGateway(api as any);
  assert.deepEqual(await gw.listAccounts(), [{ id: 'a1', name: 'n', login: '1', server: 'S', state: 'DEPLOYED', connectionStatus: 'DISCONNECTED' }]);
  assert.equal(await gw.findAccount('gone'), null);
  await assert.rejects(gw.findAccount('broken'), /boom/, 'a failing lookup is not the same as "gone"');
  const h = (await gw.findAccount('a1'))!;
  assert.equal(h.state, 'DEPLOYED');
  assert.equal(h.connectionStatus, 'DISCONNECTED');
  await h.redeploy();
  await h.deploy();
  await h.rpc().close!();
  await gw.removeAccount('gone');
  await assert.rejects(gw.removeAccount('broken'), /boom/);
  await gw.removeAccount('a1');
  assert.deepEqual(calls, ['redeploy', 'deploy', 'close', 'remove']);
});

test('a client who reloads while connecting is told so; the supervisor\'s report wins; finished jobs add nothing', () => {
  const watching = { kind: 'working' as const, label: 'Waiting for your broker to accept the terminal…', login: '1', server: 'S' };
  // the supervisor already looks after the terminal: its report is used as it is
  assert.equal(pendingFor(watching, { status: 'running', label: 'Starting…' }), watching);
  // the connection is still running in the foreground and no terminal is remembered yet
  assert.deepEqual(pendingFor(null, { status: 'running', label: 'Checking your details…' }), { kind: 'working', label: 'Checking your details…' });
  assert.deepEqual(pendingFor(undefined, { status: 'running', label: 'Starting…' }), { kind: 'working', label: 'Starting…' });
  // nothing to say once a job is over (the supervisor, not the job, speaks for background and failed ones)
  for (const status of ['done', 'failed', 'background'] as const) {
    assert.equal(pendingFor(null, { status, label: 'x' }), null);
  }
  assert.equal(pendingFor(null, null), null);
  assert.equal(pendingFor(undefined, undefined), null);
  // a remembered failure is still reported even if an old job is gone
  const failed = { kind: 'failed' as const, label: 'Could not connect' };
  assert.equal(pendingFor(failed, null), failed);
});
