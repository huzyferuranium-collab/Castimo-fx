import test from 'node:test';
import assert from 'node:assert/strict';
import { checkClientHealth, newHealthState, usableInfo, type HealthDeps } from '../src/backend/clientHealth.ts';

const GOOD = { balance: 500, equity: 520, freeMargin: 480, leverage: 500, broker: 'Exness', name: 'Jane' };

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function deps(over: Partial<HealthDeps> & { c?: ReturnType<typeof clock> } = {}) {
  const c = over.c ?? clock();
  let reconnects = 0;
  const d: HealthDeps = {
    rpcInfo: async () => GOOD,
    reconnect: async () => { reconnects++; },
    now: c.now,
    ...over,
  };
  return { d, c, reconnects: () => reconnects };
}

test('RPC answers: connected, figures taken from the broker, failures reset', async () => {
  const { d, c } = deps();
  const prev = { ...newHealthState(c.now()), failures: 4, rpcFailures: 2 };
  const r = await checkClientHealth(d, prev);
  assert.equal(r.state.connectionState, 'CONNECTED');
  assert.equal(r.state.via, 'rpc');
  assert.equal(r.state.failures, 0);
  assert.equal(r.state.rpcFailures, 0);
  assert.equal(r.info!.equity, 520);
  assert.ok(r.state.latencyMs >= 1);
});

test('RPC fails but REST answers: still connected, data is fresh, RPC failure is counted', async () => {
  const { d, c } = deps({ rpcInfo: async () => { throw new Error('socket closed'); }, restInfo: async () => GOOD });
  const r = await checkClientHealth(d, newHealthState(c.now()));
  assert.equal(r.state.connectionState, 'CONNECTED');
  assert.equal(r.state.via, 'rest');
  assert.equal(r.state.rpcFailures, 1);
  assert.equal(r.info!.balance, 500);
});

test('nothing answers: not marked broken on the first miss, reconnecting after repeated misses, error after many', async () => {
  const { d, c } = deps({ rpcInfo: async () => { throw new Error('x'); }, restInfo: async () => null, reconnect: async () => { throw new Error('nope'); } });
  let s = newHealthState(c.now());
  let r = await checkClientHealth(d, s);
  assert.equal(r.state.connectionState, 'CONNECTED', 'a single blip is not an outage');
  assert.equal(r.info, undefined);
  s = r.state;
  r = await checkClientHealth(d, s);
  assert.equal(r.state.connectionState, 'RECONNECTING');
  s = r.state;
  for (let i = 0; i < 4; i++) { c.advance(10_000); s = (await checkClientHealth(d, s)).state; }
  assert.equal(s.connectionState, 'ERROR');
  assert.equal(s.via, 'none');
});

test('a long silence also means reconnecting, even after one miss', async () => {
  const { d, c } = deps({ rpcInfo: async () => { throw new Error('x'); } });
  const s = newHealthState(c.now());
  c.advance(45_000);
  const r = await checkClientHealth(d, s);
  assert.equal(r.state.connectionState, 'RECONNECTING');
});

test('after three RPC failures the link is rebuilt once, then paused before trying again', async () => {
  let tries = 0;
  const { d, c } = deps({ rpcInfo: async () => { throw new Error('x'); }, restInfo: async () => GOOD, reconnect: async () => { tries++; throw new Error('still down'); } });
  let s = newHealthState(c.now());
  for (let i = 0; i < 3; i++) s = (await checkClientHealth(d, s)).state;
  assert.equal(tries, 1);
  assert.equal(s.reconnectAttempts, 1);
  const first = s.lastReconnectAt;

  // too soon: no second rebuild
  c.advance(5_000);
  s = (await checkClientHealth(d, s)).state;
  assert.equal(s.lastReconnectAt, first);

  // after a failed rebuild the pause doubles (60s), so 36s in there is still no new attempt
  c.advance(31_000);
  s = (await checkClientHealth(d, s)).state;
  assert.equal(tries, 1);

  // after the pause: another attempt, with an even longer pause (120s) after it
  c.advance(25_000);
  s = (await checkClientHealth(d, s)).state;
  assert.equal(tries, 2);
  assert.equal(s.reconnectAttempts, 2);
  assert.notEqual(s.lastReconnectAt, first);
  const second = s.lastReconnectAt!;
  c.advance(61_000);
  s = (await checkClientHealth(d, s)).state;
  assert.equal(s.lastReconnectAt, second, 'the pause keeps growing');
  assert.equal(tries, 2);
});

test('a successful rebuild resets the RPC failure count', async () => {
  let healed = false;
  let tries = 0;
  const { d, c } = deps({
    rpcInfo: async () => { if (!healed) throw new Error('x'); return GOOD; },
    restInfo: async () => GOOD,
    reconnect: async () => { tries++; healed = true; },
  });
  let s = newHealthState(c.now());
  for (let i = 0; i < 3; i++) s = (await checkClientHealth(d, s)).state;
  assert.equal(tries, 1);
  assert.equal(s.rpcFailures, 0);
  assert.equal(s.reconnectAttempts, 0);
  const r = await checkClientHealth(d, s);
  assert.equal(r.state.via, 'rpc');
});

test('without a REST route (no token) the RPC route alone still works and a miss is just a miss', async () => {
  const { d, c } = deps({ rpcInfo: async () => { throw new Error('x'); }, restInfo: undefined });
  const r = await checkClientHealth(d, newHealthState(c.now()));
  assert.equal(r.info, undefined);
  assert.equal(r.state.failures, 1);
});

test('answers without real money figures are ignored, never written as data', async () => {
  for (const bad of [null, {}, { balance: NaN, equity: 5 }, { balance: -1, equity: 5 }, { balance: 5, equity: Infinity }, { balance: '5', equity: 5 }]) {
    assert.equal(usableInfo(bad as any), undefined);
  }
  const { d, c } = deps({ rpcInfo: async () => ({ balance: NaN, equity: 1 }) as any, restInfo: async () => GOOD });
  const r = await checkClientHealth(d, newHealthState(c.now()));
  assert.equal(r.state.via, 'rest', 'garbage from RPC falls through to REST');
});

test('checkClientHealth never throws, even if everything throws', async () => {
  const d: HealthDeps = {
    rpcInfo: async () => { throw new Error('a'); },
    restInfo: async () => { throw new Error('b'); },
    reconnect: async () => { throw new Error('c'); },
  };
  let s = newHealthState(Date.now());
  for (let i = 0; i < 4; i++) s = (await checkClientHealth(d, s)).state;
  assert.ok(['RECONNECTING', 'ERROR', 'CONNECTED'].includes(s.connectionState));
});
