import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DuplikiumClient,
  DuplikiumError,
  RateLimiter,
  DEFAULT_LIMITS,
  normalizeAccount,
  normalizePosition,
  readSide,
  describeAnswer,
  readPositions,
  toIso,
  num,
  COPIER,
  type Transport,
  type TransportRequest,
} from '../src/backend/duplikiumClient.ts';

// ---------- a pretend Duplikium: records every request and answers from a script ----------

type Reply = { status?: number; body: unknown } | ((req: TransportRequest) => { status?: number; body: unknown });

function pretend(script: Record<string, Reply | Reply[]>) {
  const requests: TransportRequest[] = [];
  const counts: Record<string, number> = {};
  const transport: Transport = async (req) => {
    requests.push(req);
    const path = req.url.replace('https://www.trade-copier.com/webservice/v4/', '');
    const entry = script[path];
    if (!entry) return { status: 404, text: JSON.stringify({ code: 404, error: `no script for ${path}` }) };
    const i = (counts[path] = (counts[path] ?? -1) + 1);
    const r = Array.isArray(entry) ? entry[Math.min(i, entry.length - 1)] : entry;
    const out = typeof r === 'function' ? r(req) : r;
    return { status: out.status ?? 200, text: typeof out.body === 'string' ? out.body : JSON.stringify(out.body) };
  };
  return { transport, requests, counts };
}

const fast = () => new RateLimiter(DEFAULT_LIMITS, () => clock.now, async (ms) => void (clock.now += ms));
const clock = { now: 1_800_000_000_000 };
const exp = (offsetSeconds: number) => Math.floor(clock.now / 1000) + offsetSeconds;
const TOKEN = (n: number, e = 48 * 3600) => ({ body: { token: `jwt-${n}`, exp: exp(e) } });

function client(script: Record<string, Reply | Reply[]>, extra: Partial<ConstructorParameters<typeof DuplikiumClient>[0]> = {}) {
  clock.now = 1_800_000_000_000;
  const p = pretend(script);
  const c = new DuplikiumClient({ user: 'cockpit-user', password: 'p@ss:word', transport: p.transport, now: () => clock.now, limiter: fast(), ...extra });
  return { c, ...p };
}
const form = (req: TransportRequest) => Object.fromEntries(new URLSearchParams(req.body));

// ---------- signing in ----------

test('signs in with HTTP Basic (user:password) and sends the token as Bearer', async () => {
  const { c, requests } = client({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': { body: { accounts: [] } } });
  await c.getAccounts();
  assert.equal(requests[0].headers.Authorization, `Basic ${Buffer.from('cockpit-user:p@ss:word').toString('base64')}`);
  assert.equal(requests[1].headers.Authorization, 'Bearer jwt-1');
  assert.ok(requests.every((r) => r.url.startsWith('https://')));
});

test('the token is reused until it is close to expiry, then refreshed', async () => {
  const { c, counts } = client({ 'access/getToken.php': [TOKEN(1), TOKEN(2)], 'account/getAccounts.php': { body: { accounts: [] } } });
  await c.getAccounts();
  await c.getAccounts();
  assert.equal(counts['access/getToken.php'], 0); // one sign-in so far (index 0)
  clock.now += 47.5 * 3600 * 1000; // less than an hour of life left
  await c.getAccounts();
  assert.equal(counts['access/getToken.php'], 1); // refreshed once
});

test('two calls at the same moment share one sign-in', async () => {
  const { c, counts } = client({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': { body: { accounts: [] } } });
  await Promise.all([c.getAccounts(), c.getAccounts(), c.getAccounts()]);
  assert.equal(counts['access/getToken.php'], 0);
});

test('a refused sign-in is an AUTH error and never mentions the password', async () => {
  const { c } = client({ 'access/getToken.php': { status: 401, body: { code: 401, error: 'Invalid credentials' } } });
  await assert.rejects(c.getAccounts(), (e: any) => e instanceof DuplikiumError && e.kind === 'AUTH' && !String(e.message).includes('p@ss'));
});

test('an expired token is replaced once and the call is repeated', async () => {
  const { c, counts } = client({
    'access/getToken.php': [TOKEN(1), TOKEN(2)],
    'account/getAccounts.php': [{ status: 401, body: { code: 401, error: 'Token expired' } }, { body: { accounts: [] } }],
  });
  assert.deepEqual(await c.getAccounts(), []);
  assert.equal(counts['access/getToken.php'], 1);
});

test('if the new token is refused too, it stops (no endless loop)', async () => {
  const { c } = client({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': { status: 401, body: { error: 'Invalid token' } } });
  await assert.rejects(c.getAccounts(), (e: any) => e.kind === 'AUTH');
});

test('only HTTPS is accepted', () => {
  assert.throws(() => new DuplikiumClient({ user: 'u', password: 'p', baseUrl: 'http://www.trade-copier.com/webservice/v4/' }), (e: any) => e.kind === 'NOT_CONFIGURED');
});

test('fromEnv needs both the user and the password', () => {
  assert.equal(DuplikiumClient.fromEnv({}), null);
  assert.equal(DuplikiumClient.fromEnv({ DUPLIKIUM_API_USER: 'u' }), null);
  assert.ok(DuplikiumClient.fromEnv({ DUPLIKIUM_API_USER: 'u', DUPLIKIUM_API_TOKEN: 'p' }));
});

// ---------- accounts ----------

test('addAccount sends a slave built from the template and returns the new id', async () => {
  const { c, requests } = client({
    'access/getToken.php': TOKEN(1),
    'account/addAccount.php': { body: { account: { account_id: 'ABC123', name: 'x', login: '1', server: 's' } } },
  });
  const r = await c.addAccount({ type: 'slave', name: 'CastimoFX Client u1 #5551234', broker: 'mt5', login: '5551234', password: 'Tr@d1ng pw&=', server: 'HFMarketsGlobal-Live20', enabled: true, group: 'TPL', subscription: 'auto' });
  assert.equal(r.accountId, 'ABC123');
  const f = form(requests[1]);
  assert.equal(f.type, '1');
  assert.equal(f.broker, 'mt5');
  assert.equal(f.status, '1');
  assert.equal(f.group, 'TPL');
  assert.equal(f.subscription, 'auto');
  assert.equal(f.password, 'Tr@d1ng pw&='); // special characters survive the encoding
  assert.equal(requests[1].headers['Content-Type'], 'application/x-www-form-urlencoded');
});

test('addAccount without an id in the answer is an error, not a made-up account', async () => {
  const { c } = client({ 'access/getToken.php': TOKEN(1), 'account/addAccount.php': { body: { account: {} } } });
  await assert.rejects(c.addAccount({ type: 'slave', name: 'n', broker: 'mt5', login: '1', password: 'p', server: 's', enabled: true }), (e: any) => e.kind === 'BAD_RESPONSE');
});

test('Duplikium error messages become API errors with their code', async () => {
  const { c } = client({ 'access/getToken.php': TOKEN(1), 'account/addAccount.php': { status: 400, body: { code: 1042, error: 'Account limit reached' } } });
  await assert.rejects(c.addAccount({ type: 'slave', name: 'n', broker: 'mt5', login: '1', password: 'p', server: 's', enabled: true }), (e: any) => e.kind === 'API' && e.code === '1042' && /limit/.test(e.message));
});

test('getAccounts reads numbers from text and leaves unreported figures as null', () => {
  const a = normalizeAccount({ account_id: 'A1', name: 'n', login: '77', server: 'S', broker: 'MT5', type: 1, status: 1, balance: '1,250.50', equity: '1200', free_margin: '', ccy: 'usd', state: 'connected', lastUpdate: '2026-10-30 12:00:00', groupid: 'G', open_trades: 2 });
  assert.equal(a!.balance, 1250.5);
  assert.equal(a!.equity, 1200);
  assert.equal(a!.freeMargin, null);
  assert.equal(a!.currency, 'USD');
  assert.equal(a!.state, 'CONNECTED');
  assert.equal(a!.type, 'slave');
  assert.equal(a!.enabled, true);
  assert.equal(a!.openTrades, 2);
  assert.equal(normalizeAccount({ name: 'no id' }), null);
  assert.equal(normalizeAccount(null), null);
  const m = normalizeAccount({ account_id: 'M', type: 0, status: 0 });
  assert.equal(m!.type, 'master');
  assert.equal(m!.enabled, false);
  assert.equal(m!.balance, null);
});

test('getAccounts can ask for one account or several', async () => {
  const { c, requests } = client({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': { body: { accounts: [{ account_id: 'A' }] } } });
  await c.getAccounts('A');
  await c.getAccounts(['A', 'B']);
  await c.getAccounts();
  assert.equal(form(requests[1]).account_id, 'A');
  assert.deepEqual(form(requests[2]), { 'account_id[0]': 'A', 'account_id[1]': 'B' });
  assert.deepEqual(form(requests[3]), {});
});

test('an account list that cannot be read is an error, not an empty list', async () => {
  const { c } = client({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': { body: { something: 'else' } } });
  await assert.rejects(c.getAccounts(), (e: any) => e.kind === 'BAD_RESPONSE');
});

test('an answer that is not JSON is a BAD_RESPONSE', async () => {
  const { c } = client({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': { body: '<html>oops</html>' } });
  await assert.rejects(c.getAccounts(), (e: any) => e.kind === 'BAD_RESPONSE');
});

test('deleteAccount treats "already gone" as success but reports real failures', async () => {
  const gone = client({ 'access/getToken.php': TOKEN(1), 'account/deleteAccount.php': { status: 404, body: { code: 404, error: 'Account not found' } } });
  await gone.c.deleteAccount('X');
  const broken = client({ 'access/getToken.php': TOKEN(1), 'account/deleteAccount.php': { status: 500, body: { code: 500, error: 'Internal problem' } } });
  await assert.rejects(broken.c.deleteAccount('X'), (e: any) => e.kind === 'API');
});

test('updateAccount sends only what changes', async () => {
  const { c, requests } = client({ 'access/getToken.php': TOKEN(1), 'account/updateAccount.php': { body: { account: {} } } });
  await c.updateAccount('A1', { enabled: false });
  assert.deepEqual(form(requests[1]), { account_id: 'A1', status: '0' });
  await c.updateAccount('A1', { password: 'new', enabled: true });
  assert.deepEqual(form(requests[2]), { account_id: 'A1', status: '1', password: 'new' });
});

// ---------- settings ----------

test('setSettings needs exactly one of slave or template', async () => {
  const { c } = client({ 'access/getToken.php': TOKEN(1), 'settings/setSettings.php': { body: { success: 'ok' } } });
  await assert.rejects(c.setSettings({ idMaster: 'M', copierStatus: 1 }), (e: any) => e.kind === 'API');
  await assert.rejects(c.setSettings({ idMaster: 'M', idSlave: 'S', idGroup: 'G', copierStatus: 1 }), (e: any) => e.kind === 'API');
});

test('setSettings sends the copier status and copy size', async () => {
  const { c, requests } = client({ 'access/getToken.php': TOKEN(1), 'settings/setSettings.php': { body: { success: 'ok' } } });
  await c.setSettings({ idMaster: 'M', idSlave: 'S', copierStatus: COPIER.CLOSE_ONLY, riskFactorType: 11, riskFactorValue: 0.5 });
  // the service takes a list of rows: ours is row 0 (its own sample sends http_build_query of a list)
  assert.deepEqual(form(requests[1]), { '0[id_master]': 'M', '0[id_slave]': 'S', '0[copier_status]': '-1', '0[risk_factor_type]': '11', '0[risk_factor_value]': '0.5' });
  assert.ok(!('id_slave' in form(requests[1])), 'not the flat form');
});

test('reading settings: "please contact us" means no settings found yet, but other errors are still errors', async () => {
  const none = client({ 'access/getToken.php': TOKEN(1), 'settings/getSettings.php': { status: 200, body: { code: 500, error: 'please contact us at support@trade-copier.com' } } });
  assert.deepEqual(await none.c.getSettings({ idMaster: 'M' }), []);
  const bad = client({ 'access/getToken.php': TOKEN(1), 'settings/getSettings.php': { status: 400, body: { code: 12, error: 'Unknown master' } } });
  await assert.rejects(bad.c.getSettings({ idMaster: 'M' }), (e: any) => e.kind === 'API' && /Unknown master/.test(e.message));
});

test('getSettings reads the copier status and copy size', async () => {
  const { c } = client({
    'access/getToken.php': TOKEN(1),
    'settings/getSettings.php': { body: { settings: [{ id_master: 'M', id_slave: 'S', id_group: null, copier_status: '1', risk_factor_type: 11, risk_factor_value: '1' }] } },
  });
  const rows = await c.getSettings({ idMaster: 'M' });
  assert.deepEqual(rows, [{ idMaster: 'M', idSlave: 'S', idGroup: null, copierStatus: 1, riskFactorType: 11, riskFactorValue: 1 }]);
});

// ---------- positions ----------

test('a position is read under several spellings; unreadable ones are skipped, never invented', () => {
  const r = readPositions({
    positions: [
      { ticket: 555, symbol: 'XAUUSD', type: 'Buy', volume: '0.10', open_price: '2650.5', profit: '12.3', commission: '-0.7', swap: '0', sl: 0, tp: '2700', open_time: '2026-10-30 08:15:00' },
      { position_id: 'p2', symbol: 'EURUSD', side: 'SELL', lots: 1, price_open: 1.1, close_price: 1.09, close_time: '2026-10-30T09:00:00Z', open_time: '2026-10-30T08:00:00Z' },
      { ticket: 3, symbol: 'GBPUSD', volume: 1 }, // no buy/sell side
      { ticket: 4, symbol: 'GBPUSD', type: 'buy', volume: 0 }, // no size
      'junk',
    ],
  });
  assert.equal(r.positions.length, 2);
  assert.equal(r.skipped, 2, 'the two position rows without a side or a size; text that is not a row is ignored');
  const [a, b] = r.positions;
  assert.equal(a.id, '555');
  assert.equal(a.side, 'BUY');
  assert.equal(a.volume, 0.1);
  assert.equal(a.openPrice, 2650.5);
  assert.equal(a.profit, 12.3);
  assert.equal(a.takeProfit, 2700);
  assert.equal(a.openTime, '2026-10-30T08:15:00.000Z');
  assert.equal(a.rawOpenTime, '2026-10-30 08:15:00');
  assert.equal(a.closePrice, null);
  assert.equal(b.side, 'SELL');
  assert.equal(b.closeTime, '2026-10-30T09:00:00.000Z');
});

test('the list of positions is found whatever it is called, and an empty answer is an empty list', () => {
  assert.equal(readPositions([{ ticket: 1, symbol: 'X', type: 'buy', volume: 1 }]).positions.length, 1);
  assert.equal(readPositions({ trades: [{ ticket: 1, symbol: 'X', type: 'sell', volume: 1 }] }).positions.length, 1);
  assert.equal(readPositions({ whatever: [{ ticket: 1, symbol: 'X', type: 'sell', volume: 1 }] }).positions.length, 1);
  assert.deepEqual(readPositions({}), { positions: [], skipped: 0 });
  assert.deepEqual(readPositions(null), { positions: [], skipped: 0 });
  assert.equal(normalizePosition({ ticket: 1, symbol: 'X', type: 'buy', volume: 'abc' }), null);
});

test('positions are found in other shapes: keyed by ticket, grouped by account, nested under data', () => {
  const row = (t: number, side = 'Sell') => ({ ticket: t, symbol: 'XAUUSD', type: side, volume: 0.03 });
  assert.equal(readPositions({ positions: { '3426236597': row(3426236597) } }).positions.length, 1);
  assert.equal(readPositions({ data: { positions: [row(1), row(2, 'Buy')] } }).positions.length, 2);
  assert.equal(readPositions({ positions: [{ account_id: 'A1', positions: [row(1)] }] }).positions.length, 1);
  assert.equal(readPositions([[row(1)]]).positions.length, 1);
  assert.equal(readPositions({ positions: [row(1), row(1)] }).positions.length, 1, 'the same ticket twice is one trade');
});

test('when reading open trades, closed or pending groups are not entered', () => {
  const r = readPositions(
    { open: [{ ticket: 1, symbol: 'X', type: 'buy', volume: 1 }], closed: [{ ticket: 2, symbol: 'Y', type: 'sell', volume: 1 }], pending: [{ ticket: 3, symbol: 'Z', type: 'buy', volume: 1 }] },
    { skipGroups: /closed|history|pending/i }
  );
  assert.deepEqual(r.positions.map((p) => p.id), ['1']);
});

test("another account's trade is never shown as this account's", () => {
  const r = readPositions({ positions: [{ account_id: 'A1', ticket: 1, symbol: 'X', type: 'buy', volume: 1 }, { account_id: 'B2', ticket: 2, symbol: 'X', type: 'buy', volume: 1 }, { ticket: 3, symbol: 'X', type: 'sell', volume: 1 }] }, { accountId: 'A1' });
  assert.deepEqual(r.positions.map((p) => p.id), ['1', '3']);
});

test('buy or sell is read only from words; a number is never turned into a side', () => {
  assert.equal(readSide('Buy'), 'BUY');
  assert.equal(readSide('POSITION_TYPE_SELL'), 'SELL');
  assert.equal(readSide('short'), 'SELL');
  assert.equal(readSide('b'), 'BUY');
  assert.equal(readSide('buy_sell'), null);
  assert.equal(readSide('Buy Limit'), 'BUY');
  assert.equal(readSide(1), null);
  assert.equal(readSide('1'), null);
  const r = readPositions({ positions: [{ ticket: 9, symbol: 'XAUUSD', type: 1, volume: 0.03 }] });
  assert.equal(r.positions.length, 0);
  assert.equal(r.skipped, 1, 'counted as unreadable, so the dashboard says "could not be read", not "no trade"');
});

test('an unreadable answer is described by field names and kinds only, with the side value shown', () => {
  const r = readPositions({ success: true, positions: { '3426236597': { ticket: 3426236597, symbol: 'XAUUSD', type: 1, volume: 0.03, profit: 0.8, password: 'x' } } });
  assert.equal(
    r.layout,
    '{success:boolean, positions:{#id:{ticket:number, symbol:string="XAUUSD", type:number=1, volume:number, profit:number, password:string}}}'
  );
  assert.ok(!Object.keys(r).includes('layout'));
  assert.equal(describeAnswer({ error: null, list: [] }), '{error:null, list:[]}');
});

test('getOpenPositions asks for one account', async () => {
  const { c, requests } = client({ 'access/getToken.php': TOKEN(1), 'position/getOpenPositions.php': { body: { positions: [] } } });
  assert.deepEqual(await c.getOpenPositions('M1'), { positions: [], skipped: 0 });
  assert.deepEqual(form(requests[1]), { account_id: 'M1' });
});

test('times and numbers are read carefully', () => {
  assert.equal(toIso('2026-10-30 08:15:00'), '2026-10-30T08:15:00.000Z');
  assert.equal(toIso('2026-10-30T08:15:00+02:00'), '2026-10-30T06:15:00.000Z');
  assert.equal(toIso(1761812100), '2025-10-30T08:15:00.000Z');
  assert.equal(toIso(''), null);
  assert.equal(toIso('not a date'), null);
  assert.equal(num('  12.5 '), 12.5);
  assert.equal(num('x'), null);
  assert.equal(num(NaN), null);
  assert.equal(num(null), null);
});

// ---------- limits ----------

test('calls are spaced to stay inside the per-second limit', async () => {
  const sleeps: number[] = [];
  const t = { now: 0 };
  const lim = new RateLimiter(DEFAULT_LIMITS, () => t.now, async (ms) => { sleeps.push(ms); t.now += ms; });
  for (let i = 0; i < 4; i++) await lim.acquire('settings'); // settings: 1 per second
  assert.ok(sleeps.length >= 3, 'it waited between calls');
  assert.ok(t.now >= 3000, 'at least three seconds passed for four calls');
});

test('the per-minute limit is respected too', async () => {
  const t = { now: 0 };
  const lim = new RateLimiter({ ...DEFAULT_LIMITS, other: { perSec: 100, perMin: 3, perHour: 1000 } }, () => t.now, async (ms) => { t.now += ms; }, 120_000);
  for (let i = 0; i < 3; i++) await lim.acquire('other');
  const before = t.now;
  await lim.acquire('other'); // the 4th must wait for the minute window
  assert.ok(t.now - before >= 59_000);
});

test('when waiting would take too long it says so instead of hanging', async () => {
  const t = { now: 0 };
  const lim = new RateLimiter({ ...DEFAULT_LIMITS, other: { perSec: 100, perMin: 1, perHour: 1000 } }, () => t.now, async (ms) => { t.now += ms; }, 5_000);
  await lim.acquire('other');
  await assert.rejects(lim.acquire('other'), (e: any) => e.kind === 'RATE_LIMIT');
});

test('different kinds of call have their own limits', async () => {
  const t = { now: 0 };
  const lim = new RateLimiter(DEFAULT_LIMITS, () => t.now, async (ms) => { t.now += ms; });
  await lim.acquire('settings');
  await lim.acquire('accounts'); // no wait: a different class
  await lim.acquire('open');
  assert.equal(t.now, 0);
});

test('network failures are reported as NETWORK, not as a wrong login', async () => {
  const c = new DuplikiumClient({
    user: 'u',
    password: 'p',
    transport: async () => {
      throw new DuplikiumError('NETWORK', 'Could not reach the copier service.');
    },
  });
  await assert.rejects(c.getAccounts(), (e: any) => e.kind === 'NETWORK');
});

// ---------- adding an account when the answer is not what we expected ----------

const ADD = { type: 'slave' as const, name: 'CastimoFX Client u1 #420702376', broker: 'mt5' as const, login: '420702376', password: 'Sup3r-Secret$', server: 'XMGlobal-MT5 17', enabled: true, group: 'TPL', subscription: 'auto' };

test('addAccount accepts the other plain ways an id can come back', async () => {
  for (const body of [{ account_id: 'Z1' }, { account: [{ account_id: 'Z1' }] }, { account: { id: 'Z1' } }, { accounts: [{ account_id: 'Z1' }] }]) {
    const { c } = client({ 'access/getToken.php': TOKEN(1), 'account/addAccount.php': { body } });
    assert.equal((await c.addAccount(ADD)).accountId, 'Z1');
  }
});

test('an unreadable answer to "add" is recovered when the service did create the account (found by its exact name and login)', async () => {
  const { c } = client({
    'access/getToken.php': TOKEN(1),
    'account/addAccount.php': { status: 200, body: '<html>Notice: something</html>' },
    'account/getAccounts.php': { body: { accounts: [{ account_id: 'NEW1', name: ADD.name, login: ADD.login, server: ADD.server, type: 1, status: 1 }] } },
  });
  assert.equal((await c.addAccount(ADD)).accountId, 'NEW1');
});

test('an answer with no id is recovered the same way, and never by guessing between several accounts', async () => {
  const { c } = client({
    'access/getToken.php': TOKEN(1),
    'account/addAccount.php': { body: { ok: true } },
    'account/getAccounts.php': { body: { accounts: [{ account_id: 'A', name: ADD.name, login: ADD.login, type: 1 }, { account_id: 'B', name: ADD.name, login: ADD.login, type: 1 }] } },
  });
  await assert.rejects(c.addAccount(ADD), (e: any) => e.kind === 'BAD_RESPONSE' && /these fields: ok/.test(e.detail));
});

test('an unreadable answer is described for the administrator with the password hidden, and the client message stays calm', async () => {
  const { c } = client({
    'access/getToken.php': TOKEN(1),
    'account/addAccount.php': { status: 502, body: '<html><body>Bad gateway while saving Sup3r-Secret$ for you</body></html>' },
    'account/getAccounts.php': { body: { accounts: [] } },
  });
  await assert.rejects(c.addAccount(ADD), (e: any) => {
    assert.equal(e.kind, 'BAD_RESPONSE');
    assert.match(e.detail, /HTTP 502/);
    assert.match(e.detail, /Bad gateway/);
    assert.ok(!e.detail.includes('Sup3r-Secret$'), 'the password is not in the detail');
    assert.ok(!e.message.includes('Bad gateway'), 'the message itself carries no answer text');
    return true;
  });
});

test('account lists are read in every plain shape Duplikium may use, and an unknown shape is an error (never an empty list)', async () => {
  const row = (id: string) => ({ account_id: id, name: 'n' + id, login: '1', type: 1, status: 1 });
  const shapes: Array<[string, unknown, string[]]> = [
    ['documented list', { accounts: [row('A'), row('B')] }, ['A', 'B']],
    ['one account under "account"', { account: row('A') }, ['A']],
    ['list under "account"', { account: [row('A'), row('B')] }, ['A', 'B']],
    ['rows keyed by id', { accounts: { A: row('A'), B: row('B') } }, ['A', 'B']],
    ['bare list', [row('A')], ['A']],
    ['no accounts', { accounts: [] }, []],
    ['no accounts (empty object)', { accounts: {} }, []],
  ];
  for (const [label, body, ids] of shapes) {
    const { c } = client({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': { body } });
    assert.deepEqual((await c.getAccounts()).map((a) => a.accountId), ids, label);
  }
  for (const body of [{}, { ok: true }, { message: 'hello' }, 'text']) {
    const { c } = client({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': { body } });
    await assert.rejects(c.getAccounts(), (e: any) => e.kind === 'BAD_RESPONSE', `unknown shape ${JSON.stringify(body)}`);
  }
});

// ---------- changing copy settings: the answer's shape is not relied on ----------

test('a settings change answered with plain text (2xx) is accepted, because the caller reads the setting back', async () => {
  for (const text of ['OK', '<html>done</html>', '1']) {
    const { c } = client({ 'access/getToken.php': TOKEN(1), 'settings/setSettings.php': { status: 200, body: text } });
    await c.setSettings({ idMaster: 'M', idSlave: 'S', copierStatus: COPIER.FROZEN });
  }
});

test('a settings change that fails is still an error: a JSON error, or a non-JSON answer with a failing status', async () => {
  const a = client({ 'access/getToken.php': TOKEN(1), 'settings/setSettings.php': { status: 400, body: { code: 12, error: 'Unknown slave' } } });
  await assert.rejects(a.c.setSettings({ idMaster: 'M', idSlave: 'S', copierStatus: 1 }), (e: any) => e.kind === 'API' && /Unknown slave/.test(e.message));
  const b = client({ 'access/getToken.php': TOKEN(1), 'settings/setSettings.php': { status: 500, body: '<html>Server error</html>' } });
  await assert.rejects(b.c.setSettings({ idMaster: 'M', idSlave: 'S', copierStatus: 1 }), (e: any) => e.kind === 'BAD_RESPONSE' && /HTTP 500/.test(e.detail));
});

test('other calls stay strict: plain text where JSON is expected is still an unreadable answer', async () => {
  const { c } = client({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': { status: 200, body: 'OK' } });
  await assert.rejects(c.getAccounts(), (e: any) => e.kind === 'BAD_RESPONSE');
});

// ---------- the service's own request limit ----------

import { parseRateLimit, limitsForAccountCount } from '../src/backend/duplikiumClient.ts';

test('the real limit is read from the service\'s own words', () => {
  assert.deepEqual(parseRateLimit('API: You reached the request limit (2/1 per second) for this endpoint(/webservice/v4/account/getAccounts.php) with 1 accounts'), { max: 1, unit: 'second', accounts: 1 });
  assert.deepEqual(parseRateLimit('You reached the request limit (31/2 per minute)'), { max: 2, unit: 'minute' });
  assert.deepEqual(parseRateLimit('limit (9/5 per Hour)'), { max: 5, unit: 'hour' });
  assert.deepEqual(parseRateLimit('something else'), {});
});

test('a per-second request limit is waited out once, learned, and the call then succeeds', async () => {
  const sleeps: number[] = [];
  const t = { now: 1_800_000_000_000 };
  const lim = new RateLimiter(DEFAULT_LIMITS, () => t.now, async (ms) => { sleeps.push(ms); t.now += ms; });
  const hit = { status: 200, body: { code: 5, error: 'You reached the request limit (2/1 per second) for this endpoint(/webservice/v4/account/getAccounts.php) with 1 accounts' } };
  const p = pretend({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': [hit, { body: { accounts: [] } }] });
  const c = new DuplikiumClient({ user: 'u', password: 'p', transport: p.transport, now: () => t.now, limiter: lim });
  assert.deepEqual(await c.getAccounts(), []);
  assert.equal(p.counts['account/getAccounts.php'], 1, 'asked twice (counter starts at 0)');
  assert.ok(sleeps.includes(1300), 'it waited before trying again');
  // learned: Duplikium counts 1 account, so reads are now paced to its smallest allowance (2 a minute, 30 an hour)
  assert.ok(c.refreshSpacingMs() >= 120_000, 'the periodic read is spaced two minutes apart or more');
  // a third read inside the minute is held back by our own limiter, without troubling the service
  await assert.rejects(c.getAccounts(), (e: any) => e.kind === 'RATE_LIMIT' && e.retryAfterMs > 0);
  assert.equal(p.counts['account/getAccounts.php'], 1, 'the service was not asked again');
});

test('limits follow the number of linked accounts, as the documentation says', () => {
  assert.deepEqual(limitsForAccountCount(1).accounts, { perSec: 1, perMin: 2, perHour: 27 }); // 30 an hour with a 10% margin
  assert.deepEqual(limitsForAccountCount(1).closed, { perSec: 1, perMin: 2, perHour: 27 });
  assert.deepEqual(limitsForAccountCount(5).accounts, { perSec: 5, perMin: 9, perHour: 135 });
  const big = limitsForAccountCount(500);
  assert.equal(big.accounts.perSec, 10);
  assert.equal(big.closed.perHour, 270); // 300 with a 10% margin
  assert.equal(limitsForAccountCount(0).accounts.perSec, 1); // never below one
});

test('the limiter relaxes when more accounts are seen, but the service\'s own count wins for 30 minutes', () => {
  const t = { now: 0 };
  const lim = new RateLimiter(DEFAULT_LIMITS, () => t.now);
  lim.setAccountsCount(1, 'list');
  const tight = lim.sustainableSpacingMs('accounts');
  lim.setAccountsCount(6, 'list');
  assert.ok(lim.sustainableSpacingMs('accounts') < tight, 'more accounts, more room');
  lim.setAccountsCount(1, 'service'); // Duplikium says it counts 1
  assert.equal(lim.sustainableSpacingMs('accounts'), tight);
  lim.setAccountsCount(6, 'list');
  assert.equal(lim.sustainableSpacingMs('accounts'), tight, 'still the service\'s count');
  t.now += 31 * 60_000;
  lim.setAccountsCount(6, 'list');
  assert.ok(lim.sustainableSpacingMs('accounts') < tight, 'after 30 minutes the list count is used again');
});

test('a request limit that keeps happening is a calm "busy" error, never a disconnection message', async () => {
  const hit = { status: 429, body: { error: 'You reached the request limit (40/2 per minute) with 1 accounts' } };
  const { c } = client({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': hit });
  await assert.rejects(c.getAccounts(), (e: any) => e.kind === 'RATE_LIMIT' && /request limit/.test(e.detail));
});

test('what is learned about the limit never changes the shared defaults', () => {
  const before = JSON.stringify(DEFAULT_LIMITS);
  const lim = new RateLimiter(DEFAULT_LIMITS);
  lim.tighten('accounts', 'second', 1);
  lim.tighten('accounts', 'minute', 999); // never raises
  assert.equal(JSON.stringify(DEFAULT_LIMITS), before);
});

test('after the service refuses a kind of call, that kind is not sent again until the wait is over (it would only be refused)', async () => {
  const t = { now: 1_800_000_000_000 };
  const lim = new RateLimiter(DEFAULT_LIMITS, () => t.now, async (ms) => void (t.now += ms));
  const hit = { status: 200, body: { code: 5, error: 'You reached the request limit (64/60 per hour) for this endpoint(/webservice/v4/account/getAccounts.php) with 4 accounts' } };
  const p = pretend({ 'access/getToken.php': TOKEN(1), 'account/getAccounts.php': [hit, { body: { accounts: [] } }] });
  const c = new DuplikiumClient({ user: 'u', password: 'p', transport: p.transport, now: () => t.now, limiter: lim });
  await assert.rejects(c.getAccounts(), (e: any) => e.kind === 'RATE_LIMIT' && e.retryAfterMs === 600_000);
  assert.equal(p.counts['account/getAccounts.php'], 0, 'one request was sent (the counter starts at 0)');
  // the next three attempts are turned away by our own limiter, without troubling the service
  for (let i = 0; i < 3; i++) await assert.rejects(c.getAccounts(), (e: any) => e.kind === 'RATE_LIMIT' && e.retryAfterMs > 0);
  assert.equal(p.counts['account/getAccounts.php'], 0, 'the service was not asked again');
  assert.ok(c.accountsReadyInMs() > 500_000, 'and we can tell how long it will be');
  // other kinds of call are unaffected (only the usual second between calls)
  assert.ok(lim.msUntilFree('other') <= 1100);
  // after the wait, reads go again
  t.now += 601_000;
  assert.equal(c.accountsReadyInMs(), 0);
  assert.deepEqual(await c.getAccounts(), []);
  assert.equal(p.counts['account/getAccounts.php'], 1);
});

test('the limits grow the moment an account is added and shrink when one is removed, before the next list is read', async () => {
  const t = { now: 1_800_000_000_000 };
  const lim = new RateLimiter(DEFAULT_LIMITS, () => t.now, async (ms) => void (t.now += ms));
  const p = pretend({
    'access/getToken.php': TOKEN(1),
    'account/getAccounts.php': { body: { accounts: [{ account_id: 'M', type: 0, name: 'master', login: '1', server: 'S', broker: 'mt5', state: 'CONNECTED' }] } },
    'account/addAccount.php': { body: { account: { account_id: 'S1' } } },
    'account/deleteAccount.php': { body: {} },
  });
  const c = new DuplikiumClient({ user: 'u', password: 'p', transport: p.transport, now: () => t.now, limiter: lim });
  await c.getAccounts(); // one account linked: the smallest allowance
  const one = c.refreshSpacingMs();
  await c.addAccount({ type: 'slave', name: 'n', broker: 'mt5', login: '5', password: 'pw', server: 'S', enabled: true });
  assert.ok(c.refreshSpacingMs() < one, 'two accounts: more room');
  await c.deleteAccount('S1');
  assert.equal(c.refreshSpacingMs(), one, 'back to one account');
});

test('a limiter can be asked how long a read would wait without using up a slot', () => {
  const t = { now: 0 };
  const lim = new RateLimiter({ ...DEFAULT_LIMITS, accounts: { perSec: 10, perMin: 2, perHour: 100 } }, () => t.now);
  assert.equal(lim.msUntilFree('accounts'), 0);
  assert.equal(lim.msUntilFree('accounts'), 0, 'asking does not use a slot');
});

test('the limiter says how many more reads fit in the minute and the hour, without using a slot', () => {
  const t = { now: 0 };
  const lim = new RateLimiter({ ...DEFAULT_LIMITS, accounts: { perSec: 10, perMin: 4, perHour: 6 } }, () => t.now);
  assert.equal(lim.headroom('accounts'), 4, 'the minute is the smaller room');
  return lim.acquire('accounts').then(async () => {
    assert.equal(lim.headroom('accounts'), 3);
    assert.equal(lim.headroom('accounts'), 3, 'asking does not use a slot');
    for (let i = 0; i < 3; i++) { t.now += 2000; await lim.acquire('accounts'); }
    assert.equal(lim.headroom('accounts'), 0, 'the minute is full');
    t.now += 61_000; // a minute later: the minute has room again, the hour (6) has 2 left
    assert.equal(lim.headroom('accounts'), 2, 'now the hour is the smaller room');
  });
});
