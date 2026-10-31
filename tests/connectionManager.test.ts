// The connection manager against a PRETEND Duplikium. It proves our own wiring: the connect steps, the safety
// rules, pause / resume, disconnect, restore after a restart. It says nothing about the real Duplikium service.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CONNECT_SYNC_WAIT_SECONDS = '1';
process.env.CONNECT_PROBE_MS = '20';
process.env.CONNECT_DISCONNECT_GRACE_MS = '150';
process.env.MAX_CLIENT_ACCOUNTS = '0';
delete process.env.DUPLIKIUM_RISK_TYPE;
delete process.env.DUPLIKIUM_RISK_VALUE;

const { Mt5ConnectionManager } = await import('../src/backend/MT5_CONNECTION_MANAGER.ts');
const { BrokerVerificationError } = await import('../src/backend/brokerVerification.ts');
const { HandedOff } = await import('../src/backend/clientBridge.ts');
const { DuplikiumError } = await import('../src/backend/duplikiumClient.ts');
import type { CopierApi, DuplikiumAccount, AddAccountParams, DuplikiumSetting, PositionsResult, DuplikiumPosition } from '../src/backend/duplikiumClient.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- a pretend Duplikium ----------

class FakeCopier implements CopierApi {
  accounts = new Map<string, DuplikiumAccount>();
  copier = new Map<string, number>(); // slave id -> copier_status
  calls: string[] = [];
  added: AddAccountParams[] = [];
  updated: Array<{ id: string; changes: any }> = [];
  deleted: string[] = [];
  settingCalls: any[] = [];
  seq = 0;
  failGetAccounts = false;
  failSetSettings = false;
  ignoreStatusChange = false;
  /** What a newly added account looks like once Duplikium has logged in. */
  fresh: Partial<DuplikiumAccount> = { state: 'CONNECTED', balance: 500, equity: 520, freeMargin: 480, currency: 'USD' };
  templateRow: DuplikiumSetting = { idMaster: 'MASTER', idSlave: null, idGroup: 'TEMPLATE', copierStatus: 1, riskFactorType: 11, riskFactorValue: 0.5 };
  openPositions: Record<string, DuplikiumPosition[]> = {};
  closedPositions: Record<string, DuplikiumPosition[]> = {};
  positionCalls = 0;

  constructor() {
    this.accounts.set('MASTER', {
      accountId: 'MASTER', name: 'HFM master', login: '261089492', server: 'HFMarketsGlobal-Live20', broker: 'mt5', type: 'master', enabled: true,
      balance: 10_000, equity: 10_250, freeMargin: 9_000, currency: 'USD', state: 'CONNECTED', lastUpdate: '2026-10-30 10:00:00', groupId: null, subscriptionKey: null, openTrades: 1,
    });
  }

  async addAccount(p: AddAccountParams) {
    this.calls.push('addAccount');
    this.added.push(p);
    const id = `D${++this.seq}`;
    this.accounts.set(id, {
      accountId: id, name: p.name, login: p.login, server: p.server, broker: p.broker, type: 'slave', enabled: p.enabled,
      balance: null, equity: null, freeMargin: null, currency: '', state: 'NONE', lastUpdate: null, groupId: p.group ?? null, subscriptionKey: p.subscription ?? null, openTrades: 0,
      ...this.fresh,
    });
    return { accountId: id };
  }
  async deleteAccount(id: string) {
    this.calls.push('deleteAccount');
    this.deleted.push(id);
    this.accounts.delete(id);
    this.copier.delete(id);
  }
  async updateAccount(id: string, changes: any) {
    this.calls.push('updateAccount');
    this.updated.push({ id, changes });
    const a = this.accounts.get(id);
    if (a && changes.enabled !== undefined) a.enabled = changes.enabled;
  }
  async getAccounts(ids?: string | string[]) {
    this.calls.push('getAccounts');
    if (this.failGetAccounts) throw new DuplikiumError('NETWORK', 'down');
    const list = Array.from(this.accounts.values()).map((a) => ({ ...a }));
    if (!ids) return list;
    const want = new Set(Array.isArray(ids) ? ids : [ids]);
    return list.filter((a) => want.has(a.accountId));
  }
  async getSettings(f: { idMaster?: string; idSlave?: string; idGroup?: string }) {
    this.calls.push('getSettings');
    if (f.idGroup) return [this.templateRow];
    const rows: DuplikiumSetting[] = [];
    for (const [slave, status] of this.copier) {
      if (f.idSlave && f.idSlave !== slave) continue;
      rows.push({ idMaster: 'MASTER', idSlave: slave, idGroup: null, copierStatus: status, riskFactorType: 11, riskFactorValue: 0.5 });
    }
    return rows;
  }
  async setSettings(s: any) {
    this.calls.push('setSettings');
    this.settingCalls.push(s);
    if (this.failSetSettings) throw new DuplikiumError('API', 'settings are down');
    if (s.idSlave && !this.ignoreStatusChange) this.copier.set(s.idSlave, s.copierStatus);
  }
  async getOpenPositions(id: string): Promise<PositionsResult> {
    this.positionCalls++;
    return { positions: this.openPositions[id] ?? [], skipped: 0 };
  }
  async getClosedPositions(id: string): Promise<PositionsResult> {
    return { positions: this.closedPositions[id] ?? [], skipped: 0 };
  }
  /** Makes an account look the way Duplikium would report it after logging in. */
  settle(id: string, over: Partial<DuplikiumAccount> = {}) {
    Object.assign(this.accounts.get(id)!, { state: 'CONNECTED', balance: 500, equity: 520, freeMargin: 480, currency: 'USD', ...over });
  }
}

function setup(opts: { fresh?: Partial<DuplikiumAccount> } = {}) {
  const fake = new FakeCopier();
  if (opts.fresh) fake.fresh = { ...fake.fresh, ...opts.fresh };
  const m = Mt5ConnectionManager.forTests(fake, { masterId: 'MASTER', templateId: 'TEMPLATE' });
  const events = { verified: [] as string[], saved: [] as string[], newConn: [] as string[] };
  m.onClientVerified = (r: any) => events.verified.push(r.userId);
  m.onClientSaved = (r: any) => events.saved.push(`${r.userId}:${r.status}`);
  m.onNewConnection = (uid: string) => events.newConn.push(uid);
  return { fake, m, events };
}
const creds = (userId = 'u1', login = '5551234') => ({ userId, login, password: 'Secret-pw-1', server: 'HFMarketsGlobal-Live20' });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'NO_ERROR';
  } catch (e: any) {
    return e instanceof BrokerVerificationError ? e.code : e instanceof HandedOff ? 'HANDED_OFF' : `OTHER:${e?.message}`;
  }
};

// ---------- the master ----------

test('the master is read from Duplikium: real figures, connected', async () => {
  const { fake, m } = setup();
  assert.equal(await m.refreshAll(), true);
  const mm = m.getMasterMetrics();
  assert.equal(m.isConnected(), true);
  assert.equal(mm.balance, 10_000);
  assert.equal(mm.equity, 10_250);
  assert.equal(mm.login, '261089492');
  assert.equal(mm.server, 'HFMarketsGlobal-Live20');
  assert.equal(mm.openPositionsCount, 1);
  assert.equal(mm.lastHeartbeat, '2026-10-30T10:00:00.000Z');
  fake.accounts.get('MASTER')!.state = 'DISCONNECTED';
  await m.refreshAll();
  assert.equal(m.isConnected(), false);
});

test('a missing master says so and nothing is made up', async () => {
  const { fake, m } = setup();
  fake.accounts.delete('MASTER');
  await m.refreshAll();
  assert.equal(m.isConnected(), false);
  assert.match(m.getMasterNote(), /DUPLIKIUM_MASTER_ID/);
  assert.equal(m.getMasterMetrics().balance, 0);
});

test('when Duplikium cannot be reached the master is not shown as connected', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  assert.equal(m.isConnected(), true);
  fake.failGetAccounts = true;
  await m.refreshAll();
  assert.equal(m.isConnected(), false);
  assert.match(m.getMasterNote(), /NETWORK/);
});

// ---------- connecting ----------

test('a new client is added from the template, frozen first, then switched on and checked', async () => {
  const { fake, m, events } = setup();
  await m.refreshAll();
  const stages: string[] = [];
  const rec = await m.provisionClientTerminal(creds(), (s) => stages.push(s));

  assert.equal(fake.added.length, 1);
  const add = fake.added[0];
  assert.equal(add.type, 'slave');
  assert.equal(add.group, 'TEMPLATE');
  assert.equal(add.subscription, 'auto');
  assert.equal(add.name, 'CastimoFX Client u1 #5551234');
  assert.equal(add.broker, 'mt5');

  // frozen before anything else, then ON
  assert.equal(fake.settingCalls[0].copierStatus, 0);
  assert.equal(fake.settingCalls[0].idSlave, 'D1');
  assert.equal(fake.settingCalls[fake.settingCalls.length - 1].copierStatus, 1);
  assert.equal(fake.copier.get('D1'), 1);
  // the template's own copy size is carried over so switching copying on does not change it
  assert.equal(fake.settingCalls[fake.settingCalls.length - 1].riskFactorType, 11);
  assert.equal(fake.settingCalls[fake.settingCalls.length - 1].riskFactorValue, 0.5);

  assert.equal(rec.isBrokerVerified, true);
  assert.equal(rec.status, 'ACTIVE');
  assert.equal(rec.equity, 520);
  assert.equal(rec.leverage, 0);
  assert.equal(m.getClientConnection('u1'), rec);
  assert.deepEqual(events.verified, ['u1']);
  assert.deepEqual(events.newConn, ['u1']);
  assert.ok(events.saved.includes('u1:ACTIVE'));
  assert.deepEqual(stages.slice(0, 4), ['checking', 'creating', 'syncing', 'verifying']);
  assert.equal(m.pendingView('u1'), null);
});

test('the client\'s password is never kept: it is not in the record, the pool or anything saved', async () => {
  const { m } = setup();
  await m.refreshAll();
  const rec = await m.provisionClientTerminal(creds(), () => {});
  const dump = JSON.stringify([rec, m.getAllClientRecords(), m.getActiveClients(), m.pendingView('u1')]);
  assert.ok(!dump.includes('Secret-pw-1'));
});

test('a wrong password is refused clearly and the account is not left behind', async () => {
  const { fake, m } = setup({ fresh: { state: 'DISCONNECTED' } });
  await m.refreshAll();
  assert.equal(await code(m.provisionClientTerminal(creds(), () => {})), 'BROKER_AUTH_FAILED');
  assert.deepEqual(fake.deleted, ['D1']);
  assert.equal(m.getClientConnection('u1'), undefined);
  assert.equal(m.pendingView('u1'), null);
});

test('a read-only (investor) password is refused and the account removed', async () => {
  const { fake, m } = setup({ fresh: { state: 'INVESTOR_PASSWORD', balance: 500, equity: 500, currency: 'USD' } });
  await m.refreshAll();
  assert.equal(await code(m.provisionClientTerminal(creds(), () => {})), 'TRADING_NOT_ALLOWED');
  assert.deepEqual(fake.deleted, ['D1']);
});

test('below the minimum equity: refused with the figures, removed, and copying never switched on', async () => {
  const { fake, m } = setup({ fresh: { equity: 150, balance: 150, freeMargin: 150 } });
  await m.refreshAll();
  try {
    await m.provisionClientTerminal(creds(), () => {});
    assert.fail('should have refused');
  } catch (e: any) {
    assert.equal(e.code, 'MIN_EQUITY');
    assert.match(e.message, /\$150\.00/);
  }
  assert.deepEqual(fake.deleted, ['D1']);
  assert.ok(fake.settingCalls.every((c) => c.copierStatus !== 1), 'copying was never switched on');
});

test('accounts that are not in US dollars are refused', async () => {
  const { fake, m } = setup({ fresh: { currency: 'EUR' } });
  await m.refreshAll();
  assert.equal(await code(m.provisionClientTerminal(creds(), () => {})), 'UNSUPPORTED_CURRENCY');
  assert.deepEqual(fake.deleted, ['D1']);
});

test('the master account can never be connected as a client', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  assert.equal(await code(m.provisionClientTerminal(creds('u1', '261089492'), () => {})), 'IS_MASTER_ACCOUNT');
  assert.equal(fake.added.length, 0);
});

test('an account linked to another user is refused and never touched', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds('u1', '5551234'), () => {});
  assert.equal(await code(m.provisionClientTerminal(creds('u2', '5551234'), () => {})), 'ALREADY_LINKED');
  // an account that exists at Duplikium for someone else (not in memory) is refused as well
  fake.accounts.set('X9', { ...fake.accounts.get('D1')!, accountId: 'X9', name: 'CastimoFX Client someoneElse #7777777', login: '7777777' });
  assert.equal(await code(m.provisionClientTerminal(creds('u3', '7777777'), () => {})), 'ALREADY_LINKED');
  assert.equal(fake.deleted.length, 0);
  assert.ok(fake.accounts.has('D1') && fake.accounts.has('X9'));
});

test('a connected client who tries a different account is told kindly, and nothing is touched', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds('u1', '5551234'), () => {});
  assert.equal(await code(m.provisionClientTerminal(creds('u1', '6667777'), () => {})), 'ALREADY_CONNECTED');
  assert.equal(fake.added.length, 1);
  assert.equal(fake.deleted.length, 0);
});

test('connecting the same account again passes straight through', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  const a = await m.provisionClientTerminal(creds(), () => {});
  const b = await m.provisionClientTerminal(creds(), () => {});
  assert.equal(a, b);
  assert.equal(fake.added.length, 1);
});

test('an unfinished account from an earlier try is cleared so the client is never stuck', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  fake.accounts.set('OLD', { ...fake.accounts.get('MASTER')!, accountId: 'OLD', type: 'slave', name: 'CastimoFX Client u1 #1111111', login: '1111111', state: 'NONE' });
  const rec = await m.provisionClientTerminal(creds('u1', '5551234'), () => {});
  assert.deepEqual(fake.deleted, ['OLD']);
  assert.equal(rec.login, '5551234');
});

test('a client with billing history is never cleared automatically', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  m.hasBillingHistory = async () => true;
  fake.accounts.set('OLD', { ...fake.accounts.get('MASTER')!, accountId: 'OLD', type: 'slave', name: 'CastimoFX Client u1 #1111111', login: '1111111', state: 'NONE' });
  assert.equal(await code(m.provisionClientTerminal(creds('u1', '5551234'), () => {})), 'ALREADY_CONNECTED');
  assert.deepEqual(fake.deleted, []);
});

test('the client\'s own earlier account is reused with the new password, not duplicated', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  fake.accounts.set('MINE', { ...fake.accounts.get('MASTER')!, accountId: 'MINE', type: 'slave', name: 'CastimoFX Client u1 #5551234', login: '5551234', server: 'HFMarketsGlobal-Live20', balance: 800, equity: 800, freeMargin: 700, state: 'CONNECTED' });
  const rec = await m.provisionClientTerminal(creds(), () => {});
  assert.equal(fake.added.length, 0);
  assert.equal(rec.accountId, 'MINE');
  assert.equal(fake.updated[0].changes.password, 'Secret-pw-1');
});

test('the platform-wide account limit stops new accounts', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  process.env.MAX_CLIENT_ACCOUNTS = '1';
  try {
    await m.provisionClientTerminal(creds('u1', '5551234'), () => {});
    assert.equal(await code(m.provisionClientTerminal(creds('u2', '5552222'), () => {})), 'CAPACITY');
    assert.equal(fake.added.length, 1);
  } finally {
    process.env.MAX_CLIENT_ACCOUNTS = '0';
  }
});

test('without a template or master id nothing is accepted (fails closed)', async () => {
  const fake = new FakeCopier();
  const m = Mt5ConnectionManager.forTests(fake, { masterId: 'MASTER', templateId: '' });
  assert.equal(await code(m.provisionClientTerminal(creds(), () => {})), 'VERIFICATION_UNAVAILABLE');
  assert.equal(fake.added.length, 0);
});

test('if copying cannot be frozen, the new account is removed instead of left running', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  fake.failSetSettings = true;
  assert.equal(await code(m.provisionClientTerminal(creds(), () => {})), 'VERIFICATION_UNAVAILABLE');
  assert.deepEqual(fake.deleted, ['D1']);
  assert.equal(m.getClientConnection('u1'), undefined);
});

test('if copying does not really switch on, it is not reported as connected', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  // the freeze goes through, but later changes are ignored by the service
  const original = fake.setSettings.bind(fake);
  let n = 0;
  fake.setSettings = async (s: any) => {
    n++;
    if (n === 1) return original(s);
    fake.settingCalls.push(s);
  };
  const result = await code(m.provisionClientTerminal(creds(), () => {}));
  assert.equal(result, 'HANDED_OFF'); // the account is kept and retried in the background, never shown as copying
  assert.equal(m.getClientConnection('u1'), undefined);
  assert.equal(m.pendingView('u1')?.kind, 'working');
});

// ---------- a slow broker ----------

test('a broker that is slow to report figures carries on in the background and finishes by itself', async () => {
  const { fake, m, events } = setup({ fresh: { state: 'CONNECTED', balance: null, equity: null, freeMargin: null, currency: '' } });
  await m.refreshAll();
  assert.equal(await code(m.provisionClientTerminal(creds(), () => {})), 'HANDED_OFF');
  assert.equal(m.continueInBackground('u1'), true);
  assert.equal(m.pendingView('u1')?.kind, 'working');
  assert.equal(m.getClientConnection('u1'), undefined);
  assert.equal(fake.deleted.length, 0, 'the account is kept');

  fake.settle('D1'); // Duplikium reports the figures a little later
  await m.refreshAll();
  const rec = m.getClientConnection('u1');
  assert.ok(rec && rec.isBrokerVerified && rec.equity === 520);
  assert.equal(m.pendingView('u1'), null);
  assert.deepEqual(events.newConn, ['u1']);
  assert.equal(fake.copier.get('D1'), 1);
});

test('a login that never works is given up on in the background and the account removed', async () => {
  const { fake, m } = setup({ fresh: { state: 'NONE', balance: null, equity: null, currency: '' } });
  await m.refreshAll();
  assert.equal(await code(m.provisionClientTerminal(creds(), () => {})), 'HANDED_OFF');
  fake.accounts.get('D1')!.state = 'DISCONNECTED';
  await m.refreshAll(); // starts the grace period
  await sleep(200);
  await m.refreshAll(); // grace over
  const v = m.pendingView('u1');
  assert.equal(v?.kind, 'failed');
  assert.equal(v?.error?.code, 'BROKER_AUTH_FAILED');
  assert.deepEqual(fake.deleted, ['D1']);
  // a new attempt replaces the old notice
  fake.fresh = { state: 'CONNECTED', balance: 500, equity: 520, freeMargin: 480, currency: 'USD' };
  await m.provisionClientTerminal(creds(), () => {});
  assert.equal(m.pendingView('u1'), null);
});

// ---------- pause, resume, unpaid ----------

test('pausing sets close-only (open trades still follow the master\'s closes) and resuming switches on', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  const paused = await m.setCopyStatus('u1', 'IDLE');
  assert.equal(paused!.status, 'IDLE');
  assert.equal(fake.copier.get('D1'), -1);
  const resumed = await m.setCopyStatus('u1', 'ACTIVE');
  assert.equal(resumed!.status, 'ACTIVE');
  assert.equal(fake.copier.get('D1'), 1);
});

test('if the service does not accept the change, the client\'s state is not changed and the caller is told', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  fake.ignoreStatusChange = true;
  await assert.rejects(m.setCopyStatus('u1', 'IDLE'));
  assert.equal(m.getClientConnection('u1')!.status, 'ACTIVE');
  fake.failSetSettings = true;
  await assert.rejects(m.setCopyStatus('u1', 'IDLE'));
  assert.equal(m.getClientConnection('u1')!.status, 'ACTIVE');
});

test('an unpaid client is held back (close-only) and released when paid', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  m.setBillingBlocked('u1', true);
  await sleep(30);
  assert.equal(fake.copier.get('D1'), -1);
  assert.equal(m.getActiveClients().length, 0);
  m.setBillingBlocked('u1', false);
  await sleep(30);
  assert.equal(fake.copier.get('D1'), 1);
  assert.equal(m.getActiveClients().length, 1);
});

test('a change that failed earlier is retried by the periodic check', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  fake.failSetSettings = true;
  m.setBillingBlocked('u1', true);
  await sleep(30);
  assert.equal(fake.copier.get('D1'), 1, 'the service still has copying on');
  fake.failSetSettings = false;
  await (m as any).reconcileCopyState(true);
  assert.equal(fake.copier.get('D1'), -1);
});

// ---------- disconnecting ----------

test('disconnect removes only this client\'s account and never the master or anyone else', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds('u1', '5551234'), () => {});
  await m.provisionClientTerminal(creds('u2', '5552222'), () => {});
  const r = await m.removeClientTerminal('u1');
  assert.equal(r.removed, 1);
  assert.deepEqual(fake.deleted, ['D1']);
  assert.ok(fake.accounts.has('MASTER') && fake.accounts.has('D2'));
  assert.equal(m.getClientConnection('u1'), undefined);
  assert.ok(m.getClientConnection('u2'));
});

test('if Duplikium cannot remove the account, the client is told and stays connected', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  fake.deleteAccount = async () => {
    throw new DuplikiumError('API', 'busy');
  };
  assert.equal(await code(m.removeClientTerminal('u1')), 'BROKER_UNREACHABLE');
  assert.ok(m.getClientConnection('u1'));
});

// ---------- live figures ----------

test('figures follow Duplikium on every read', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  fake.accounts.get('D1')!.equity = 777;
  fake.accounts.get('D1')!.balance = 700;
  await m.refreshAll();
  const rec = m.getClientConnection('u1')!;
  assert.equal(rec.equity, 777);
  assert.equal(rec.balance, 700);
  fake.accounts.get('D1')!.equity = null; // a figure that is not reported keeps the last real one
  await m.refreshAll();
  assert.equal(m.getClientConnection('u1')!.equity, 777);
});

test('a client whose login is refused later is shown as disconnected, not as connected', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  fake.accounts.get('D1')!.state = 'DISCONNECTED';
  await m.refreshAll();
  const rec = m.getClientConnection('u1')!;
  assert.equal(rec.connectionState, 'DISCONNECTED');
  assert.equal(rec.connectionStatus, 'DISCONNECTED');
  assert.ok(rec.errorMessage);
});

test('an account missing from three healthy reads is taken out of service; a bad read changes nothing', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  fake.failGetAccounts = true;
  for (let i = 0; i < 4; i++) await m.refreshAll();
  assert.ok(m.getClientConnection('u1'), 'unreadable list: nobody is removed');
  fake.failGetAccounts = false;
  fake.accounts.delete('D1');
  await m.refreshAll();
  await m.refreshAll();
  assert.ok(m.getClientConnection('u1'));
  await m.refreshAll();
  assert.equal(m.getClientConnection('u1'), undefined);
});

test('an empty or master-less list never removes anyone', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  fake.accounts.delete('MASTER');
  fake.accounts.delete('D1');
  for (let i = 0; i < 5; i++) await m.refreshAll();
  assert.ok(m.getClientConnection('u1'));
});

test('a single client can be refreshed on demand, but not more than every 15 seconds', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  const before = fake.calls.length;
  await m.refreshClientFromBroker('u1');
  assert.equal(fake.calls.length, before, 'just read, so no new call');
  m.getClientConnection('u1')!.lastSync = new Date(Date.now() - 60_000).toISOString();
  fake.accounts.get('D1')!.equity = 999;
  await m.refreshClientFromBroker('u1');
  assert.equal(m.getClientConnection('u1')!.equity, 999);
  assert.equal(await m.refreshClientFromBroker('nobody'), null);
});

// ---------- after a restart ----------

test('after a restart, clients are found again from their account names and keep their pause choice', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds('u1', '5551234'), () => {});
  await m.provisionClientTerminal(creds('u2', '5552222'), () => {});

  // a fresh process: same Duplikium, empty memory
  const m2 = Mt5ConnectionManager.forTests(fake, { masterId: 'MASTER', templateId: 'TEMPLATE' });
  const newConn: string[] = [];
  m2.onNewConnection = (u: string) => newConn.push(u);
  m2.wasVerified = async (_uid: string, accountId: string) => (accountId === 'D1' || accountId === 'D2' ? 'yes' : 'no');
  m2.loadSavedStatus = async (uid: string) => (uid === 'u2' ? 'IDLE' : 'ACTIVE');
  assert.equal(await m2.initialize(), true);

  assert.equal(m2.getClientConnection('u1')!.status, 'ACTIVE');
  assert.equal(m2.getClientConnection('u2')!.status, 'IDLE');
  assert.deepEqual(newConn, [], 'restoring is not a new connection');
  assert.equal(m2.getClientConnection('u2')!.accountId, 'D2');
  await sleep(30);
  assert.equal(fake.copier.get('D2'), -1, 'the paused client stays paused at the service');
  assert.equal(fake.copier.get('D1'), 1);
  assert.equal(m2.getMasterMetrics().balance, 10_000);
});

test('a returning client below the minimum equity is restored, not judged again', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  fake.accounts.get('D1')!.equity = 90;
  fake.accounts.get('D1')!.balance = 90;
  const m2 = Mt5ConnectionManager.forTests(fake, { masterId: 'MASTER', templateId: 'TEMPLATE' });
  m2.wasVerified = async () => 'yes';
  await m2.initialize();
  assert.equal(m2.getClientConnection('u1')!.equity, 90);
});

test('an account found at Duplikium that was never verified is finished as a new connection (or given up on)', async () => {
  const { fake, m } = setup({ fresh: { state: 'NONE', balance: null, equity: null, currency: '' } });
  await m.refreshAll();
  assert.equal(await code(m.provisionClientTerminal(creds(), () => {})), 'HANDED_OFF');
  fake.settle('D1');

  const m2 = Mt5ConnectionManager.forTests(fake, { masterId: 'MASTER', templateId: 'TEMPLATE' });
  const newConn: string[] = [];
  m2.onNewConnection = (u: string) => newConn.push(u);
  m2.wasVerified = async () => 'no';
  await m2.initialize();
  assert.ok(m2.getClientConnection('u1'));
  assert.deepEqual(newConn, ['u1']);
});

test('on a restart the master and other people\'s accounts are never adopted', async () => {
  const { fake } = setup();
  fake.accounts.set('H1', { ...fake.accounts.get('MASTER')!, accountId: 'H1', type: 'slave', name: 'Somebody added this by hand', login: '999' });
  const m2 = Mt5ConnectionManager.forTests(fake, { masterId: 'MASTER', templateId: 'TEMPLATE' });
  await m2.initialize();
  assert.equal(m2.getAllClientRecords().length, 0);
  assert.equal(fake.deleted.length, 0);
});

test('a client opening the dashboard before the restore finished is brought back on demand', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  const m2 = Mt5ConnectionManager.forTests(fake, { masterId: 'MASTER', templateId: 'TEMPLATE' });
  m2.wasVerified = async () => 'yes';
  const rec = await m2.restoreClientForUser('u1');
  assert.equal(rec?.accountId, 'D1');
  assert.equal(await m2.restoreClientForUser('stranger'), undefined);
});

// ---------- trades ----------

const pos = (id: string, side: 'BUY' | 'SELL' = 'BUY'): DuplikiumPosition => ({
  id, symbol: 'XAUUSD', side, volume: 0.1, openPrice: 2650, closePrice: null, stopLoss: null, takeProfit: null, profit: 5, commission: null, swap: null, openTime: '2026-10-30T08:00:00.000Z', closeTime: null, rawOpenTime: '2026-10-30 08:00:00',
});

test('the master\'s open trades are read from Duplikium and cached for a few seconds', async () => {
  const { fake, m } = setup();
  fake.openPositions.MASTER = [pos('t1'), pos('t2', 'SELL')];
  const a = await m.getMasterTrades();
  const b = await m.getMasterTrades();
  assert.equal(a.length, 2);
  assert.deepEqual(a[0], { id: 't1', symbol: 'XAUUSD', side: 'BUY', volume: 0.1, openPrice: 2650, openedAt: '2026-10-30T08:00:00.000Z' });
  assert.equal(b, a);
  assert.equal(fake.positionCalls, 1);
});

test('a client sees only their own trades', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds('u1', '5551234'), () => {});
  await m.provisionClientTerminal(creds('u2', '5552222'), () => {});
  fake.openPositions.D1 = [pos('mine')];
  fake.openPositions.D2 = [pos('theirs')];
  fake.closedPositions.D1 = [{ ...pos('old'), closePrice: 2660, closeTime: '2026-10-29T08:00:00.000Z' }];
  const t = await m.getClientTrades('u1');
  assert.deepEqual(t!.open.map((p) => p.id), ['mine']);
  assert.deepEqual(t!.closed.map((p) => p.id), ['old']);
  assert.equal(await m.getClientTrades('nobody'), null);
});

// ---------- administrator tools ----------

test('the admin list shows client accounts only, never the master', async () => {
  const { m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  const rows = await m.listCopierAccounts();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, 'u1');
  assert.equal(rows[0].live, true);
  assert.ok(!JSON.stringify(rows).includes('Secret-pw-1'));
});

test('removing a connected client needs a second, explicit confirmation; the master cannot be removed', async () => {
  const { fake, m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  assert.deepEqual(await m.removeCopierAccount('D1', false), { ok: false, reason: 'PROTECTED' });
  assert.deepEqual(await m.removeCopierAccount('MASTER', true), { ok: false, reason: 'NOT_A_CLIENT' });
  assert.deepEqual(await m.removeCopierAccount('NOPE', true), { ok: false, reason: 'NOT_FOUND' });
  assert.equal(fake.deleted.length, 0);
  assert.deepEqual(await m.removeCopierAccount('D1', true), { ok: true });
  assert.deepEqual(fake.deleted, ['D1']);
  assert.equal(m.getClientConnection('u1'), undefined);
});

test('the connection check says what it found at each step, without secrets', async () => {
  const { fake, m } = setup();
  process.env.DUPLIKIUM_API_USER = 'u';
  process.env.DUPLIKIUM_API_TOKEN = 'p';
  fake.openPositions.MASTER = [pos('t1')];
  const r = await m.runConnectionCheck();
  assert.ok(!JSON.stringify(r).includes('"p"'));
  const names = r.steps.map((s: any) => s.name);
  assert.ok(names.includes('Read accounts') && names.includes('Master account') && names.includes('Client template') && names.includes('Master open trades'));
  assert.equal(r.ok, true);
  const trades = r.steps.find((s: any) => s.name === 'Master open trades')!;
  assert.match(trades.detail, /1 open trade/);
  assert.match(trades.detail, /2026-10-30 08:00:00/, 'the time exactly as Duplikium sent it, so the time zone can be checked');
  // a master that is not connected fails the check
  fake.accounts.get('MASTER')!.state = 'DISCONNECTED';
  assert.equal((await m.runConnectionCheck()).ok, false);
  delete process.env.DUPLIKIUM_API_USER;
  delete process.env.DUPLIKIUM_API_TOKEN;
});

test('the connection check reports a failing step instead of hiding it', async () => {
  const { fake, m } = setup();
  fake.getOpenPositions = async () => {
    throw new DuplikiumError('API', 'positions not available');
  };
  const r = await m.runConnectionCheck();
  const t = r.steps.find((s: any) => s.name === 'Master open trades')!;
  assert.equal(t.ok, false);
  assert.match(t.detail, /positions not available/);
  assert.equal(r.ok, false);
});

test('capacity counts client accounts only', async () => {
  const { m } = setup();
  await m.refreshAll();
  await m.provisionClientTerminal(creds(), () => {});
  const c = await m.getCapacity();
  assert.equal(c.used, 1);
  assert.equal(c.perUserLimit, 1);
});

test('the connection check lists the accounts and templates to choose from, and still runs with the ids unset', async () => {
  const { fake, m } = setup();
  process.env.DUPLIKIUM_API_USER = 'u';
  process.env.DUPLIKIUM_API_TOKEN = 'p';
  fake.accounts.get('MASTER')!.groupId = 'TPL-7';
  fake.accounts.set('CL1', { ...fake.accounts.get('MASTER')!, accountId: 'CL1', name: 'CastimoFX Client u1 #1234', type: 'slave', groupId: 'TPL-7', login: '1234' });
  const r = await m.runConnectionCheck();
  const pick = r.steps.find((s: any) => s.name === 'Accounts you can choose from')!;
  assert.ok(pick.ok);
  assert.ok(pick.lines!.some((l: string) => l.startsWith('MASTER |')), 'the master is offered with its id');
  assert.ok(!pick.lines!.some((l: string) => l.includes('CastimoFX Client')), 'client accounts are not offered as a master');
  const tpl = r.steps.find((s: any) => s.name === 'Templates in use')!;
  assert.ok(tpl.lines!.some((l: string) => l.startsWith('TPL-7 |') && /1 client account/.test(l)));
  assert.ok(!JSON.stringify(r).includes('"p"'));

  // with no master or template id set, the check still lists choices and says what is missing
  (m as any).masterId = '';
  (m as any).templateId = '';
  const r2 = await m.runConnectionCheck();
  assert.ok(r2.steps.find((s: any) => s.name === 'Accounts you can choose from'));
  assert.match(r2.steps.find((s: any) => s.name === 'Master account')!.detail, /DUPLIKIUM_MASTER_ID is not set/);
  assert.match(r2.steps.find((s: any) => s.name === 'Client template')!.detail, /DUPLIKIUM_TEMPLATE_ID is not set/);
  assert.equal(r2.ok, false);
  delete process.env.DUPLIKIUM_API_USER;
  delete process.env.DUPLIKIUM_API_TOKEN;
});
