/**
 * Profit Share on realised profit: reading and storing closed trades, making the invoice, and the daily update.
 * All storage goes through `PsStore` and trades come through `FetchClosed`, so the whole flow is tested with fakes
 * (tests/profitShareRun.test.ts). billing.ts wires in Firestore and the copier service.
 *
 * Firestore collections (server-only; the browser rules refuse everything not listed):
 *   ps_days/{userId}_{YYYYMMDD}   the client's closed trades of one UTC day, one entry per trade id
 *   ps_daily/{userId}_{YYYYMMDD}  the daily update shown to the client (one per client per day, never changed)
 */
import { DocExistsError } from './firestoreAdmin.ts';
import type { PositionsResult } from './duplikiumClient.ts';
import type { ClientLedger, Invoice } from './profitShare.ts';
import { MIN_PAYMENT_WINDOW_MINUTES, invoiceDueAt, invoiceId, round2 } from './profitShare.ts';
import type { DayTrades } from './profitShareRealized.ts';
import {
  dayKey,
  dayKeyToDate,
  dayKeysBetween,
  mergeDay,
  readClosedTrades,
  realizedState,
  settleRealized,
  shareOn,
  sumTrades,
} from './profitShareRealized.ts';

export interface PsStore {
  getDoc(collection: string, id: string): Promise<Record<string, unknown> | null>;
  setDoc(collection: string, id: string, data: Record<string, unknown>): Promise<void>;
  /** Throws DocExistsError when the document is already there. */
  createDoc(collection: string, id: string, data: Record<string, unknown>): Promise<void>;
}

/** A client's closed trades from the copier service, or null when they have no connected account. May throw. */
export type FetchClosed = (userId: string) => Promise<PositionsResult | null>;

export interface RunDeps {
  store: PsStore;
  fetchClosed: FetchClosed;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------- reading and storing trades ----------

/** `reason` is empty when `ok`; `added` is the number of newly stored trades. (A flat shape, so it narrows the same under any compiler setting.) */
export interface SyncResult {
  ok: boolean;
  reason: string;
  added: number;
  skippedRows: number;
}

/** How many days back each read looks again for trades the copier reported only after they were settled. */
export const LATE_TRADE_LOOKBACK_DAYS = 7;

/**
 * Where a read of closed trades starts for this ledger: up to LATE_TRADE_LOOKBACK_DAYS before the last settlement, but never
 * before the ledger started or before late-trade checking began for it (`lateWatchFrom`; until then, the last settlement).
 */
export function lookbackFloor(ledger: Pick<ClientLedger, 'createdAt' | 'settledThrough' | 'lateWatchFrom'>): string {
  const settled = Date.parse(ledger.settledThrough);
  const watch = Date.parse(ledger.lateWatchFrom ?? ledger.settledThrough);
  const created = Date.parse(ledger.createdAt);
  const floor = Math.max(settled - LATE_TRADE_LOOKBACK_DAYS * 86_400_000, Number.isFinite(watch) ? watch : settled, Number.isFinite(created) ? created : -Infinity);
  return new Date(Math.min(floor, settled)).toISOString();
}

/** Trades that closed before the last settlement but were first seen after it: counted in the next settlement. */
async function loadLate(store: PsStore, userId: string): Promise<DayTrades> {
  const doc = await store.getDoc('ps_late', userId);
  return ((doc?.trades as DayTrades | undefined) ?? {}) as DayTrades;
}

async function addLate(store: PsStore, userId: string, found: DayTrades): Promise<void> {
  const { merged, added } = mergeDay(await loadLate(store, userId), found);
  if (added > 0) await store.setDoc('ps_late', userId, { userId, trades: merged, updatedAt: new Date().toISOString() });
}

async function clearLate(store: PsStore, userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const trades = await loadLate(store, userId);
  let removed = 0;
  for (const id of ids) {
    if (trades[id]) {
      delete trades[id];
      removed++;
    }
  }
  if (removed > 0) await store.setDoc('ps_late', userId, { userId, trades, updatedAt: new Date().toISOString() });
}

/**
 * Reads the client's closed trades and stores every one closed after `sinceIso` that is not stored yet.
 * Fails (and stores nothing) when any trade's result cannot be read, so a period is never billed on a guess.
 *
 * With `lateBeforeIso` (the last settlement), a trade stored here for the first time although it closed at or before that
 * moment was reported late by the copier: it was not part of that settlement, so it also goes on the late list, which the
 * next settlement counts.
 */
export async function syncClosedTrades(deps: RunDeps, userId: string, sinceIso: string, lateBeforeIso?: string): Promise<SyncResult> {
  let result: PositionsResult | null;
  try {
    result = await deps.fetchClosed(userId);
  } catch (e) {
    return { ok: false, reason: `the copier service could not be read (${msg(e)})`, added: 0, skippedRows: 0 };
  }
  if (!result) return { ok: false, reason: 'the account is not connected at the copier service', added: 0, skippedRows: 0 };

  // A row that names a symbol and a size is a real trade. If it could not be read at all (no id) it must not be left out
  // silently: the client is not billed until it can be read. Lines that are not trades (a deposit, say) are not counted here.
  if ((result.skippedTrades ?? 0) > 0) {
    return { ok: false, reason: `${result.skippedTrades} closed trade(s) could not be read (no trade id)`, added: 0, skippedRows: result.skipped };
  }
  const read = readClosedTrades(result.positions, sinceIso);
  if (read.unreadable > 0) {
    return { ok: false, reason: `${read.unreadable} closed trade(s) have no readable profit or close time`, added: 0, skippedRows: 0 };
  }

  const lateBefore = lateBeforeIso ? Date.parse(lateBeforeIso) : NaN;
  const late: DayTrades = {};
  const dayWrites: Array<{ id: string; key: string; merged: DayTrades }> = [];
  let added = 0;
  for (const [key, incoming] of read.byDay) {
    const id = `${userId}_${key}`;
    const doc = await deps.store.getDoc('ps_days', id);
    const existing = (doc?.trades as DayTrades | undefined) ?? null;
    const { merged, added: n } = mergeDay(existing, incoming);
    if (n > 0) {
      for (const [tradeId, t] of Object.entries(incoming)) {
        if (existing?.[tradeId]) continue;
        if (Number.isFinite(lateBefore) && Date.parse(t.closeTime) <= lateBefore) late[tradeId] = t;
      }
      dayWrites.push({ id, key, merged });
      added += n;
    }
  }
  // The late list is written BEFORE the days: if anything stops in between, the trade is not stored yet, so the next read
  // finds it new and late again (the list keeps one entry per trade id). The other order could store the trade without ever
  // putting it on the list. A settlement only goes on once all of this has succeeded.
  if (Object.keys(late).length > 0) await addLate(deps.store, userId, late);
  for (const w of dayWrites) {
    await deps.store.setDoc('ps_days', w.id, { userId, day: w.key, trades: w.merged, updatedAt: new Date().toISOString() });
  }
  return { ok: true, reason: '', added, skippedRows: result.skipped };
}

async function loadDays(store: PsStore, userId: string, fromIso: string, toIso: string): Promise<Array<DayTrades | null>> {
  const out: Array<DayTrades | null> = [];
  for (const key of dayKeysBetween(fromIso, toIso)) {
    const doc = await store.getDoc('ps_days', `${userId}_${key}`);
    out.push((doc?.trades as DayTrades | undefined) ?? null);
  }
  return out;
}

/** The trades of the open period: closed after the last settlement and up to `toIso`, plus the late list. */
async function periodTrades(store: PsStore, ledger: ClientLedger, toIso: string): Promise<{ pnl: number; trades: number; lateIds: string[] }> {
  const days = await loadDays(store, ledger.userId, ledger.settledThrough, toIso);
  const window = sumTrades(days, ledger.settledThrough, toIso);
  const late = await loadLate(store, ledger.userId);
  const lateIds = Object.keys(late);
  const latePnl = lateIds.reduce((t, id) => t + (Number(late[id]?.net) || 0), 0);
  return { pnl: round2(window.pnl + latePnl), trades: window.trades + lateIds.length, lateIds };
}

/** Reads and stores new trades for this ledger, looking back for late ones (see lookbackFloor). */
function syncFor(deps: RunDeps, ledger: ClientLedger): Promise<SyncResult> {
  return syncClosedTrades(deps, ledger.userId, lookbackFloor(ledger), ledger.settledThrough);
}

// ---------- settlement (the invoice) ----------

export interface SettleContext {
  accountLogin: string;
  /** Equity last reported for the account; shown on the invoice for information only. */
  equity: number;
  treasury: string;
  feePct: number;
  now: Date;
  /** No invoice until the new profit reaches this many USD (smaller profit is carried forward). */
  minProfitUsd?: number;
}

export type SettleOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'settled'; ledger: ClientLedger; invoice: Invoice | null; periodPnl: number; trades: number };

/**
 * Saves an invoice. "Already saved" counts as done only when the stored invoice is this same one (written by an earlier
 * attempt): same client, amount and creation time. A different invoice under the same id is an error, so the caller keeps
 * its pending record instead of dropping a fee.
 */
async function saveInvoice(store: PsStore, invoice: Invoice): Promise<void> {
  try {
    await store.createDoc('profit_invoices', invoice.id, invoice as unknown as Record<string, unknown>);
  } catch (e) {
    if (!(e instanceof DocExistsError)) throw e;
    const stored = (await store.getDoc('profit_invoices', invoice.id)) as Partial<Invoice> | null;
    const same = stored && stored.userId === invoice.userId && stored.createdAt === invoice.createdAt && Number(stored.amountDueUsdt) === Number(invoice.amountDueUsdt);
    if (!same) throw new Error(`Invoice id ${invoice.id} is already used by a different invoice; not overwriting it.`);
  }
}

/** The ledger without its pending records. */
function withoutPending(ledger: ClientLedger): ClientLedger {
  const { pendingInvoice: _done, pendingLateIds: _late, ...rest } = ledger;
  return rest;
}

/**
 * Finishes a settlement that was interrupted after its ledger was saved: saves the invoice it recorded and clears the record.
 * Returns the ledger as it now stands and the invoice that was finished (null when there was nothing to finish).
 *
 * If the invoice is finished so late that less than the normal payment window is left before its recorded due time, it gets
 * a fresh due time from `now` (as a new invoice would), so the client is never held back for an invoice they could not see.
 */
export async function finishPendingInvoice(store: PsStore, ledger: ClientLedger, now: Date = new Date()): Promise<{ ledger: ClientLedger; invoice: Invoice | null }> {
  const recorded = ledger.pendingInvoice;
  const lateIds = ledger.pendingLateIds ?? [];
  if (!recorded && lateIds.length === 0) return { ledger, invoice: null };
  // Late trades the ledger already counted come off the late list, so they are never counted again.
  await clearLate(store, ledger.userId, lateIds);
  if (!recorded) {
    const next = withoutPending(ledger);
    await store.setDoc('client_ledgers', ledger.userId, next as unknown as Record<string, unknown>);
    return { ledger: next, invoice: null };
  }
  const due = Date.parse(recorded.dueAt);
  const enoughTime = Number.isFinite(due) && due - now.getTime() >= MIN_PAYMENT_WINDOW_MINUTES * 60_000;
  const invoice: Invoice = enoughTime ? recorded : { ...recorded, dueAt: invoiceDueAt(now) };
  await saveInvoice(store, invoice);
  if (!enoughTime) {
    // The invoice may have been saved by the interrupted run with the old due time: if it is still unpaid and due sooner,
    // give it the fresh due time too, so the client is not held back the moment it is finished. A paid one is left alone.
    // Callers hold the client's billing lock, which payments and admin confirmations take too, so this read-then-write
    // cannot overwrite a payment made at the same moment.
    const stored = (await store.getDoc('profit_invoices', invoice.id)) as Partial<Invoice> | null;
    if (stored && stored.status === 'pending' && !(Date.parse(String(stored.dueAt)) >= Date.parse(invoice.dueAt))) {
      await store.setDoc('profit_invoices', invoice.id, { ...stored, dueAt: invoice.dueAt } as Record<string, unknown>);
    }
  }
  const next = withoutPending(ledger);
  await store.setDoc('client_ledgers', ledger.userId, next as unknown as Record<string, unknown>);
  return { ledger: next, invoice };
}

/**
 * Ends the period: stores any new trades, works out the 50% share of new profit, invoices it, and moves the ledger on.
 *
 * Order of writes: (1) the ledger, moved on and carrying the new invoice as `pendingInvoice`; (2) the invoice; (3) the ledger
 * again, without it. If anything stops after (1), the next settlement (or anyone reading the ledger through billing) finishes
 * (2) and (3) first, so the invoice is never lost and the same profit is never billed twice.
 */
export async function settleClient(deps: RunDeps, ledgerIn: ClientLedger, ctx: SettleContext): Promise<SettleOutcome> {
  // An earlier settlement that was interrupted is finished first, and is this call's result.
  const finished = await finishPendingInvoice(deps.store, ledgerIn, ctx.now);
  if (finished.invoice) {
    return { kind: 'settled', ledger: finished.ledger, invoice: finished.invoice, periodPnl: Number(finished.invoice.periodPnl ?? 0), trades: Number(finished.invoice.periodTrades ?? 0) };
  }
  const ledger = finished.ledger;
  const nowIso = ctx.now.toISOString();
  const sync = await syncFor(deps, ledger);
  if (!sync.ok) return { kind: 'skipped', reason: sync.reason };

  const { pnl, trades, lateIds } = await periodTrades(deps.store, ledger, nowIso);
  const state = realizedState(ledger);
  const r = settleRealized(state, pnl, ctx.feePct, ctx.minProfitUsd ?? 0);

  let lastInvoiceId = ledger.lastInvoiceId;
  let invoice: Invoice | null = null;
  if (r.invoiceable) {
    const id = invoiceId(ledger.userId, nowIso);
    invoice = {
      id,
      userId: ledger.userId,
      accountLogin: ctx.accountLogin,
      currency: 'USD',
      periodStart: ledger.settledThrough,
      periodEnd: nowIso,
      startHwm: state.pnlHwm,
      flows: 0, // closed trades are billed, so money paid in or out never enters the calculation
      equityAtSettlement: round2(Number.isFinite(ctx.equity) ? ctx.equity : 0),
      grossProfit: r.gain,
      feePct: ctx.feePct,
      amountDueUsdt: r.fee,
      recipientAddress: ctx.treasury,
      status: 'pending',
      createdAt: nowIso,
      dueAt: invoiceDueAt(ctx.now),
      basis: 'closed_trades',
      periodTrades: trades,
      periodPnl: pnl,
    };
    lastInvoiceId = id;
  }

  const next: ClientLedger = {
    ...ledger,
    pnlCum: r.next.pnlCum,
    pnlHwm: r.next.pnlHwm,
    settledThrough: nowIso,
    // Late-trade checking reaches back no further than the first settlement that used it.
    lateWatchFrom: ledger.lateWatchFrom ?? ledger.settledThrough,
    ...(lastInvoiceId ? { lastInvoiceId } : {}),
  };
  if (!invoice && lateIds.length === 0) {
    await deps.store.setDoc('client_ledgers', ledger.userId, next as unknown as Record<string, unknown>);
    return { kind: 'settled', ledger: next, invoice: null, periodPnl: pnl, trades };
  }
  // (1) the ledger with what is still to do recorded, (2) the late trades off their list, (3) the invoice, (4) the ledger
  // without the record. If anything stops after (1), finishPendingInvoice completes (2)-(4) next time.
  await deps.store.setDoc('client_ledgers', ledger.userId, {
    ...next,
    ...(invoice ? { pendingInvoice: invoice } : {}),
    ...(lateIds.length ? { pendingLateIds: lateIds } : {}),
  } as unknown as Record<string, unknown>);
  await clearLate(deps.store, ledger.userId, lateIds);
  if (invoice) await saveInvoice(deps.store, invoice);
  await deps.store.setDoc('client_ledgers', ledger.userId, next as unknown as Record<string, unknown>);
  return { kind: 'settled', ledger: next, invoice, periodPnl: pnl, trades };
}

// ---------- paying before the daily settlement ----------

export type PreviewOutcome =
  | { ok: false; reason: string }
  | { ok: true; periodPnl: number; trades: number; gain: number; fee: number };

/**
 * A store that reads through to `base` but keeps every write in memory. Views use it so they can run the same code as a
 * settlement without writing anything: only a settlement, holding the client's lock, may write trades or ledgers.
 */
export function readOnlyOverlay(base: PsStore): PsStore {
  const local = new Map<string, Record<string, unknown>>();
  const key = (c: string, id: string) => `${c}/${id}`;
  return {
    async getDoc(c, id) {
      const k = key(c, id);
      return local.has(k) ? structuredClone(local.get(k)!) : base.getDoc(c, id);
    },
    async setDoc(c, id, data) {
      local.set(key(c, id), structuredClone(data));
    },
    async createDoc(c, id, data) {
      if (local.has(key(c, id)) || (await base.getDoc(c, id))) throw new DocExistsError();
      local.set(key(c, id), structuredClone(data));
    },
  };
}

/**
 * Works out the 50% that would be due on the closed trades now. Writes nothing at all (new trades are only held in memory),
 * so it is safe to call from views outside the client's lock. Changes no ledger and makes no invoice.
 */
export async function previewShare(deps: RunDeps, ledger: ClientLedger, feePct: number, now: Date): Promise<PreviewOutcome> {
  deps = { ...deps, store: readOnlyOverlay(deps.store) };
  const sync = await syncFor(deps, ledger);
  if (!sync.ok) return { ok: false, reason: sync.reason };
  const { pnl, trades } = await periodTrades(deps.store, ledger, now.toISOString());
  const s = shareOn(realizedState(ledger), pnl, feePct);
  return { ok: true, periodPnl: pnl, trades, gain: s.gain, fee: s.fee };
}

// ---------- the daily update ----------

/** 'before_start': the account was connected after that day, so there is nothing to report (not a problem). */
export type DailyOutcome = 'created' | 'exists' | 'before_start' | { skipped: string };

/**
 * Writes the daily update for one UTC day (`dayIso` is any time inside it). Safe to call again: a day is written once.
 * Nothing is written when the trades could not be read, so the client is never shown a made-up figure.
 */
export async function dailyUpdateFor(
  deps: RunDeps,
  ledger: ClientLedger,
  ctx: { feePct: number; periodDays: number; dayIso: string; now: Date }
): Promise<DailyOutcome> {
  const key = dayKey(ctx.dayIso);
  const docId = `${ledger.userId}_${key}`;
  if (await deps.store.getDoc('ps_daily', docId)) return 'exists';
  if (key < dayKey(ledger.createdAt)) return 'before_start';

  const sync = await syncFor(deps, ledger);
  if (!sync.ok) return { skipped: sync.reason };

  const dayStart = `${dayKeyToDate(key)}T00:00:00.000Z`;
  const dayEnd = `${dayKeyToDate(key)}T23:59:59.999Z`;
  const dayDoc = await deps.store.getDoc('ps_days', docId);
  const dayTotals = sumTrades([(dayDoc?.trades as DayTrades | undefined) ?? null], new Date(Date.parse(dayStart) - 1).toISOString(), dayEnd);

  const period = await periodTrades(deps.store, ledger, dayEnd); // includes trades reported late
  const share = shareOn(realizedState(ledger), period.pnl, ctx.feePct);

  const nextAt = new Date(Date.parse(ledger.settledThrough) + ctx.periodDays * 86_400_000).toISOString();
  try {
    await deps.store.createDoc('ps_daily', docId, {
      userId: ledger.userId,
      date: dayKeyToDate(key),
      dayPnl: dayTotals.pnl,
      dayTrades: dayTotals.trades,
      periodPnl: period.pnl,
      shareSoFarUsdt: share.fee,
      feePct: ctx.feePct,
      periodStart: ledger.settledThrough,
      nextSettlementAt: nextAt,
      createdAt: ctx.now.toISOString(),
    });
  } catch (e) {
    if (e instanceof DocExistsError) return 'exists';
    throw e;
  }
  return 'created';
}

/** The UTC day before `now`, as an ISO time at noon (so any day-of-month maths is safe). */
export function previousUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12)).toISOString();
}

/** True from 00:15 GMT, when the previous day is complete and the copier service has settled its numbers. */
export function dailyWindowOpen(now: Date): boolean {
  return now.getUTCHours() > 0 || now.getUTCMinutes() >= 15;
}
