/**
 * Profit-share accounting (pure functions, no I/O, unit-tested).
 *
 * Invoices are made from closed trades (profitShareRealized.ts / profitShareRun.ts): the platform takes `feePct`
 * (default 50%) of NEW realised profit only, above the best result a fee has already been taken on, so losses are
 * recovered before anything is charged and deposits or withdrawals are never counted as profit. This file holds the
 * shared records and timing helpers.
 */

export const DEFAULT_FEE_PCT = 50;
/** A profit-share invoice must be paid within this many hours, or copying pauses until it is paid. */
export const DEFAULT_INVOICE_DUE_HOURS = 24;

import { round2 } from './referrals.ts';
export { round2 };

/** Stored per client in Firestore (`client_ledgers/{userId}`). */
export interface ClientLedger {
  userId: string;
  currency: string;
  startEquity: number;
  hwm: number;
  /** ISO time up to which deals and profit have been settled. */
  settledThrough: string;
  createdAt: string;
  lastInvoiceId?: string;
  /** True while an unpaid invoice is past its due time. */
  blocked?: boolean;
  /** Set when the client leaves profit share. A new ledger (fresh starting equity) is made if they return. */
  closed?: boolean;
  /**
   * Profit is billed on closed trades (see profitShareRealized.ts): the net result of all periods already settled, and
   * the best such figure a fee has been taken on. Ledgers made before this existed start both at 0.
   */
  pnlCum?: number;
  pnlHwm?: number;
  /** Set once on a ledger made before closed-trade billing existed: no invoice before this time (see profitShareRealized.ts). */
  settleAfter?: string;
}

export interface Invoice {
  id: string;
  userId: string;
  accountLogin: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  startHwm: number;
  flows: number;
  equityAtSettlement: number;
  grossProfit: number;
  feePct: number;
  amountDueUsdt: number;
  recipientAddress: string;
  status: 'pending' | 'paid';
  createdAt: string;
  dueAt: string;
  paidAt?: string;
  txHash?: string;
  /** USDT that actually arrived (may be up to the payment tolerance below the amount due). */
  amountReceivedUsdt?: number;
  confirmedBy?: string;
  /** 'closed_trades': billed on the net result of trades closed in the period. */
  basis?: 'closed_trades';
  periodTrades?: number;
  periodPnl?: number;
}

export function invoiceId(userId: string, periodEndIso: string): string {
  return `inv-${userId}-${periodEndIso.slice(0, 10).replace(/-/g, '')}`;
}

/** True once a whole settlement period has passed since the last one. */
export function isSettlementDue(settledThroughIso: string, nowMs: number, periodDays: number): boolean {
  const t = Date.parse(settledThroughIso);
  if (!Number.isFinite(t)) return false;
  return nowMs - t >= periodDays * 24 * 3600 * 1000;
}

export function isOverdue(invoice: Pick<Invoice, 'status' | 'dueAt'>, nowMs: number): boolean {
  return invoice.status === 'pending' && Date.parse(invoice.dueAt) <= nowMs;
}

/** Fees below this are rolled into the next period instead of billed (avoids dust invoices). */
export const MIN_INVOICE_USDT = 1;

/** No invoice is made until the new profit since the last invoice reaches this many USD (MIN_INVOICE_PROFIT_USD). Smaller profit is carried forward. */
export const DEFAULT_MIN_INVOICE_PROFIT_USD = 20;
