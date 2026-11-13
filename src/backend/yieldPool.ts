/**
 * Pure business rules and fixed-term math for the CastimoFX Yield Pool.
 *
 * Plan terms:
 *  - Fixed capital investment (minimum $200 USDT on TRON TRC20)
 *  - Fixed 2.0% daily return per business day (Monday to Friday UTC)
 *  - Fixed 100 business days term (+200% total return per position)
 */

export const DAILY_YIELD_RATE_PCT = 2.0;
export const TERM_BUSINESS_DAYS = 100;
export const MIN_ALLOCATION_USDT = 200;
export const MAX_ALLOCATION_USDT = 1_000_000;
export const MIN_WITHDRAWAL_USDT = 10;
export const DEPOSIT_TOLERANCE_USDT = 4;

export type YieldPositionStatus = 'active' | 'completed' | 'paused';

export interface YieldPositionRecord {
  id: string;
  userId: string;
  principalUsdt: number;
  dailyRatePct: number;
  dailyPayoutUsdt: number;
  businessDaysCompleted: number;
  termBusinessDays: number;
  totalEarnedUsdt: number;
  txHash: string;
  status: YieldPositionStatus;
  lastPayoutDate: string; // YYYY-MM-DD (UTC) or ''
  startedAt: string; // ISO string
  completedAt?: string;
  updatedAt: string;
}

export interface UserYieldAllocationSummary {
  userId: string;
  allocatedAmountUsdt: number;
  walletBalanceUsdt: number;
  totalYieldEarnedUsdt: number;
  dailyRatePct: number;
  businessDaysCompleted: number;
  termBusinessDays: number;
  activePositionsCount: number;
  status: 'active' | 'paused' | 'pending' | 'completed';
  lastDistributionAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Formats a Date (or ISO string) into UTC calendar date key "YYYY-MM-DD". */
export function utcDateKey(input: Date | string = new Date()): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toISOString().slice(0, 10);
}

/** Returns the UTC date key for yesterday (the session that closed at 00:00 UTC today). */
export function previousUtcDayKey(now: Date = new Date()): string {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return utcDateKey(prev);
}

/** True only Monday through Friday in UTC. Weekends (Sat=6, Sun=0) return false. */
export function isUtcBusinessDay(dateOrKey: Date | string = new Date()): boolean {
  const d =
    typeof dateOrKey === 'string'
      ? new Date(`${dateOrKey.slice(0, 10)}T12:00:00.000Z`)
      : dateOrKey;
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

/** Exact daily profit for a fixed principal position at 2.0% fixed daily rate. */
export function dailyYieldForPrincipal(principalUsdt: number, ratePct = DAILY_YIELD_RATE_PCT): number {
  if (!Number.isFinite(principalUsdt) || principalUsdt <= 0) return 0;
  return round2(principalUsdt * (ratePct / 100));
}

/** True when a position is eligible to receive its fixed 2% payout for `payoutDateKey`. */
export function canRunDailyPayoutForPosition(pos: YieldPositionRecord, payoutDateKey: string): boolean {
  if (pos.status !== 'active') return false;
  if (!isUtcBusinessDay(payoutDateKey)) return false;
  if (pos.businessDaysCompleted >= pos.termBusinessDays) return false;
  if (pos.lastPayoutDate === payoutDateKey) return false;
  const startedKey = utcDateKey(pos.startedAt);
  if (payoutDateKey < startedKey) return false;
  return true;
}

/** Computes aggregate user summary document from individual positions + preserved wallet balance. */
export function summarizeUserYield(
  userId: string,
  positions: YieldPositionRecord[],
  walletBalanceUsdt: number,
  opts?: { createdAt?: string; lastDistributionAt?: string; nowIso?: string }
): UserYieldAllocationSummary {
  const nowIso = opts?.nowIso || new Date().toISOString();
  const active = positions.filter((p) => p.status === 'active');
  const completed = positions.filter((p) => p.status === 'completed');

  const allocatedAmountUsdt = round2(active.reduce((sum, p) => sum + Number(p.principalUsdt || 0), 0));
  const totalYieldEarnedUsdt = round2(positions.reduce((sum, p) => sum + Number(p.totalEarnedUsdt || 0), 0));

  // Show progress of the active tranche closest to completion (or completed 100/100 if all finished)
  const businessDaysCompleted =
    active.length > 0
      ? Math.max(...active.map((p) => Math.min(TERM_BUSINESS_DAYS, Number(p.businessDaysCompleted || 0))))
      : completed.length > 0
      ? TERM_BUSINESS_DAYS
      : 0;

  const status: UserYieldAllocationSummary['status'] =
    active.length > 0 ? 'active' : completed.length > 0 ? 'completed' : 'pending';

  return {
    userId,
    allocatedAmountUsdt,
    walletBalanceUsdt: round2(Math.max(0, walletBalanceUsdt)),
    totalYieldEarnedUsdt,
    dailyRatePct: DAILY_YIELD_RATE_PCT,
    businessDaysCompleted,
    termBusinessDays: TERM_BUSINESS_DAYS,
    activePositionsCount: active.length,
    status,
    ...(opts?.lastDistributionAt ? { lastDistributionAt: opts.lastDistributionAt } : {}),
    createdAt: opts?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}
