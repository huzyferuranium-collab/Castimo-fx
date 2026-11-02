import test from 'node:test';
import assert from 'node:assert/strict';
import { RateWindow, rateLimit, trustProxyHops, isReadOnly } from '../src/backend/rateLimit.ts';
import { securityHeaders, SECURITY_HEADERS, HSTS_VALUE } from '../src/backend/securityHeaders.ts';
import { shapeMasterStatus } from '../src/backend/masterStatus.ts';

// ---------- rate window ----------

test('requests up to the limit pass, the next one is refused with a wait time', () => {
  const w = new RateWindow(3, 60_000);
  assert.equal(w.hit('a', 1000).allowed, true);
  assert.equal(w.hit('a', 1001).allowed, true);
  assert.equal(w.hit('a', 1002).allowed, true);
  const refused = w.hit('a', 1003);
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 60);
});

test('each visitor has their own count, and the count starts again after the window', () => {
  const w = new RateWindow(1, 10_000);
  assert.equal(w.hit('a', 0).allowed, true);
  assert.equal(w.hit('a', 5).allowed, false);
  assert.equal(w.hit('b', 5).allowed, true);
  assert.equal(w.hit('a', 10_001).allowed, true);
});

test('finished windows are cleared so memory cannot grow without end', () => {
  const w = new RateWindow(5, 1000, 3);
  w.hit('a', 0);
  w.hit('b', 0);
  w.hit('c', 0);
  assert.equal(w.size(), 3);
  // table is full, but every window is over, so a new visitor is counted and the old ones are dropped
  assert.equal(w.hit('d', 2000).allowed, true);
  assert.equal(w.size(), 1);
});

test('if the table is full of live windows a new visitor is let through rather than everyone being blocked', () => {
  const w = new RateWindow(5, 60_000, 2);
  w.hit('a', 0);
  w.hit('b', 0);
  assert.equal(w.hit('c', 1).allowed, true);
  assert.equal(w.size(), 2);
});

// ---------- rate limit middleware ----------

function fakeRes() {
  const out: { headers: Record<string, string>; code?: number; body?: any } = { headers: {} };
  const res = {
    setHeader(n: string, v: string) {
      out.headers[n] = v;
    },
    status(c: number) {
      out.code = c;
      return { json: (b: unknown) => void (out.body = b) };
    },
  };
  return { res, out };
}

test('the middleware answers 429 with Retry-After once the limit is passed', () => {
  let t = 0;
  const mw = rateLimit({ max: 2, windowMs: 30_000, now: () => t, env: {} });
  let passed = 0;
  const next = () => void passed++;
  for (let i = 0; i < 2; i++) mw({ ip: '1.2.3.4', method: 'POST' }, fakeRes().res, next);
  assert.equal(passed, 2);

  const { res, out } = fakeRes();
  mw({ ip: '1.2.3.4', method: 'POST' }, res, next);
  assert.equal(passed, 2);
  assert.equal(out.code, 429);
  assert.equal(out.body.success, false);
  assert.match(out.body.error, /Too many requests/);
  assert.equal(out.headers['Retry-After'], '30');

  // another visitor is unaffected, and the first one is let back in after the window
  mw({ ip: '5.6.7.8', method: 'POST' }, fakeRes().res, next);
  assert.equal(passed, 3);
  t = 30_001;
  mw({ ip: '1.2.3.4', method: 'POST' }, fakeRes().res, next);
  assert.equal(passed, 4);
});

test('skipped requests are neither counted nor blocked', () => {
  const mw = rateLimit({ max: 1, windowMs: 60_000, skip: isReadOnly, now: () => 0, env: {} });
  let passed = 0;
  const next = () => void passed++;
  for (let i = 0; i < 10; i++) mw({ ip: '1.1.1.1', method: 'GET' }, fakeRes().res, next);
  assert.equal(passed, 10);
  mw({ ip: '1.1.1.1', method: 'POST' }, fakeRes().res, next);
  assert.equal(passed, 11);
  const { res, out } = fakeRes();
  mw({ ip: '1.1.1.1', method: 'POST' }, res, next);
  assert.equal(out.code, 429);
});

test('RATE_LIMIT_OFF=1 turns the limit off', () => {
  const mw = rateLimit({ max: 1, windowMs: 60_000, now: () => 0, env: { RATE_LIMIT_OFF: '1' } });
  let passed = 0;
  for (let i = 0; i < 5; i++) mw({ ip: '9.9.9.9', method: 'POST' }, fakeRes().res, () => void passed++);
  assert.equal(passed, 5);
});

test('isReadOnly covers GET, HEAD and OPTIONS only', () => {
  assert.equal(isReadOnly({ method: 'GET' }), true);
  assert.equal(isReadOnly({ method: 'head' }), true);
  assert.equal(isReadOnly({ method: 'OPTIONS' }), true);
  assert.equal(isReadOnly({ method: 'POST' }), false);
  assert.equal(isReadOnly({ method: 'DELETE' }), false);
  assert.equal(isReadOnly({}), false);
});

test('proxy hops: 1 by default, a whole number from 0 to 5 when set, anything else falls back to 1', () => {
  assert.equal(trustProxyHops({}), 1);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '' }), 1);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '2' }), 2);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: ' 0 ' }), 0);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '5' }), 5);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '6' }), 1);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '-1' }), 1);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '1.5' }), 1);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: 'abc' }), 1);
});

// ---------- security headers ----------

test('every answer carries the browser security headers, and HSTS only in production', () => {
  for (const production of [false, true]) {
    const set: Record<string, string> = {};
    let called = false;
    securityHeaders({ production })({}, { setHeader: (n, v) => void (set[n] = v) }, () => void (called = true));
    assert.equal(called, true);
    for (const [n, v] of Object.entries(SECURITY_HEADERS)) assert.equal(set[n], v);
    assert.equal(set['Strict-Transport-Security'], production ? HSTS_VALUE : undefined);
  }
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(SECURITY_HEADERS['X-Frame-Options'], 'SAMEORIGIN');
});

// ---------- master status ----------

const metrics = {
  accountId: '5161337',
  login: '261089492',
  server: 'HFMarketsGlobal-Live20',
  balance: 1000,
  equity: 1010.5,
  freeMargin: 900,
  marginLevel: 500,
  currency: 'USD',
  leverage: 500,
  openPositionsCount: 2,
  latencyMs: 40,
  lastHeartbeat: '2026-01-01T00:00:00.000Z',
  state: 'CONNECTED',
  connectionStatus: 'CONNECTED',
} as any;

test('a signed-in client gets the figures but not the master account number, server or copier id', () => {
  const out = shapeMasterStatus(metrics, true, 7, false, '2026-01-01T00:00:01.000Z');
  assert.equal(out.success, true);
  assert.equal(out.connected, true);
  assert.equal(out.activeClientsCount, 7);
  assert.equal(out.master.balance, 1000);
  assert.equal(out.master.equity, 1010.5);
  assert.equal(out.master.openPositionsCount, 2);
  assert.equal(out.master.accountId, '');
  assert.equal(out.master.login, '');
  assert.equal(out.master.server, '');
  const text = JSON.stringify(out);
  for (const secret of ['261089492', 'HFMarketsGlobal-Live20', '5161337']) assert.equal(text.includes(secret), false);
});

test('an administrator also gets the master identifiers', () => {
  const out = shapeMasterStatus(metrics, true, 7, true, '2026-01-01T00:00:01.000Z');
  assert.equal(out.master.accountId, '5161337');
  assert.equal(out.master.login, '261089492');
  assert.equal(out.master.server, 'HFMarketsGlobal-Live20');
});

test('the status fields keep the names the dashboards already read', () => {
  const out = shapeMasterStatus(metrics, false, 0, false, 'now');
  assert.deepEqual(Object.keys(out).sort(), ['activeClientsCount', 'connected', 'connectionStatus', 'lastPing', 'master', 'mode', 'status', 'success', 'timestamp']);
  assert.equal(out.connected, false);
  assert.equal(out.status, 'CONNECTED');
  assert.equal(out.lastPing, '2026-01-01T00:00:00.000Z');
  assert.equal(out.mode, 'LIVE_DUPLIKIUM');
});
