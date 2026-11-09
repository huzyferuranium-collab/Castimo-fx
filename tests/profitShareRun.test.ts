import test from 'node:test';
import assert from 'node:assert/strict';
import { DocExistsError } from '../src/backend/firestoreAdmin.ts';
import {
  upgradeLedger, settlementAllowed, tradeNet, readClosedTrades, mergeDay, sumTrades, dayKey, dayKeysBetween, realizedState, shareOn, settleRealized, dailyNoticeText,
} from '../src/backend/profitShareRealized.ts';
import {
  syncClosedTrades, settleClient, dailyUpdateFor, previousUtcDay, dailyWindowOpen,
} from '../src/backend/profitShareRun.ts';

const START = '2026-11-01T10:00:00.000Z';

type TestLedger = { userId: string; settledThrough?: string; pnlCum?: number; pnlHwm?: number; settleAfter?: string };

function pos(id: string, profit: number | null, closeTime: string | null, commission: number | null = null, swap: number | null = null): any {
  return { id, symbol: 'EURUSD', side: 'BUY', volume: 0.1, openPrice: 1, closePrice: 1, stopLoss: null, takeProfit: null, profit, commission, swap, openTime: null, closeTime, rawOpenTime: null };
}

class FakeStore {
  docs = new Map<string, any>();
  writes = 0;
  async getDoc(c: string, id: string) {
    const d = this.docs.get(`${c}/${id}`);
    return d ? structuredClone(d) : null;
  }
  async setDoc(c: string, id: string, data: Record<string, unknown>) {
    this.writes++;
    this.docs.set(`${c}/${id}`, structuredClone(data));
  }
  async createDoc(c: string, id: string, data: Record<string, unknown>) {
    if (this.docs.has(`${c}/${id}`)) throw new DocExistsError();
    this.writes++;
    this.docs.set(`${c}/${id}`, structuredClone(data));
  }
}

const ledger0 = () => ({ userId: 'u1', currency: 'USD', startEquity: 1000, hwm: 1000, settledThrough: START, createdAt: START });
const ctx = (nowIso: string) => ({ accountLogin: '5012345', equity: 1100, treasury: 'TTreasury', feePct: 50, now: new Date(nowIso) });

// ---------- pure parts ----------

test('a trade result is profit + commission + swap, and unknown profit is never guessed', () => {
  assert.equal(tradeNet({ profit: 120, commission: -2, swap: -1 }), 117);
  assert.equal(tradeNet({ profit: 10, commission: null, swap: null }), 10);
  assert.equal(tradeNet({ profit: -5.5, commission: -0.5, swap: 0 }), -6);
  assert.equal(tradeNet({ profit: null, commission: -2, swap: 0 }), null);
});

test('only trades closed after the ledger started are taken, grouped by GMT day', () => {
  const r = readClosedTrades(
    [pos('old', 999, '2026-11-01T09:00:00Z'), pos('exact', 5, START), pos('a', 10, '2026-11-02T23:59:59Z'), pos('b', 20, '2026-11-03T00:00:01Z')],
    START
  );
  assert.equal(r.counted, 2);
  assert.equal(r.unreadable, 0);
  assert.deepEqual([...r.byDay.keys()].sort(), ['20261102', '20261103']);
  assert.equal(r.byDay.get('20261102')!['a'].net, 10);
});

test('billing refuses to go on when a real trade in the answer could not be read, instead of leaving it out', async () => {
  const store = new FakeStore();
  const deps = { store, fetchClosed: async () => ({ positions: [pos('t1', 50, '2026-11-02T09:00:00Z')], skipped: 1, skippedTrades: 1 }) };
  const r = await syncClosedTrades(deps, 'u1', START);
  assert.equal(r.ok, false);
  assert.match(r.reason, /1 closed trade\(s\) could not be read/);
  assert.equal(store.writes, 0, 'nothing is stored or billed on a partial reading');
  // lines that are not trades (a deposit, say) do not stop billing
  const ok = await syncClosedTrades({ store, fetchClosed: async () => ({ positions: [pos('t1', 50, '2026-11-02T09:00:00Z')], skipped: 2, skippedTrades: 0 }) }, 'u1', START);
  assert.equal(ok.ok, true);
});

test('a trade closed after the start whose result or close time is unreadable is counted as unreadable', () => {
  const r = readClosedTrades([pos('x', null, '2026-11-02T10:00:00Z'), pos('y', 5, null), pos('before', null, '2026-10-30T10:00:00Z')], START);
  assert.equal(r.unreadable, 2); // the unreadable trade from before the start does not matter
  assert.equal(r.counted, 0);
});

test('merging never changes or doubles a trade that is already stored', () => {
  const first = mergeDay(null, { t1: { net: 10, closeTime: '2026-11-02T10:00:00.000Z' } });
  assert.equal(first.added, 1);
  const second = mergeDay(first.merged, { t1: { net: 999, closeTime: '2026-11-02T10:00:00.000Z' }, t2: { net: 5, closeTime: '2026-11-02T11:00:00.000Z' } });
  assert.equal(second.added, 1);
  assert.equal(second.merged.t1.net, 10);
  assert.equal(second.merged.t2.net, 5);
});

test('period sums include the end and exclude the start', () => {
  const day = {
    a: { net: 10, closeTime: '2026-11-02T10:00:00.000Z' },
    b: { net: 20, closeTime: '2026-11-03T10:00:00.000Z' },
    c: { net: 40, closeTime: '2026-11-04T10:00:00.000Z' },
  };
  assert.deepEqual(sumTrades([day], '2026-11-02T10:00:00.000Z', '2026-11-04T10:00:00.000Z'), { pnl: 60, trades: 2 });
  assert.deepEqual(sumTrades([day, null, undefined], '2026-11-01T00:00:00.000Z', '2026-11-05T00:00:00.000Z'), { pnl: 70, trades: 3 });
});

test('day keys', () => {
  assert.equal(dayKey('2026-11-02T23:59:59Z'), '20261102');
  assert.deepEqual(dayKeysBetween('2026-11-01T22:00:00Z', '2026-11-03T01:00:00Z'), ['20261101', '20261102', '20261103']);
  assert.deepEqual(dayKeysBetween('2026-11-03T00:00:00Z', '2026-11-01T00:00:00Z'), []);
});

test('50% of new profit; nothing while a loss is being recovered; the mark moves only when a fee is invoiced', () => {
  let s = realizedState({});
  let r = settleRealized(s, 147, 50);
  assert.deepEqual([r.gain, r.fee, r.invoiceable, r.next], [147, 73.5, true, { pnlCum: 147, pnlHwm: 147 }]);
  s = r.next;
  r = settleRealized(s, -40, 50);
  assert.deepEqual([r.gain, r.fee, r.invoiceable, r.next], [0, 0, false, { pnlCum: 107, pnlHwm: 147 }]);
  s = r.next;
  r = settleRealized(s, 30, 50); // 137: still below 147
  assert.equal(r.fee, 0);
  s = r.next;
  r = settleRealized(s, 70, 50); // 207: 60 above the mark
  assert.deepEqual([r.gain, r.fee, r.invoiceable, r.next], [60, 30, true, { pnlCum: 207, pnlHwm: 207 }]);
});

test('a fee under $1 rolls into the next period instead of being lost or billed as dust', () => {
  let r = settleRealized(realizedState({}), 1.5, 50);
  assert.equal(r.fee, 0.75);
  assert.equal(r.invoiceable, false);
  assert.deepEqual(r.next, { pnlCum: 1.5, pnlHwm: 0 });
  r = settleRealized(r.next, 1, 50);
  assert.equal(r.gain, 2.5);
  assert.equal(r.fee, 1.25);
  assert.equal(r.invoiceable, true);
});

test('bad numbers are refused', () => {
  assert.throws(() => shareOn({ pnlCum: 0, pnlHwm: 0 }, NaN, 50));
  assert.throws(() => shareOn({ pnlCum: 0, pnlHwm: 0 }, 10, 101));
  assert.deepEqual(realizedState({ pnlCum: NaN as any }), { pnlCum: 0, pnlHwm: 0 });
});

test('the daily text uses only the stored figures', () => {
  const base = { date: '2026-11-03', feePct: 50, periodPnl: 0, shareSoFarUsdt: 0, dayPnl: 0, dayTrades: 0 };
  assert.equal(dailyNoticeText({ ...base, dayTrades: 3, dayPnl: 38.2, periodPnl: 38.2, shareSoFarUsdt: 19.1, nextSettlementAt: '2026-11-08T10:00:00Z' }).message,
    'On 3 Nov (GMT) 3 trades closed: +$38.20. Your 50% share of the new profit so far this period is $19.10, invoiced around 8 Nov.');
  assert.equal(dailyNoticeText({ ...base, dayTrades: 1, dayPnl: -12, periodPnl: -12 }).message,
    'On 3 Nov (GMT) 1 trade closed: -$12.00. Nothing is due: any loss is recovered before a new share is charged.');
  assert.equal(dailyNoticeText(base).message, 'No trades closed on 3 Nov (GMT). Nothing is due yet.');
  assert.equal(dailyNoticeText(base).title, 'Profit Share update');
});

test('the daily run window opens at 00:15 GMT and reports the day before', () => {
  assert.equal(dailyWindowOpen(new Date('2026-11-03T00:14:59Z')), false);
  assert.equal(dailyWindowOpen(new Date('2026-11-03T00:15:00Z')), true);
  assert.equal(dailyWindowOpen(new Date('2026-11-03T18:00:00Z')), true);
  assert.equal(dayKey(previousUtcDay(new Date('2026-11-03T00:20:00Z'))), '20261102');
  assert.equal(dayKey(previousUtcDay(new Date('2026-11-01T05:00:00Z'))), '20261031');
  assert.equal(dayKey(previousUtcDay(new Date('2027-01-01T05:00:00Z'))), '20261231');
});

// ---------- the whole flow, with fakes ----------

test('syncing stores each closed trade once, however often it is repeated', async () => {
  const store = new FakeStore();
  const list = [pos('t1', 120, '2026-11-02T09:00:00Z'), pos('t2', -20, '2026-11-03T09:00:00Z', -2)];
  const deps = { store, fetchClosed: async () => ({ positions: list, skipped: 0 }) };
  const a = await syncClosedTrades(deps, 'u1', START);
  assert.deepEqual(a, { ok: true, reason: '', added: 2, skippedRows: 0 });
  const writes = store.writes;
  const b = await syncClosedTrades(deps, 'u1', START);
  assert.deepEqual(b, { ok: true, reason: '', added: 0, skippedRows: 0 });
  assert.equal(store.writes, writes); // nothing rewritten
});

test('syncing stores nothing when a trade cannot be read, or the service is unreachable, or there is no account', async () => {
  const store = new FakeStore();
  const bad = await syncClosedTrades({ store, fetchClosed: async () => ({ positions: [pos('t1', 50, '2026-11-02T09:00:00Z'), pos('t2', null, '2026-11-02T10:00:00Z')], skipped: 0 }) }, 'u1', START);
  assert.equal(bad.ok, false);
  assert.equal(store.docs.size, 0);
  const down = await syncClosedTrades({ store, fetchClosed: async () => { throw new Error('busy'); } }, 'u1', START);
  assert.equal(down.ok, false);
  const none = await syncClosedTrades({ store, fetchClosed: async () => null }, 'u1', START);
  assert.equal(none.ok, false);
  assert.equal(store.docs.size, 0);
});

test('three periods: invoice 50% of new profit, nothing while recovering, then invoice again above the old high', async () => {
  const store = new FakeStore();
  let all = [
    pos('before', 999, '2026-11-01T09:00:00Z'), // closed before the account was connected: never billed
    pos('t1', 120, '2026-11-02T09:00:00Z'),
    pos('t2', -20, '2026-11-03T09:00:00Z', -2),
    pos('t3', 50, '2026-11-05T09:00:00Z', null, -1),
  ];
  const deps = { store, fetchClosed: async () => ({ positions: all, skipped: 0 }) };

  // period 1: 120 + (-22) + 49 = 147 -> fee 73.50
  const o1 = await settleClient(deps, ledger0(), ctx('2026-11-08T10:00:00.000Z'));
  assert.equal(o1.kind, 'settled');
  if (o1.kind !== 'settled') return;
  assert.equal(o1.periodPnl, 147);
  assert.equal(o1.trades, 3);
  assert.ok(o1.invoice);
  assert.equal(o1.invoice!.amountDueUsdt, 73.5);
  assert.equal(o1.invoice!.grossProfit, 147);
  assert.equal(o1.invoice!.feePct, 50);
  assert.equal(o1.invoice!.flows, 0);
  assert.equal(o1.invoice!.basis, 'closed_trades');
  assert.equal(o1.invoice!.status, 'pending');
  assert.equal(o1.invoice!.dueAt, '2026-11-08T23:59:00.000Z', 'due before midnight GMT on the day it is made');
  assert.equal(o1.invoice!.periodStart, START);
  assert.equal(o1.invoice!.id, 'inv-u1-20261108-100000000');
  assert.deepEqual([o1.ledger.pnlCum, o1.ledger.pnlHwm, o1.ledger.settledThrough, o1.ledger.lastInvoiceId], [147, 147, '2026-11-08T10:00:00.000Z', 'inv-u1-20261108-100000000']);
  assert.ok(store.docs.get('profit_invoices/inv-u1-20261108-100000000'));
  assert.deepEqual(store.docs.get('client_ledgers/u1').pnlHwm, 147);

  // period 2: -100 + 60 = -40 -> nothing to pay, the high-water mark stays at 147
  all = [...all, pos('t4', -100, '2026-11-10T09:00:00Z'), pos('t5', 60, '2026-11-12T09:00:00Z')];
  const o2 = await settleClient(deps, o1.ledger, ctx('2026-11-15T10:00:00.000Z'));
  assert.equal(o2.kind, 'settled');
  if (o2.kind !== 'settled') return;
  assert.equal(o2.invoice, null);
  assert.equal(o2.periodPnl, -40);
  assert.deepEqual([o2.ledger.pnlCum, o2.ledger.pnlHwm], [107, 147]);
  assert.equal([...store.docs.keys()].filter((k) => k.startsWith('profit_invoices/')).length, 1);

  // period 3: +100 -> cumulative 207, which is 60 above the old high -> fee 30 (earlier profit is not billed twice)
  all = [...all, pos('t6', 100, '2026-11-18T09:00:00Z')];
  const o3 = await settleClient(deps, o2.ledger, ctx('2026-11-22T10:00:00.000Z'));
  assert.equal(o3.kind, 'settled');
  if (o3.kind !== 'settled') return;
  assert.equal(o3.invoice!.amountDueUsdt, 30);
  assert.equal(o3.invoice!.grossProfit, 60);
  assert.deepEqual([o3.ledger.pnlCum, o3.ledger.pnlHwm], [207, 207]);
});

test('a period that cannot be read is not billed and the ledger does not move', async () => {
  const store = new FakeStore();
  const deps = { store, fetchClosed: async () => ({ positions: [pos('t1', 100, '2026-11-02T09:00:00Z'), pos('t2', null, '2026-11-03T09:00:00Z')], skipped: 0 }) };
  const o = await settleClient(deps, ledger0(), ctx('2026-11-08T10:00:00.000Z'));
  assert.equal(o.kind, 'skipped');
  assert.equal(store.docs.size, 0);
});

test('running the same settlement twice cannot create a second invoice', async () => {
  const store = new FakeStore();
  const deps = { store, fetchClosed: async () => ({ positions: [pos('t1', 200, '2026-11-02T09:00:00Z')], skipped: 0 }) };
  const first = await settleClient(deps, ledger0(), ctx('2026-11-08T10:00:00.000Z'));
  const again = await settleClient(deps, ledger0(), ctx('2026-11-08T10:00:00.000Z')); // e.g. a restart before the ledger was saved
  assert.equal(first.kind, 'settled');
  assert.equal(again.kind, 'settled');
  assert.equal([...store.docs.keys()].filter((k) => k.startsWith('profit_invoices/')).length, 1);
  assert.equal(store.docs.get('profit_invoices/inv-u1-20261108-100000000').amountDueUsdt, 100);
});

test('money moved in or out of the account cannot change the bill (only closed trades are read)', async () => {
  const mk = (equity: number) => ({ store: new FakeStore(), fetchClosed: async () => ({ positions: [pos('t1', 80, '2026-11-02T09:00:00Z')], skipped: 3 }) , equity });
  const a = mk(1100);
  const b = mk(5000); // the client deposited a lot
  const oa = await settleClient(a, ledger0(), { ...ctx('2026-11-08T10:00:00.000Z'), equity: a.equity });
  const ob = await settleClient(b, ledger0(), { ...ctx('2026-11-08T10:00:00.000Z'), equity: b.equity });
  assert.equal(oa.kind === 'settled' && oa.invoice!.amountDueUsdt, 40);
  assert.equal(ob.kind === 'settled' && ob.invoice!.amountDueUsdt, 40);
});

test('daily update: the day, the period so far, and the share so far; written once', async () => {
  const store = new FakeStore();
  const deps = {
    store,
    fetchClosed: async () => ({
      positions: [pos('t1', 120, '2026-11-02T09:00:00Z'), pos('t2', -20, '2026-11-03T09:00:00Z', -2), pos('t3', 50, '2026-11-05T09:00:00Z')],
      skipped: 0,
    }),
  };
  const c = { feePct: 50, periodDays: 7, dayIso: '2026-11-03T12:00:00.000Z', now: new Date('2026-11-04T00:20:00Z') };
  assert.equal(await dailyUpdateFor(deps, ledger0(), c), 'created');
  const d = store.docs.get('ps_daily/u1_20261103');
  assert.equal(d.date, '2026-11-03');
  assert.equal(d.dayTrades, 1);
  assert.equal(d.dayPnl, -22);
  assert.equal(d.periodPnl, 98); // 120 - 22, up to the end of 3 Nov (the 5 Nov trade is not included yet)
  assert.equal(d.shareSoFarUsdt, 49);
  assert.equal(d.nextSettlementAt, '2026-11-08T10:00:00.000Z');
  assert.equal(d.userId, 'u1');
  const writes = store.writes;
  assert.equal(await dailyUpdateFor(deps, ledger0(), c), 'exists');
  assert.equal(store.writes, writes);
});

test('daily update: a quiet day still gets an update; days before the account was connected, or unreadable data, get none', async () => {
  const store = new FakeStore();
  const deps = { store, fetchClosed: async () => ({ positions: [pos('t1', 40, '2026-11-02T09:00:00Z')], skipped: 0 }) };
  const base = { feePct: 50, periodDays: 7, now: new Date('2026-11-04T00:20:00Z') };

  assert.equal(await dailyUpdateFor(deps, ledger0(), { ...base, dayIso: '2026-11-03T12:00:00.000Z' }), 'created');
  const quiet = store.docs.get('ps_daily/u1_20261103');
  assert.equal(quiet.dayTrades, 0);
  assert.equal(quiet.dayPnl, 0);
  assert.equal(quiet.periodPnl, 40);
  assert.equal(quiet.shareSoFarUsdt, 20);

  const early = await dailyUpdateFor(deps, ledger0(), { ...base, dayIso: '2026-10-31T12:00:00.000Z' });
  assert.equal(early, 'before_start');
  assert.equal(store.docs.has('ps_daily/u1_20261031'), false);

  const broken = { store, fetchClosed: async () => ({ positions: [pos('t9', null, '2026-11-02T20:00:00Z')], skipped: 0 }) };
  const out = await dailyUpdateFor(broken, ledger0(), { ...base, dayIso: '2026-11-02T12:00:00.000Z' });
  assert.ok(typeof out === 'object' && 'skipped' in out);
  assert.equal(store.docs.has('ps_daily/u1_20261102'), false);
});

test('a ledger from before closed-trade billing starts at 0 and waits 2 days for its first invoice; new ledgers are untouched', () => {
  const now = Date.parse('2026-11-10T10:00:00.000Z');
  const old: TestLedger = { userId: 'u1', settledThrough: START };
  const up = upgradeLedger(old, now);
  assert.equal(up.changed, true);
  assert.deepEqual([up.ledger.pnlCum, up.ledger.pnlHwm, up.ledger.settleAfter], [0, 0, '2026-11-12T10:00:00.000Z']);
  assert.equal(settlementAllowed(up.ledger, now), false);
  assert.equal(settlementAllowed(up.ledger, Date.parse('2026-11-12T09:59:59.000Z')), false);
  assert.equal(settlementAllowed(up.ledger, Date.parse('2026-11-12T10:00:00.000Z')), true);

  const fresh: TestLedger = { userId: 'u2', pnlCum: 0, pnlHwm: 0 };
  const same = upgradeLedger(fresh, now);
  assert.equal(same.changed, false);
  assert.equal(same.ledger, fresh);
  assert.equal(settlementAllowed(fresh, now), true);
  // upgrading twice does not push the date back
  assert.equal(upgradeLedger(up.ledger, now + 5 * 86_400_000).changed, false);
});

test('daily billing: no invoice until the new profit reaches 20 USD; smaller profit is carried forward, never lost', () => {
  let r = settleRealized(realizedState({}), 12.5, 50, 20);
  assert.equal(r.fee, 6.25);
  assert.equal(r.invoiceable, false, 'under 20 USD profit: no invoice, so copying is never paused for it');
  assert.deepEqual(r.next, { pnlCum: 12.5, pnlHwm: 0 });
  r = settleRealized(r.next, 7.5, 50, 20); // 20 USD of new profit in total
  assert.equal(r.gain, 20);
  assert.equal(r.fee, 10);
  assert.equal(r.invoiceable, true);
  assert.deepEqual(r.next, { pnlCum: 20, pnlHwm: 20 });
  r = settleRealized(r.next, 114.53, 50, 20);
  assert.deepEqual([r.gain, r.fee, r.invoiceable], [114.53, 57.27, true]);
});

test('pay now: previewShare shows the 50% due on closed trades without making an invoice; settling with the 20 USD minimum then invoices it', async () => {
  const { previewShare } = await import('../src/backend/profitShareRun.ts');
  const store = new FakeStore();
  const deps = { store, fetchClosed: async () => ({ positions: [pos('a', 57.67, '2026-11-02T12:47:43Z'), pos('b', 56.86, '2026-11-02T12:47:43Z', -0.5)], skipped: 0 }) };
  const p = await previewShare(deps, ledger0(), 50, new Date('2026-11-02T13:00:00.000Z'));
  assert.deepEqual(p, { ok: true, periodPnl: 114.03, trades: 2, gain: 114.03, fee: 57.02 });
  assert.equal([...store.docs.keys()].some((k) => k.startsWith('profit_invoices')), false, 'a preview makes no invoice');
  const o = await settleClient(deps, ledger0(), { ...ctx('2026-11-02T13:00:00.000Z'), minProfitUsd: 20 });
  assert.equal(o.kind, 'settled');
  if (o.kind === 'settled') assert.equal(o.invoice?.amountDueUsdt, 57.02);
});

test('pay now: under 20 USD of new profit the preview shows it but settling makes no invoice', async () => {
  const { previewShare } = await import('../src/backend/profitShareRun.ts');
  const store = new FakeStore();
  const deps = { store, fetchClosed: async () => ({ positions: [pos('a', 12, '2026-11-02T10:00:00Z')], skipped: 0 }) };
  const p = await previewShare(deps, ledger0(), 50, new Date('2026-11-02T13:00:00.000Z'));
  assert.equal(p.ok && p.fee, 6);
  const o = await settleClient(deps, ledger0(), { ...ctx('2026-11-02T13:00:00.000Z'), minProfitUsd: 20 });
  assert.equal(o.kind === 'settled' && o.invoice, null);
});

// ---------- settlements that are interrupted, or happen twice in a day ----------

/** A store whose first save of an invoice fails, as if the server stopped between the two writes. */
class FailFirstInvoiceStore extends FakeStore {
  failed = false;
  override async createDoc(c: string, id: string, data: Record<string, unknown>) {
    if (c === 'profit_invoices' && !this.failed) {
      this.failed = true;
      throw new Error('connection lost');
    }
    return super.createDoc(c, id, data);
  }
}

const invoicesIn = (store: FakeStore) => [...store.docs.entries()].filter(([k]) => k.startsWith('profit_invoices/')).map(([, v]) => v);

test('two settlements on the same day make two invoices: the second fee is not lost', async () => {
  const store = new FakeStore();
  let all = [pos('t1', 100, '2026-11-08T08:00:00Z')];
  const deps = { store, fetchClosed: async () => ({ positions: all, skipped: 0 }) };
  const o1 = await settleClient(deps, ledger0(), ctx('2026-11-08T09:00:00.000Z'));
  assert.equal(o1.kind, 'settled');
  if (o1.kind !== 'settled') return;
  assert.equal(o1.invoice!.amountDueUsdt, 50);

  all = [...all, pos('t2', 400, '2026-11-08T15:00:00Z')];
  const o2 = await settleClient(deps, o1.ledger, ctx('2026-11-08T16:00:00.000Z'));
  assert.equal(o2.kind, 'settled');
  if (o2.kind !== 'settled') return;
  assert.equal(o2.invoice!.amountDueUsdt, 200);
  assert.notEqual(o2.invoice!.id, o1.invoice!.id);
  const saved = invoicesIn(store).map((i) => i.amountDueUsdt).sort((a, b) => a - b);
  assert.deepEqual(saved, [50, 200], 'both invoices are stored');
  assert.deepEqual([o2.ledger.pnlCum, o2.ledger.pnlHwm], [500, 500]);
});

test('a settlement interrupted between its two saves is finished by the next run, never lost and never billed twice', async () => {
  const store = new FailFirstInvoiceStore();
  const deps = { store, fetchClosed: async () => ({ positions: [pos('t1', 200, '2026-11-02T09:00:00Z')], skipped: 0 }) };
  await assert.rejects(settleClient(deps, ledger0(), ctx('2026-11-08T10:00:00.000Z')));
  assert.equal(invoicesIn(store).length, 0, 'the invoice could not be saved');
  const stored = store.docs.get('client_ledgers/u1');
  assert.equal(stored.pendingInvoice.amountDueUsdt, 100, 'the ledger remembers the invoice it was moved on for');

  // The next run reads the stored ledger, even on the next day: it finishes that invoice instead of billing the profit again.
  const again = await settleClient(deps, await store.getDoc('client_ledgers', 'u1'), ctx('2026-11-09T10:00:00.000Z'));
  assert.equal(again.kind, 'settled');
  if (again.kind !== 'settled') return;
  assert.equal(again.invoice!.amountDueUsdt, 100);
  assert.equal(invoicesIn(store).length, 1);
  assert.equal(store.docs.get('client_ledgers/u1').pendingInvoice, undefined, 'the record is cleared');

  // And a later settlement with no new trades bills nothing more.
  const later = await settleClient(deps, await store.getDoc('client_ledgers', 'u1'), ctx('2026-11-10T10:00:00.000Z'));
  assert.equal(later.kind, 'settled');
  if (later.kind !== 'settled') return;
  assert.equal(later.invoice, null);
  assert.equal(invoicesIn(store).length, 1);
});

test('an interrupted invoice finished late gets a fresh due time; one finished in time keeps its own', async () => {
  const { finishPendingInvoice } = await import('../src/backend/profitShareRun.ts');
  const inv = (dueAt: string): any => ({ id: 'inv-u1-20261108-100000000', userId: 'u1', amountDueUsdt: 40, status: 'pending', dueAt, createdAt: '2026-11-08T10:00:00.000Z' });

  const late = new FakeStore();
  const a = await finishPendingInvoice(late, { ...ledger0(), pendingInvoice: inv('2026-11-08T23:59:00.000Z') } as any, new Date('2026-11-09T03:00:00.000Z'));
  assert.equal(a.invoice!.dueAt, '2026-11-09T23:59:00.000Z', 'past its recorded due time: due at the end of today instead');
  assert.equal(late.docs.get('profit_invoices/inv-u1-20261108-100000000').dueAt, '2026-11-09T23:59:00.000Z');

  const onTime = new FakeStore();
  const b = await finishPendingInvoice(onTime, { ...ledger0(), pendingInvoice: inv('2026-11-08T23:59:00.000Z') } as any, new Date('2026-11-08T10:05:00.000Z'));
  assert.equal(b.invoice!.dueAt, '2026-11-08T23:59:00.000Z');
  assert.equal(onTime.docs.get('client_ledgers/u1').pendingInvoice, undefined);
});

test('a different invoice already stored under the same id is never taken as "already saved": the pending record is kept', async () => {
  const { finishPendingInvoice } = await import('../src/backend/profitShareRun.ts');
  const store = new FakeStore();
  const mine: any = { id: 'inv-u1-20261108-100000000', userId: 'u1', amountDueUsdt: 40, status: 'pending', dueAt: '2026-11-08T23:59:00.000Z', createdAt: '2026-11-08T10:00:00.000Z' };
  store.docs.set('profit_invoices/inv-u1-20261108-100000000', { ...mine, amountDueUsdt: 25 }); // someone else's invoice, same id
  const ledger: any = { ...ledger0(), pendingInvoice: mine };
  store.docs.set('client_ledgers/u1', ledger);
  await assert.rejects(finishPendingInvoice(store, ledger, new Date('2026-11-08T10:05:00.000Z')));
  assert.equal(store.docs.get('client_ledgers/u1').pendingInvoice.amountDueUsdt, 40, 'the fee is kept, not dropped');
  assert.equal(store.docs.get('profit_invoices/inv-u1-20261108-100000000').amountDueUsdt, 25, 'the stored invoice is not overwritten');

  // The same invoice written by an earlier attempt still counts as done.
  const again = new FakeStore();
  again.docs.set('profit_invoices/inv-u1-20261108-100000000', { ...mine });
  const out = await finishPendingInvoice(again, ledger, new Date('2026-11-08T10:05:00.000Z'));
  assert.equal(out.invoice!.amountDueUsdt, 40);
  assert.equal(again.docs.get('client_ledgers/u1').pendingInvoice, undefined);
});

test('finishing late also gives an already-saved, unpaid invoice the fresh due time; a paid one is left alone', async () => {
  const { finishPendingInvoice } = await import('../src/backend/profitShareRun.ts');
  const recorded: any = { id: 'inv-u1-20261108-220000000', userId: 'u1', amountDueUsdt: 40, status: 'pending', dueAt: '2026-11-08T23:59:00.000Z', createdAt: '2026-11-08T22:00:00.000Z' };
  const lateNow = new Date('2026-11-09T03:00:00.000Z');

  // The interrupted run saved the invoice but stopped before clearing the ledger's record.
  const store = new FakeStore();
  store.docs.set(`profit_invoices/${recorded.id}`, { ...recorded });
  await finishPendingInvoice(store, { ...ledger0(), pendingInvoice: recorded } as any, lateNow);
  assert.equal(store.docs.get(`profit_invoices/${recorded.id}`).dueAt, '2026-11-09T23:59:00.000Z', 'the stored invoice gets the fresh due time');
  assert.equal(store.docs.get(`profit_invoices/${recorded.id}`).amountDueUsdt, 40);
  assert.equal(store.docs.get('client_ledgers/u1').pendingInvoice, undefined);

  // If the client had already paid it, nothing about it changes.
  const paidStore = new FakeStore();
  paidStore.docs.set(`profit_invoices/${recorded.id}`, { ...recorded, status: 'paid', paidAt: '2026-11-08T23:00:00.000Z' });
  await finishPendingInvoice(paidStore, { ...ledger0(), pendingInvoice: recorded } as any, lateNow);
  const paid = paidStore.docs.get(`profit_invoices/${recorded.id}`);
  assert.deepEqual([paid.status, paid.dueAt, paid.paidAt], ['paid', '2026-11-08T23:59:00.000Z', '2026-11-08T23:00:00.000Z'], 'the paid invoice is untouched');
  assert.equal(paidStore.docs.get('client_ledgers/u1').pendingInvoice, undefined, 'and the record is cleared');
});

test('previewShare writes nothing: new trades are held in memory only', async () => {
  const { previewShare } = await import('../src/backend/profitShareRun.ts');
  const store = new FakeStore();
  const deps = { store, fetchClosed: async () => ({ positions: [pos('t1', 60, '2026-11-02T09:00:00Z')], skipped: 0 }) };
  const p = await previewShare(deps, ledger0() as any, 50, new Date('2026-11-08T10:00:00.000Z'));
  assert.equal(p.ok && p.fee, 30);
  assert.equal(store.writes, 0);
  assert.equal(store.docs.size, 0);
});

// ---------- trades the copier reports late ----------

const fees = (store: FakeStore) => invoicesIn(store).map((i) => i.amountDueUsdt).sort((a, b) => a - b);

test('a loss the copier reports only after the settlement is counted in the next one (it lowers the next bill)', async () => {
  const store = new FakeStore();
  let all = [pos('t1', 300, '2026-11-08T08:00:00Z')];
  const deps = { store, fetchClosed: async () => ({ positions: all, skipped: 0 }) };
  const o1 = await settleClient(deps, ledger0(), ctx('2026-11-08T10:00:00.000Z')); // the -100 trade at 09:58 is not listed yet
  assert.equal(o1.kind === 'settled' && o1.invoice!.amountDueUsdt, 150);

  all = [...all, pos('late', -100, '2026-11-08T09:58:00Z'), pos('t2', 300, '2026-11-09T08:00:00Z')];
  const o2 = await settleClient(deps, await store.getDoc('client_ledgers', 'u1'), ctx('2026-11-09T10:00:00.000Z'));
  assert.equal(o2.kind, 'settled');
  if (o2.kind !== 'settled') return;
  assert.equal(o2.periodPnl, 200, '+300 today and the late -100');
  assert.equal(o2.trades, 2);
  assert.equal(o2.invoice!.amountDueUsdt, 100, '50% of 200, not of 300');
  assert.deepEqual(fees(store), [100, 150]);
});

test('a profit reported late is billed in the next settlement, and only once', async () => {
  const store = new FakeStore();
  let all = [pos('t1', 100, '2026-11-08T08:00:00Z')];
  const deps = { store, fetchClosed: async () => ({ positions: all, skipped: 0 }) };
  await settleClient(deps, ledger0(), ctx('2026-11-08T10:00:00.000Z')); // fee 50
  all = [...all, pos('late', 80, '2026-11-08T09:59:00Z')];
  const o2 = await settleClient(deps, await store.getDoc('client_ledgers', 'u1'), ctx('2026-11-09T10:00:00.000Z'));
  assert.equal(o2.kind === 'settled' && o2.invoice!.amountDueUsdt, 40);
  assert.deepEqual(await store.getDoc('ps_late', 'u1').then((d: any) => Object.keys(d?.trades ?? {})), [], 'it is off the late list');

  // Read again (it is still inside the look-back window): it is not counted a second time.
  const o3 = await settleClient(deps, await store.getDoc('client_ledgers', 'u1'), ctx('2026-11-10T10:00:00.000Z'));
  assert.equal(o3.kind === 'settled' && o3.invoice, null);
  assert.equal(o3.kind === 'settled' && o3.periodPnl, 0);
  assert.deepEqual(fees(store), [40, 50]);
});

test('before late-trade checking starts for a ledger, nothing older than its last settlement is read again', async () => {
  const store = new FakeStore();
  // A ledger settled before this change (no lateWatchFrom). An old trade it never stored must not be billed now.
  const old: any = { ...ledger0(), settledThrough: '2026-11-08T10:00:00.000Z', pnlCum: 0, pnlHwm: 0 };
  const deps = { store, fetchClosed: async () => ({ positions: [pos('old', 500, '2026-11-07T12:00:00Z'), pos('new', 40, '2026-11-08T12:00:00Z')], skipped: 0 }) };
  const o = await settleClient(deps, old, ctx('2026-11-09T10:00:00.000Z'));
  assert.equal(o.kind, 'settled');
  if (o.kind !== 'settled') return;
  assert.equal(o.periodPnl, 40, 'only the trade after the last settlement');
  assert.equal(o.ledger.lateWatchFrom, '2026-11-08T10:00:00.000Z', 'checking starts from here on');
  assert.equal(await store.getDoc('ps_late', 'u1'), null);
});

test('the look-back stops after 7 days', async () => {
  const store = new FakeStore();
  const start = '2026-11-01T00:00:00.000Z';
  const led: any = { ...ledger0(), createdAt: start, lateWatchFrom: start, settledThrough: '2026-11-20T10:00:00.000Z', pnlCum: 0, pnlHwm: 0 };
  const deps = { store, fetchClosed: async () => ({ positions: [pos('eightDays', 100, '2026-11-12T09:00:00Z'), pos('sixDays', 60, '2026-11-14T11:00:00Z')], skipped: 0 }) };
  const o = await settleClient(deps, led, ctx('2026-11-21T10:00:00.000Z'));
  assert.equal(o.kind === 'settled' && o.periodPnl, 60, 'a trade first seen 8 days after it closed is not picked up');
});

test('a settlement interrupted after counting late trades finishes without counting them twice', async () => {
  const store = new FailFirstInvoiceStore();
  let all = [pos('t1', 100, '2026-11-08T08:00:00Z')];
  const deps = { store, fetchClosed: async () => ({ positions: all, skipped: 0 }) };
  store.failed = true; // first settlement saves normally
  await settleClient(deps, ledger0(), ctx('2026-11-08T10:00:00.000Z')); // fee 50
  store.failed = false; // the next invoice save fails once
  all = [...all, pos('late', 60, '2026-11-08T09:59:00Z')];
  await assert.rejects(settleClient(deps, await store.getDoc('client_ledgers', 'u1'), ctx('2026-11-09T10:00:00.000Z')));
  const stuck: any = await store.getDoc('client_ledgers', 'u1');
  assert.deepEqual(stuck.pendingLateIds, ['late']);

  const again = await settleClient(deps, stuck, ctx('2026-11-09T10:10:00.000Z'));
  assert.equal(again.kind === 'settled' && again.invoice!.amountDueUsdt, 30, 'the interrupted invoice is finished');
  const later = await settleClient(deps, await store.getDoc('client_ledgers', 'u1'), ctx('2026-11-10T10:00:00.000Z'));
  assert.equal(later.kind === 'settled' && later.invoice, null, 'the late trade is not billed again');
  assert.deepEqual(fees(store), [30, 50]);
});

test('the preview includes a late trade and still writes nothing', async () => {
  const { previewShare } = await import('../src/backend/profitShareRun.ts');
  const store = new FakeStore();
  let all = [pos('t1', 100, '2026-11-08T08:00:00Z')];
  const deps = { store, fetchClosed: async () => ({ positions: all, skipped: 0 }) };
  await settleClient(deps, ledger0(), ctx('2026-11-08T10:00:00.000Z'));
  all = [...all, pos('late', -40, '2026-11-08T09:59:00Z'), pos('t2', 100, '2026-11-08T12:00:00Z')];
  const writes = store.writes;
  const p = await previewShare(deps, (await store.getDoc('client_ledgers', 'u1')) as any, 50, new Date('2026-11-08T13:00:00.000Z'));
  assert.equal(p.ok && p.periodPnl, 60);
  assert.equal(store.writes, writes);
});

test('a late trade is not lost if saving the late list fails', async () => {
  /** Fails the first save of the late list, as if the server stopped there. */
  class FailDayOnce extends FakeStore {
    armed = false;
    override async setDoc(c: string, id: string, data: Record<string, unknown>) {
      if (this.armed && c === 'ps_late') {
        this.armed = false;
        throw new Error('stopped');
      }
      return super.setDoc(c, id, data);
    }
  }
  const store = new FailDayOnce();
  let all = [pos('t1', 100, '2026-11-08T08:00:00Z')];
  const deps = { store, fetchClosed: async () => ({ positions: all, skipped: 0 }) };
  await settleClient(deps, ledger0(), ctx('2026-11-08T10:00:00.000Z')); // fee 50
  all = [...all, pos('late', 80, '2026-11-08T09:59:00Z')];
  store.armed = true;
  await assert.rejects(settleClient(deps, await store.getDoc('client_ledgers', 'u1'), ctx('2026-11-09T10:00:00.000Z')));

  const o = await settleClient(deps, await store.getDoc('client_ledgers', 'u1'), ctx('2026-11-09T10:05:00.000Z'));
  assert.equal(o.kind === 'settled' && o.invoice!.amountDueUsdt, 40, 'the late trade is still counted, once');
  const later = await settleClient(deps, await store.getDoc('client_ledgers', 'u1'), ctx('2026-11-10T10:00:00.000Z'));
  assert.equal(later.kind === 'settled' && later.invoice, null);
  assert.deepEqual(fees(store), [40, 50]);
});
