/**
 * Referral and withdrawal rules (pure functions, no I/O, unit-tested).
 *
 *  - Three levels. Level 1 earns 5%, level 2 earns 3%, level 3 earns 2% of what the referred client
 *    ACTUALLY PAYS the platform (a paid profit-share invoice or a verified subscription payment).
 *  - A withdrawal request must be at least $50 (gross). A 10% processing fee is taken from it.
 *  - Requests made before Thursday 23:59 GMT join that week's cycle. Later ones join the next week's.
 *    GMT/UTC is the only clock used, and the server's time is the only time that counts.
 */

export const REFERRAL_RATES_PCT = [5, 3, 2] as const;
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

/** The first Thursday 23:59:00 UTC strictly after `nowMs`. */
export function weeklyCutoff(nowMs: number): number {
  const d = new Date(nowMs);
  const dow = d.getUTCDay(); // Thursday = 4
  const thisThursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 0) + ((4 - dow + 7) % 7) * 86_400_000;
  return thisThursday > nowMs ? thisThursday : thisThursday + 7 * 86_400_000;
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
