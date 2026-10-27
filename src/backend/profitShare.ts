/**
 * Profit-share accounting (pure functions, no I/O, unit-tested).
 *
 * Rule: the platform takes `feePct` (default 50%) of NEW profit only, measured on the client's
 * real broker equity against a high-water mark (HWM):
 *   - The HWM starts at the equity found when the account was first verified.
 *   - Deposits raise the HWM and withdrawals lower it, so moving money in or out is never
 *     counted as profit or loss.
 *   - Profit is charged only when equity is above the HWM, then the HWM moves up to equity.
 *     Losses are recovered before any new fee is charged.
 */

export const DEFAULT_FEE_PCT = 50;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** MetaTrader deal types that move money in or out of the account (they are not trading results). */
const FLOW_DEAL_TYPES = new Set([
  'DEAL_TYPE_BALANCE',
  'DEAL_TYPE_CREDIT',
  'DEAL_TYPE_CHARGE',
  'DEAL_TYPE_CORRECTION',
  'DEAL_TYPE_BONUS',
]);

export interface BrokerDeal {
  type?: string;
  profit?: unknown;
  time?: unknown;
}

/** Net money added (+) or removed (-) by the client, from the broker's own deal history. */
export function sumAccountFlows(deals: BrokerDeal[]): number {
  let total = 0;
  for (const d of deals || []) {
    if (!d || !FLOW_DEAL_TYPES.has(String(d.type))) continue;
    const p = Number(d.profit);
    if (Number.isFinite(p)) total += p;
  }
  return round2(total);
}

export interface SettlementInput {
  hwm: number;
  equity: number;
  /** Net deposits (+) and withdrawals (-) since the last settlement. */
  flows: number;
  feePct?: number;
}

export interface SettlementResult {
  adjustedHwm: number;
  gain: number;
  fee: number;
  newHwm: number;
}

export function computeSettlement(input: SettlementInput): SettlementResult {
  const feePct = input.feePct ?? DEFAULT_FEE_PCT;
  if (![input.hwm, input.equity, input.flows, feePct].every((n) => Number.isFinite(n))) {
    throw new Error('Settlement inputs must be finite numbers.');
  }
  if (input.equity < 0 || input.hwm < 0 || feePct < 0 || feePct > 100) {
    throw new Error('Settlement inputs are out of range.');
  }
  const adjustedHwm = round2(Math.max(0, input.hwm + input.flows));
  const gain = round2(Math.max(0, input.equity - adjustedHwm));
  const fee = round2((gain * feePct) / 100);
  const newHwm = round2(Math.max(adjustedHwm, input.equity));
  return { adjustedHwm, gain, fee, newHwm };
}

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
  confirmedBy?: string;
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
