import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createJobsRouter, cronAuthorized, cronSecret, usesExternalScheduler, CRON_SECRET_HEADER } from '../src/backend/scheduledJobs.ts';

const SECRET = 'a-very-long-scheduler-secret-0123456789';

async function serve(router: express.Router): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use('/jobs', router);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/jobs`, close: () => new Promise((r) => server.close(() => r())) };
}

const call = (url: string, secret?: string) =>
  fetch(url, { method: 'POST', headers: secret === undefined ? {} : { [CRON_SECRET_HEADER]: secret } });

test('the external scheduler is used only when SCHEDULED_JOBS=external', () => {
  assert.equal(usesExternalScheduler({ SCHEDULED_JOBS: 'external' }), true);
  assert.equal(usesExternalScheduler({ SCHEDULED_JOBS: ' External ' }), true);
  assert.equal(usesExternalScheduler({}), false);
  assert.equal(usesExternalScheduler({ SCHEDULED_JOBS: 'internal' }), false);
});

test('a missing or short secret is treated as no secret', () => {
  assert.equal(cronSecret({}), '');
  assert.equal(cronSecret({ CRON_SECRET: 'short' }), '');
  assert.equal(cronSecret({ CRON_SECRET: ` ${SECRET} ` }), SECRET);
});

test('the header must match the secret exactly, and nothing matches an empty secret', () => {
  assert.equal(cronAuthorized(SECRET, SECRET), true);
  assert.equal(cronAuthorized(SECRET + 'x', SECRET), false);
  assert.equal(cronAuthorized('', ''), false);
  assert.equal(cronAuthorized(undefined, SECRET), false);
  assert.equal(cronAuthorized(['x'], SECRET), false);
});

test('a call without the right secret is refused and runs nothing', async () => {
  let runs = 0;
  const s = await serve(createJobsRouter({ secret: SECRET, ready: async () => {}, jobs: { sweep: async () => void runs++ }, log: () => {} }));
  try {
    assert.equal((await call(`${s.url}/sweep`)).status, 403);
    assert.equal((await call(`${s.url}/sweep`, 'wrong')).status, 403);
    assert.equal(runs, 0);
  } finally {
    await s.close();
  }
});

test('with no usable secret every call is refused', async () => {
  let runs = 0;
  const s = await serve(createJobsRouter({ secret: '', ready: async () => {}, jobs: { sweep: async () => void runs++ }, log: () => {} }));
  try {
    assert.equal((await call(`${s.url}/sweep`, '')).status, 403);
    assert.equal(runs, 0);
  } finally {
    await s.close();
  }
});

test('an unknown job name is a 404, including names inherited from Object', async () => {
  const s = await serve(createJobsRouter({ secret: SECRET, ready: async () => {}, jobs: { sweep: async () => {} }, log: () => {} }));
  try {
    assert.equal((await call(`${s.url}/nope`, SECRET)).status, 404);
    assert.equal((await call(`${s.url}/toString`, SECRET)).status, 404);
  } finally {
    await s.close();
  }
});

test('a job waits for start-up to finish, then runs to the end before answering', async () => {
  const order: string[] = [];
  let finishStartup!: () => void;
  const ready = new Promise<void>((r) => (finishStartup = r));
  const s = await serve(
    createJobsRouter({
      secret: SECRET,
      ready: () => ready,
      jobs: { sweep: async () => void order.push('job') },
      log: () => {},
    })
  );
  try {
    const pending = call(`${s.url}/sweep`, SECRET);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(order.length, 0);
    order.push('ready');
    finishStartup();
    const res = await pending;
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, job: 'sweep' });
    assert.deepEqual(order, ['ready', 'job']);
  } finally {
    await s.close();
  }
});

test('a failing job or a failed start-up answers 500', async () => {
  const s = await serve(
    createJobsRouter({
      secret: SECRET,
      ready: async () => {},
      jobs: { sweep: async () => { throw new Error('boom'); } },
      log: () => {},
    })
  );
  const s2 = await serve(
    createJobsRouter({ secret: SECRET, ready: () => Promise.reject(new Error('no start')), jobs: { sweep: async () => {} }, log: () => {} })
  );
  try {
    assert.equal((await call(`${s.url}/sweep`, SECRET)).status, 500);
    assert.equal((await call(`${s2.url}/sweep`, SECRET)).status, 500);
  } finally {
    await s.close();
    await s2.close();
  }
});

test('the same job is not run twice at once, and runs again once the first has finished', async () => {
  let release!: () => void;
  let runs = 0;
  const s = await serve(
    createJobsRouter({
      secret: SECRET,
      ready: async () => {},
      jobs: { sweep: () => { runs++; return new Promise<void>((r) => (release = r)); } },
      log: () => {},
    })
  );
  try {
    const first = call(`${s.url}/sweep`, SECRET);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await call(`${s.url}/sweep`, SECRET)).status, 409);
    release();
    assert.equal((await first).status, 200);
    const third = call(`${s.url}/sweep`, SECRET);
    await new Promise((r) => setTimeout(r, 50));
    release();
    assert.equal((await third).status, 200);
    assert.equal(runs, 2);
  } finally {
    await s.close();
  }
});
