import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectJobs,
  HandedOff,
  ProvisionGate,
  STAGE_INFO,
  StageTimeoutError,
  friendlyHint,
  pendingFor,
} from '../src/backend/clientBridge.ts';
import { BrokerVerificationError } from '../src/backend/brokerVerification.ts';

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
  assert.equal(jobs.get('u1')!.percent, STAGE_INFO.creating.percent);
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

test('a job whose connection carries on in the background shows a calm state, not a failure', async () => {
  const jobs = new ConnectJobs();
  jobs.start('u1', { login: '1', server: 's' }, async (report) => {
    report('deploying');
    throw new HandedOff('still going', { stage: 'deploying', ref: 'TIMEOUT_DEPLOYING', detail: 'terminal state=DEPLOYED, broker connection=DISCONNECTED' });
  });
  await tick();
  const j = jobs.get('u1')!;
  assert.equal(j.status, 'background');
  assert.equal(j.stage, 'background');
  assert.equal(j.percent, STAGE_INFO.deploying.percent, 'keeps the progress it had reached');
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

test('a client who reloads while connecting is told so; the server\'s own report wins; finished jobs add nothing', () => {
  const watching = { kind: 'working' as const, label: 'Waiting for your broker to accept the login…', login: '1', server: 'S' };
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

test('what the client reads while connecting is true: no stage claims a login was confirmed before it was', () => {
  // the account is being ADDED in this step; the broker has not been asked anything yet
  assert.match(STAGE_INFO.creating.label, /adding your account/i);
  assert.doesNotMatch(STAGE_INFO.creating.label, /confirm/i);
  // waiting for the login is said as what it is
  assert.match(STAGE_INFO.syncing.label, /logging in/i);
  // the bar never goes backwards from one step to the next
  const order = ['queued', 'checking', 'creating', 'syncing', 'verifying', 'done'] as const;
  for (let i = 1; i < order.length; i++) assert.ok(STAGE_INFO[order[i]].percent > STAGE_INFO[order[i - 1]].percent, `${order[i]} is further along than ${order[i - 1]}`);
});
