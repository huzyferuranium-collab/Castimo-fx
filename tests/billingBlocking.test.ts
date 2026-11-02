// The 24-hour watcher, end to end against PRETEND services: the real billing service and the real connection manager,
// a pretend Firestore and a pretend Duplikium. It proves our own wiring (invoice -> 24 hours -> copying held back at the
// copier service -> released on payment). It says nothing about the real Firestore, Duplikium or TRON.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { FakeCopier } from './helpers/fakeCopier.ts';

process.env.CONNECT_SYNC_WAIT_SECONDS = '1';
process.env.CONNECT_PROBE_MS = '20';
process.env.CONNECT_DISCONNECT_GRACE_MS = '150';
process.env.MAX_CLIENT_ACCOUNTS = '0';
process.env.TREASURY_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
delete process.env.INVOICE_DUE_HOURS;
delete process.env.SETTLEMENT_PERIOD_DAYS;
delete process.env.RESEND_API_KEY;

const { Mt5ConnectionManager } = await import('../src/backend/MT5_CONNECTION_MANAGER.ts');
const { BillingService, useBillingDbForTests } = await import('../src/backend/billing.ts');
const { DocExistsError } = await import('../src/backend/firestoreAdmin.ts');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

class FakeDb {
  docs = new Map<string, any>();
  async getDoc(c: string, id: string) {
    const d = this.docs.get(`${c}/${id}`);
    return d ? structuredClone(d) : null;
  }
  async setDoc(c: string, id: string, data: Record<string, unknown>) {
    this.docs.set(`${c}/${id}`, structuredClone(data));
  }
  async createDoc(c: string, id: string, data: Record<string, unknown>) {
    if (this.docs.has(`${c}/${id}`)) throw new DocExistsError();
    this.docs.set(`${c}/${id}`, structuredClone(data));
  }
  async queryEquals(c: string, field: string, value: string) {
    return [...this.docs.entries()].filter(([k, v]) => k.startsWith(`${c}/`) && v[field] === value).map(([, v]) => structuredClone(v));
  }
  async listAll(c: string) {
    return [...this.docs.entries()].filter(([k]) => k.startsWith(`${c}/`)).map(([, v]) => structuredClone(v));
  }
  isFirestoreAdminConfigured() {
    return true;
  }
  invoices(uid: string) {
    return [...this.docs.entries()].filter(([k, v]) => k.startsWith('profit_invoices/') && v.userId === uid).map(([, v]) => v);
  }
}

const creds = (userId: string, login: string) => ({ userId, login, password: 'Secret-pw-1', server: 'HFMarketsGlobal-Live20' });
const trade = (id: string, profit: number, closeTime: string): any => ({
  id, symbol: 'EURUSD', side: 'BUY', volume: 0.1, openPrice: 1, closePrice: 1, stopLoss: null, takeProfit: null,
  profit, commission: 0, swap: 0, openTime: null, closeTime, rawOpenTime: null,
});

/** Connected, copying clients on profit share, each with a ledger that started `ledgerAgeDays` ago. */
async function world(opts: { users?: Array<[string, string]>; ledgerAgeDays?: number } = {}) {
  const fake = new FakeCopier();
  const m = Mt5ConnectionManager.forTests(fake, { masterId: 'MASTER', templateId: 'TEMPLATE' });
  const db = new FakeDb();
  useBillingDbForTests(db as any);
  await m.refreshAll();
  const users = opts.users ?? [['u1', '5551234']];
  for (const [uid, login] of users) {
    await m.provisionClientTerminal(creds(uid, login), () => {});
    db.docs.set(`service_plans/${uid}`, { userId: uid, model: 'profit_share', selectedAt: new Date().toISOString() });
    const started = new Date(Date.now() - (opts.ledgerAgeDays ?? 0) * DAY).toISOString();
    db.docs.set(`client_ledgers/${uid}`, { userId: uid, currency: 'USD', startEquity: 520, hwm: 520, pnlCum: 0, pnlHwm: 0, settledThrough: started, createdAt: started });
  }
  const billing = BillingService.forTests(m);
  return { fake, m, db, billing };
}

test.afterEach(() => {
  mock.timers.reset();
  useBillingDbForTests(null);
});

test('an invoice made by billing holds copying back after exactly 24 hours, and payment releases it', async () => {
  const { fake, m, db, billing } = await world({ ledgerAgeDays: 10 });
  const t0 = Date.now();
  mock.timers.enable({ apis: ['Date'], now: t0 });
  // the client's account closed a +$200 trade during the period
  const closedAt = new Date(t0 - 5 * DAY).toISOString();
  fake.closedPositions['D1'] = [trade('t1', 200, closedAt)];

  await billing.sweep(); // period is up: 50% of $200 is invoiced
  const [inv] = db.invoices('u1');
  assert.ok(inv, 'an invoice was made');
  assert.equal(inv.amountDueUsdt, 100);
  assert.equal(inv.status, 'pending');
  assert.equal(Date.parse(inv.dueAt) - Date.parse(inv.createdAt), 24 * HOUR);
  await sleep(30);
  assert.equal(fake.copier.get('D1'), 1, 'copying stays on while the invoice is inside its 24 hours');

  mock.timers.setTime(t0 + 23 * HOUR + 59 * 60_000);
  await billing.sweep();
  await sleep(30);
  assert.equal(fake.copier.get('D1'), 1, 'still on at 23h59m');

  mock.timers.setTime(t0 + 24 * HOUR + 1000);
  await billing.sweep();
  await sleep(30);
  assert.equal(fake.copier.get('D1'), -1, 'after 24 hours copying is held back (close only) at the copier service');
  assert.equal(m.getActiveClients().length, 0);
  assert.equal(m.getClientConnection('u1')!.billingBlocked, true);

  await billing.adminConfirm('admin1', inv.id, 'paid from an exchange');
  await sleep(30);
  assert.equal(fake.copier.get('D1'), 1, 'paying releases copying straight away');
  assert.equal(m.getActiveClients().length, 1);
});

test('a client with no overdue invoice is never held back', async () => {
  const { fake, db, billing } = await world();
  db.docs.set('profit_invoices/inv-x', { id: 'inv-x', userId: 'u1', status: 'pending', amountDueUsdt: 30, dueAt: new Date(Date.now() + 2 * HOUR).toISOString() });
  db.docs.set('profit_invoices/inv-old', { id: 'inv-old', userId: 'u1', status: 'paid', amountDueUsdt: 30, dueAt: new Date(Date.now() - 5 * DAY).toISOString() });
  await billing.sweep();
  await sleep(30);
  assert.equal(fake.copier.get('D1'), 1);
});

test('a subscriber is never held back by a profit-share invoice', async () => {
  const { fake, db, billing } = await world();
  db.docs.set('service_plans/u1', { userId: 'u1', model: 'subscription', selectedAt: new Date().toISOString(), subscription: { periodEnd: new Date(Date.now() + 10 * DAY).toISOString() } });
  db.docs.set('profit_invoices/inv-x', { id: 'inv-x', userId: 'u1', status: 'pending', amountDueUsdt: 30, dueAt: new Date(Date.now() - 2 * HOUR).toISOString() });
  await billing.sweep();
  await sleep(30);
  assert.equal(fake.copier.get('D1'), 1);
});

test('holding back comes first in every sweep: a slow copier read for one client cannot delay it for another', async () => {
  const { fake, db, billing } = await world({ users: [['u1', '5551234'], ['u2', '5552222']], ledgerAgeDays: 10 });
  // u2 is overdue; u1 is first in line and its closed-trades read is slow
  db.docs.set('profit_invoices/inv-u2', { id: 'inv-u2', userId: 'u2', status: 'pending', amountDueUsdt: 40, dueAt: new Date(Date.now() - HOUR).toISOString() });
  fake.getClosedPositions = async () => {
    await sleep(400);
    return { positions: [], skipped: 0 };
  };
  let done = false;
  const sweep = billing.sweep().then(() => void (done = true));
  await sleep(120);
  assert.equal(done, false, 'the sweep is still busy with the slow read');
  assert.equal(fake.copier.get('D2'), -1, 'u2 was already held back');
  assert.equal(fake.copier.get('D1'), 1);
  await sweep;
});

test('after a restart an unpaid client is not given copying back, and a paid one keeps it', async () => {
  const { fake, m, db, billing } = await world({ users: [['u1', '5551234'], ['u2', '5552222']] });
  db.docs.set('profit_invoices/inv-u1', { id: 'inv-u1', userId: 'u1', status: 'pending', amountDueUsdt: 40, dueAt: new Date(Date.now() - HOUR).toISOString() });
  await billing.sweep();
  await sleep(30);
  assert.equal(fake.copier.get('D1'), -1);
  assert.equal(fake.copier.get('D2'), 1);

  const restart = async (hold: boolean) => {
    const m2 = Mt5ConnectionManager.forTests(fake, { masterId: 'MASTER', templateId: 'TEMPLATE' });
    m2.holdCopyingUntilBillingKnown = hold;
    m2.wasVerified = async () => 'yes';
    m2.loadSavedStatus = async () => 'ACTIVE';
    assert.equal(await m2.initialize(), true);
    await sleep(50);
    return m2;
  };

  // billing on: the start-up check leaves the unpaid client held back until billing has judged them
  const m2 = await restart(true);
  assert.equal(fake.copier.get('D1'), -1, 'still held back right after the restart');
  assert.equal(fake.copier.get('D2'), 1);
  const billing2 = BillingService.forTests(m2);
  await billing2.sweep();
  await sleep(50);
  assert.equal(fake.copier.get('D1'), -1, 'and still held back once billing has checked');
  assert.equal(fake.copier.get('D2'), 1);

  // paying afterwards releases them
  db.docs.set('profit_invoices/inv-u1', { id: 'inv-u1', userId: 'u1', status: 'paid', amountDueUsdt: 40, dueAt: new Date(Date.now() - HOUR).toISOString() });
  await billing2.sweep();
  await sleep(50);
  assert.equal(fake.copier.get('D1'), 1);
  m2.stop();

  // for contrast: without the hold, a restart switches the unpaid client's copying back on until billing speaks
  db.docs.set('profit_invoices/inv-u1', { id: 'inv-u1', userId: 'u1', status: 'pending', amountDueUsdt: 40, dueAt: new Date(Date.now() - HOUR).toISOString() });
  fake.copier.set('D1', -1);
  const m3 = await restart(false);
  assert.equal(fake.copier.get('D1'), 1, 'without the hold the restart gives copying back');
  m3.stop();
  m.stop();
});

test('the first check on start-up (before the first full sweep) already holds back an unpaid client', async () => {
  const { fake, db, m } = await world();
  db.docs.set('profit_invoices/inv-u1', { id: 'inv-u1', userId: 'u1', status: 'pending', amountDueUsdt: 40, dueAt: new Date(Date.now() - HOUR).toISOString() });
  const billing = BillingService.forTests(m);
  billing.start(); // runs the quick payment-standing pass straight away
  await sleep(80);
  assert.equal(fake.copier.get('D1'), -1);
  billing.stop();
});
