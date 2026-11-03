/**
 * Profit Share on REALISED profit (pure functions, no I/O, unit-tested).
 *
 * Why closed trades and not account equity: the copier service does not give us a client's deposits and withdrawals,
 * and without them a deposit would be billed as profit. The result of a closed trade is never affected by money moving
 * in or out of the account, so deposits and withdrawals simply cannot count.
 *
 *  - Net result of a trade = profit + commission + swap, as the copier service reports it. A trade whose profit or close
 *    time cannot be read is never guessed: the period is not billed until every trade can be read.
 *  - Only trades closed after the client's ledger started (the moment the account was verified) count.
 *  - Cumulative realised profit is compared with its high-water mark (the best cumulative figure already billed).
 *    The platform takes `feePct` (default 50%) of the part ABOVE that mark, so losses are recovered before any new fee.
 *  - Open (floating) trades are not billed until they close.
 */
import { MIN_INVOICE_USDT, round2 } from './profitShare.ts';
import type { DuplikiumPosition } from './duplikiumClient.ts';

export interface StoredTrade {
  net: number;
  closeTime: string;
}
/** One UTC day of closed trades, keyed by the trade's id. A closed trade is final, so an id is stored once. */
export type DayTrades = Record<string, StoredTrade>;

/** 20250131 for an ISO time, in UTC (GMT is the only clock used). */
export function dayKey(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new Error('Not a valid time.');
  return new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
}

/** 20250131 -> 2025-01-31. */
export function dayKeyToDate(key: string): string {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

/** profit + commission + swap, or null when the profit itself was not reported. */
export function tradeNet(p: Pick<DuplikiumPosition, 'profit' | 'commission' | 'swap'>): number | null {
  if (p.profit === null || p.profit === undefined || !Number.isFinite(p.profit)) return null;
  const c = p.commission !== null && p.commission !== undefined && Number.isFinite(p.commission) ? p.commission : 0;
  const s = p.swap !== null && p.swap !== undefined && Number.isFinite(p.swap) ? p.swap : 0;
  return round2(p.profit + c + s);
}

export interface ReadTrades {
  /** New closed trades, grouped by the UTC day they closed on. */
  byDay: Map<string, DayTrades>;
  /** Trades that closed after `sinceIso` (or whose close time is unknown) but whose result could not be read. */
  unreadable: number;
  counted: number;
}

/** Picks out the closed trades that belong to a ledger that started at `sinceIso` (exclusive). */
export function readClosedTrades(positions: DuplikiumPosition[], sinceIso: string): ReadTrades {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) throw new Error('The ledger start time is not valid.');
  const out: ReadTrades = { byDay: new Map(), unreadable: 0, counted: 0 };
  for (const p of positions || []) {
    const closedAt = p.closeTime ? Date.parse(p.closeTime) : NaN;
    if (!Number.isFinite(closedAt)) {
      out.unreadable += 1; // cannot tell when it closed, so cannot tell which period it belongs to
      continue;
    }
    if (closedAt <= since) continue; // closed before this ledger started: not ours to bill
    const net = tradeNet(p);
    if (net === null) {
      out.unreadable += 1;
      continue;
    }
    const key = dayKey(p.closeTime as string);
    const day = out.byDay.get(key) ?? {};
    day[p.id] = { net, closeTime: new Date(closedAt).toISOString() };
    out.byDay.set(key, day);
    out.counted += 1;
  }
  return out;
}

/** Adds trades that are not stored yet. Trades already stored are left exactly as they were. */
export function mergeDay(existing: DayTrades | null | undefined, incoming: DayTrades): { merged: DayTrades; added: number } {
  const merged: DayTrades = { ...(existing ?? {}) };
  let added = 0;
  for (const [id, t] of Object.entries(incoming)) {
    if (merged[id]) continue;
    merged[id] = t;
    added += 1;
  }
  return { merged, added };
}

/** Net result and number of trades closed after `fromExclusiveIso` and up to and including `toInclusiveIso`. */
export function sumTrades(days: Array<DayTrades | null | undefined>, fromExclusiveIso: string, toInclusiveIso: string): { pnl: number; trades: number } {
  const from = Date.parse(fromExclusiveIso);
  const to = Date.parse(toInclusiveIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('The period is not valid.');
  let pnl = 0;
  let trades = 0;
  for (const day of days) {
    for (const t of Object.values(day ?? {})) {
      const at = Date.parse(t.closeTime);
      if (!Number.isFinite(at) || at <= from || at > to) continue;
      pnl += t.net;
      trades += 1;
    }
  }
  return { pnl: round2(pnl), trades };
}

/** The UTC day keys from the day of `fromIso` to the day of `toIso`, both included. */
export function dayKeysBetween(fromIso: string, toIso: string, maxDays = 400): string[] {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const keys: string[] = [];
  const start = Date.UTC(new Date(a).getUTCFullYear(), new Date(a).getUTCMonth(), new Date(a).getUTCDate());
  for (let t = start; t <= b && keys.length < maxDays; t += 86_400_000) keys.push(dayKey(new Date(t).toISOString()));
  return keys;
}

// ---------- the fee ----------

export interface RealizedState {
  /** Net realised result of every period already settled. */
  pnlCum: number;
  /** The best cumulative result a fee has already been taken on (or 0 at the start). */
  pnlHwm: number;
}

export function realizedState(ledger: { pnlCum?: number; pnlHwm?: number }): RealizedState {
  const cum = Number(ledger.pnlCum);
  const hwm = Number(ledger.pnlHwm);
  return { pnlCum: Number.isFinite(cum) ? cum : 0, pnlHwm: Number.isFinite(hwm) ? hwm : 0 };
}

export interface RealizedShare {
  cumAfter: number;
  gain: number;
  fee: number;
}

/** The fee that would be due if the period ended now. Changes nothing. */
export function shareOn(state: RealizedState, periodPnl: number, feePct: number): RealizedShare {
  if (![state.pnlCum, state.pnlHwm, periodPnl, feePct].every((n) => Number.isFinite(n)) || feePct < 0 || feePct > 100) {
    throw new Error('Settlement inputs are not valid.');
  }
  const cumAfter = round2(state.pnlCum + periodPnl);
  const gain = round2(Math.max(0, cumAfter - state.pnlHwm));
  return { cumAfter, gain, fee: round2((gain * feePct) / 100) };
}

export interface RealizedSettlement extends RealizedShare {
  /** True when the fee is big enough to invoice. A smaller fee rolls into the next period. */
  invoiceable: boolean;
  next: RealizedState;
}

/**
 * `minProfitUsd`: no invoice until the new profit (above the mark) reaches this much. Below it nothing is billed, so nothing can
 * become overdue and copying is never paused for it; the profit is carried forward and counts towards the next day.
 */
export function settleRealized(state: RealizedState, periodPnl: number, feePct: number, minProfitUsd = 0): RealizedSettlement {
  const s = shareOn(state, periodPnl, feePct);
  const invoiceable = s.fee >= MIN_INVOICE_USDT && s.gain >= (Number.isFinite(minProfitUsd) && minProfitUsd > 0 ? minProfitUsd : 0);
  return {
    ...s,
    invoiceable,
    // The mark only moves when a fee is really invoiced, so a small fee is not lost: it is part of the next period's gain.
    next: { pnlCum: s.cumAfter, pnlHwm: invoiceable ? round2(Math.max(state.pnlHwm, s.cumAfter)) : state.pnlHwm },
  };
}

// ---------- ledgers made before closed-trade billing ----------

/** Days a ledger from before closed-trade billing waits for its first invoice, so the daily updates can be compared with the copier service first. */
export const LEGACY_FIRST_INVOICE_GRACE_DAYS = 2;

/**
 * A ledger made when billing still used equity has no `pnlCum`. It starts counting closed trades from 0 (nothing was ever
 * invoiced under the old method) and may not be invoiced until the grace period has passed. New ledgers are unchanged.
 */
export function upgradeLedger<T extends { pnlCum?: number; pnlHwm?: number; settleAfter?: string }>(
  ledger: T,
  nowMs: number,
  graceDays = LEGACY_FIRST_INVOICE_GRACE_DAYS
): { ledger: T; changed: boolean } {
  if (ledger.pnlCum !== undefined && ledger.pnlCum !== null) return { ledger, changed: false };
  return {
    ledger: { ...ledger, pnlCum: 0, pnlHwm: 0, settleAfter: new Date(nowMs + graceDays * 86_400_000).toISOString() },
    changed: true,
  };
}

export function settlementAllowed(ledger: { settleAfter?: string }, nowMs: number): boolean {
  if (!ledger.settleAfter) return true;
  const t = Date.parse(ledger.settleAfter);
  return !Number.isFinite(t) || nowMs >= t;
}

// ---------- the daily update ----------

export interface DailyUpdate {
  /** The UTC day being reported, 2025-01-31. */
  date: string;
  dayPnl: number;
  dayTrades: number;
  /** Net realised result since the last invoice, up to the end of that day. */
  periodPnl: number;
  /** The client's share if the period ended now. */
  shareSoFarUsdt: number;
  feePct: number;
  /** About when the next invoice is made (ISO), or null. */
  nextSettlementAt?: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function prettyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''}`.trim();
}

function signed(n: number): string {
  return `${n < 0 ? '-' : '+'}$${Math.abs(n).toFixed(2)}`;
}

/** The text the client sees. Only the stored figures are used. */
export function dailyNoticeText(u: DailyUpdate): { title: string; message: string } {
  const day = prettyDate(u.date);
  const head =
    u.dayTrades === 0
      ? `No trades closed on ${day} (GMT).`
      : `On ${day} (GMT) ${u.dayTrades} ${u.dayTrades === 1 ? 'trade' : 'trades'} closed: ${signed(u.dayPnl)}.`;
  let tail: string;
  if (u.shareSoFarUsdt > 0) {
    tail = ` Your ${u.feePct}% share of the new profit so far this period is $${u.shareSoFarUsdt.toFixed(2)}`;
    tail += u.nextSettlementAt ? `, invoiced around ${prettyDate(u.nextSettlementAt)}.` : '.';
  } else if (u.periodPnl < 0) {
    tail = ' Nothing is due: any loss is recovered before a new share is charged.';
  } else {
    tail = ' Nothing is due yet.';
  }
  return { title: 'Profit Share update', message: head + tail };
}
