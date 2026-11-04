/**
 * Referral and withdrawal rules (pure functions, no I/O, unit-tested).
 *
 *  - Three levels. Level 1 earns 10%, level 2 earns 5%, level 3 earns 5% of what the referred client
 *    pays for the $100 Monthly Plan, ONCE per client (the first verified payment; renewals earn nothing). On top of that, EVERY real connected
 *    client, on either plan, earns the three referrers the weekly equity commission (see WEEKLY_EQUITY_RATES_PCT).
 *  - A withdrawal request must be at least $50 (gross). A 10% processing fee is taken from it.
 *  - Requests made before Friday 23:59 GMT join that week's cycle. Later ones join the next week's.
 *    GMT/UTC is the only clock used, and the server's time is the only time that counts.
 */

export const REFERRAL_RATES_PCT = [10, 5, 5] as const;

/**
 * Weekly equity commission (every real connected client, on either plan). The three referrers above a client earn these
 * percentages of that client's equity, ONCE A WEEK. The week is the trading week, Monday to Friday (UTC), and the equity
 * used is the one the copier service reports at the close of that week (Friday evening). Weekends have no trading and add
 * nothing. There is no monthly limit.
 */
export const WEEKLY_EQUITY_RATES_PCT = [3, 2, 1] as const;

/** Friday 22:00 UTC: the foreign-exchange week has closed (it closes at 21:00 or 22:00 UTC depending on the season). */
const WEEK_CLOSE_UTC_HOUR = 22;

/** The Monday (UTC) of the trading week a moment belongs to, as yyyymmdd. Saturday and Sunday belong to the week that just ended. */
export function tradingWeekKey(nowMs: number): string {
  const d = new Date(nowMs);
  const back = (d.getUTCDay() + 6) % 7; // days since Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
  return monday.toISOString().slice(0, 10).replace(/-/g, '');
}

/** True once the trading week has closed (Friday from 22:00 UTC, then Saturday and Sunday), when the weekly commission can be credited. */
export function isWeekCommissionTime(nowMs: number): boolean {
  const d = new Date(nowMs);
  const dow = d.getUTCDay();
  return dow === 6 || dow === 0 || (dow === 5 && d.getUTCHours() >= WEEK_CLOSE_UTC_HOUR);
}

/** The weekly equity commission for one client's closing equity: `chain[0]` is the direct referrer. */
export function weeklyEquityLines(chain: string[], equityUsd: number): CommissionLine[] {
  const out: CommissionLine[] = [];
  if (!Number.isFinite(equityUsd) || equityUsd <= 0) return out;
  for (let i = 0; i < Math.min(chain.length, WEEKLY_EQUITY_RATES_PCT.length); i++) {
    const amount = round2((equityUsd * WEEKLY_EQUITY_RATES_PCT[i]) / 100);
    if (amount <= 0 || !chain[i]) continue;
    out.push({ beneficiaryUid: chain[i], level: (i + 1) as 1 | 2 | 3, ratePct: WEEKLY_EQUITY_RATES_PCT[i], amountUsdt: amount });
  }
  return out;
}
export const WITHDRAW_MIN_USDT = 50;
export const WITHDRAW_FEE_PCT = 10;
export const PROCESSING_HOURS = 24;

export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'rejected' | 'failed';

/** Statuses in which the money is still held (reserved or already paid out). */
const HOLDING: WithdrawalStatus[] = ['pending', 'processing', 'completed'];

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeWithdrawal(gross: number, feePct = WITHDRAW_FEE_PCT): { gross: number; fee: number; net: number } {
  const g = round2(gross);
  const fee = round2((g * feePct) / 100);
  return { gross: g, fee, net: round2(g - fee) };
}

/**
 * The amount a commission is worked out from: the fee the client owed us (the Monthly Plan price, or the 50% profit-share
 * invoice), never more. If a client sends more than they owed, the extra does not earn commission. Never below zero.
 */
export function commissionBaseUsdt(owedUsdt: number, receivedUsdt?: number): number {
  const owed = Number(owedUsdt);
  if (!Number.isFinite(owed) || owed <= 0) return 0;
  const received = Number(receivedUsdt);
  return round2(Number.isFinite(received) && received > 0 ? Math.min(owed, received) : owed);
}

export interface CommissionLine {
  beneficiaryUid: string;
  level: 1 | 2 | 3;
  ratePct: number;
  amountUsdt: number;
}

/** `chain[0]` is the direct referrer, `chain[1]` their referrer, `chain[2]` the next one up. */
export function commissionLines(chain: string[], paidUsdt: number): CommissionLine[] {
  const out: CommissionLine[] = [];
  if (!Number.isFinite(paidUsdt) || paidUsdt <= 0) return out;
  for (let i = 0; i < Math.min(chain.length, REFERRAL_RATES_PCT.length); i++) {
    const amount = round2((paidUsdt * REFERRAL_RATES_PCT[i]) / 100);
    if (amount <= 0 || !chain[i]) continue;
    out.push({ beneficiaryUid: chain[i], level: (i + 1) as 1 | 2 | 3, ratePct: REFERRAL_RATES_PCT[i], amountUsdt: amount });
  }
  return out;
}

export function availableBalance(
  commissions: Array<{ amountUsdt: number }>,
  withdrawals: Array<{ status: string; gross: number }>
): { earned: number; held: number; available: number } {
  const earned = round2(commissions.reduce((s, c) => s + (Number(c.amountUsdt) || 0), 0));
  const held = round2(
    withdrawals.filter((w) => HOLDING.includes(w.status as WithdrawalStatus)).reduce((s, w) => s + (Number(w.gross) || 0), 0)
  );
  return { earned, held, available: round2(Math.max(0, earned - held)) };
}

/** The first Friday 23:59:00 UTC strictly after `nowMs`. */
export function weeklyCutoff(nowMs: number): number {
  const d = new Date(nowMs);
  const dow = d.getUTCDay(); // Friday = 5
  const thisFriday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 0) + ((5 - dow + 7) % 7) * 86_400_000;
  return thisFriday > nowMs ? thisFriday : thisFriday + 7 * 86_400_000;
}

export function processingWindow(nowMs: number): { cutoff: string; expectedBy: string } {
  const cutoff = weeklyCutoff(nowMs);
  return { cutoff: new Date(cutoff).toISOString(), expectedBy: new Date(cutoff + PROCESSING_HOURS * 3_600_000).toISOString() };
}

export function validateWithdrawAmount(raw: unknown, available: number): { ok: true; amount: number } | { ok: false; error: string } {
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Enter a valid amount.' };
  const amount = round2(n);
  if (Math.abs(amount - n) > 1e-9) return { ok: false, error: 'Use at most 2 decimal places.' };
  if (amount < WITHDRAW_MIN_USDT) return { ok: false, error: `The minimum withdrawal is $${WITHDRAW_MIN_USDT}.` };
  if (amount > available + 1e-9) return { ok: false, error: `You only have $${available.toFixed(2)} available.` };
  return { ok: true, amount };
}

const NEXT: Record<WithdrawalStatus, WithdrawalStatus[]> = {
  pending: ['processing', 'rejected', 'failed'],
  processing: ['completed', 'rejected', 'failed'],
  completed: [],
  rejected: [],
  failed: [],
};

export function canMoveStatus(from: WithdrawalStatus, to: WithdrawalStatus): boolean {
  return NEXT[from]?.includes(to) ?? false;
}

/** "Stephen Wisdom" -> "S***n". Used so public activity never shows a real name. */
export function maskName(name: unknown): string {
  const s = String(name ?? '').trim();
  if (!s) return 'A client';
  const chars = Array.from(s);
  return chars.length <= 2 ? `${chars[0]}***` : `${chars[0]}***${chars[chars.length - 1]}`;
}
