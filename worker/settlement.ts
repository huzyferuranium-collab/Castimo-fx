/**
 * Profit-share maths. Pure functions, no I/O, so they can be tested exhaustively.
 *
 * Model (what the website promises): the client keeps 50% of profit, the platform
 * takes 50% of NEW profit only. "New" is defined with a high-water mark (HWM) on the
 * account's cumulative realised result since copying started:
 *
 *   cumulative P/L  = sum of (profit + commission + swap) of all closed trade deals
 *   fee             = feeRate * max(0, cumulative P/L - HWM)
 *   HWM (after)     = max(HWM, cumulative P/L)   <- only advances when an invoice is ISSUED
 *
 * A client who loses money and then wins it back is therefore never charged twice for
 * the same profit, and deposits/withdrawals never count as profit.
 */
import { round2 } from './http';

export interface RawDeal {
  id: string;
  type: string;
  entryType?: string;
  profit?: number;
  commission?: number;
  swap?: number;
  symbol?: string;
  volume?: number;
  time: string;
}

const COUNTED_TYPES = new Set(['DEAL_TYPE_BUY', 'DEAL_TYPE_SELL']);

/** Only real buy/sell deals count. Deposits, withdrawals, credits and bonuses never do. */
export function isCountedDeal(d: Pick<RawDeal, 'type'>): boolean {
  return COUNTED_TYPES.has(d.type);
}

const USD_FACTORS: Record<string, number> = {
  USD: 1,
  USC: 0.01, // cent accounts report in US cents
};

export function supportedCurrency(currency: string): boolean {
  return Object.prototype.hasOwnProperty.call(USD_FACTORS, currency.toUpperCase());
}

export function toUsd(currency: string, amount: number): number {
  const f = USD_FACTORS[currency.toUpperCase()];
  if (f === undefined) throw new Error('unsupported currency ' + currency);
  return amount * f;
}

/** Realised result of one deal in USD (profit + commission + swap). */
export function dealPnlUsd(d: RawDeal, currency: string): number {
  const native = (d.profit ?? 0) + (d.commission ?? 0) + (d.swap ?? 0);
  return toUsd(currency, native);
}

export interface FeeInput {
  cumPnl: number; // USD
  hwm: number; // USD
  feeRate: number; // 0..1
  minInvoice: number; // USD; below this the fee is carried forward
}

export interface FeeResult {
  profitAboveHwm: number;
  fee: number;
  hwmAfter: number;
  due: boolean;
}

export function computeFee(input: FeeInput): FeeResult {
  const { cumPnl, hwm, feeRate, minInvoice } = input;
  const profitAboveHwm = round2(Math.max(0, cumPnl - hwm));
  const fee = round2(profitAboveHwm * feeRate);
  const due = fee > 0 && fee >= minInvoice;
  return {
    profitAboveHwm,
    fee,
    // The HWM only moves forward when the invoice is actually issued (see ledger).
    hwmAfter: due ? Math.max(hwm, cumPnl) : hwm,
    due,
  };
}

/** Invoices that were issued more than `graceDays` ago and are still unpaid. */
export function isOverdue(issuedAtIso: string, now: Date, graceDays: number): boolean {
  const issued = Date.parse(issuedAtIso);
  if (!Number.isFinite(issued)) return false;
  return now.getTime() - issued > graceDays * 24 * 60 * 60 * 1000;
}
