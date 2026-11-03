/**
 * Castimofx income, worked out from real payment records only (pure functions, unit-tested).
 *
 * Three streams, all in USDT:
 *  - Monthly Plan: every verified subscription payment (`subscription_payments`).
 *  - 50% Profit Share: every profit-share invoice that has been paid (`profit_invoices`, status "paid").
 *  - Referral withdrawal fees: the fee on every referral withdrawal that was PAID OUT (`referral_withdrawals`, status "completed").
 *    A fee on a request that is still pending, or that was rejected or failed, is not income and is not counted.
 *
 * Figures are gross: referral commissions are not subtracted. What was paid out to referrers is shown separately.
 * Months are UTC calendar months ("YYYY-MM").
 */

export type Doc = Record<string, unknown>;

export interface IncomeStream {
  /** All-time income of this stream. */
  total: number;
  /** Income in the current UTC month. */
  thisMonth: number;
  /** Number of payments / paid invoices / paid-out withdrawals behind `total`. */
  count: number;
}

export interface IncomeMonth {
  month: string;
  subscriptions: number;
  profitShare: number;
  withdrawalFees: number;
  total: number;
}

export interface IncomeReport {
  generatedAt: string;
  subscriptions: IncomeStream;
  profitShare: IncomeStream & { awaitingPayment: number; awaitingCount: number };
  withdrawalFees: IncomeStream & { pendingFees: number; pendingCount: number };
  total: IncomeStream;
  /** Money sent to referrers (net of the fee): a cost, shown for information. */
  referralPayoutsSent: number;
  months: IncomeMonth[];
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const money = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function monthOf(iso: unknown): string | null {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 7);
}

/** The amount a paid invoice brought in: what actually arrived when it is recorded, otherwise the amount due. */
export function invoiceIncome(inv: Doc): number {
  const received = money(inv.amountReceivedUsdt);
  return received > 0 ? received : money(inv.amountDueUsdt);
}

export function computeIncome(
  subscriptionPayments: Doc[],
  invoices: Doc[],
  withdrawals: Doc[],
  now: Date = new Date(),
): IncomeReport {
  const thisMonthKey = now.toISOString().slice(0, 7);
  const byMonth = new Map<string, IncomeMonth>();
  const monthRow = (m: string): IncomeMonth => {
    let r = byMonth.get(m);
    if (!r) {
      r = { month: m, subscriptions: 0, profitShare: 0, withdrawalFees: 0, total: 0 };
      byMonth.set(m, r);
    }
    return r;
  };
  const stream = (): IncomeStream => ({ total: 0, thisMonth: 0, count: 0 });
  const add = (s: IncomeStream, amount: number, month: string | null) => {
    s.total += amount;
    s.count += 1;
    if (month === thisMonthKey) s.thisMonth += amount;
  };

  const subs = stream();
  for (const p of subscriptionPayments) {
    const amount = money(p.amountUsdt);
    if (amount <= 0) continue;
    const m = monthOf(p.at);
    add(subs, amount, m);
    if (m) monthRow(m).subscriptions += amount;
  }

  const ps = { ...stream(), awaitingPayment: 0, awaitingCount: 0 };
  for (const inv of invoices) {
    if (inv.status === 'paid') {
      const amount = invoiceIncome(inv);
      if (amount <= 0) continue;
      const m = monthOf(inv.paidAt ?? inv.createdAt);
      add(ps, amount, m);
      if (m) monthRow(m).profitShare += amount;
    } else if (inv.status === 'pending') {
      ps.awaitingPayment += money(inv.amountDueUsdt);
      ps.awaitingCount += 1;
    }
  }

  const fees = { ...stream(), pendingFees: 0, pendingCount: 0 };
  let payouts = 0;
  for (const w of withdrawals) {
    const fee = money(w.fee);
    if (w.status === 'completed') {
      payouts += money(w.net);
      if (fee <= 0) continue;
      const m = monthOf(w.updatedAt ?? w.requestedAt);
      add(fees, fee, m);
      if (m) monthRow(m).withdrawalFees += fee;
    } else if (w.status === 'pending' || w.status === 'processing') {
      fees.pendingFees += fee;
      fees.pendingCount += 1;
    }
  }

  const total: IncomeStream = {
    total: subs.total + ps.total + fees.total,
    thisMonth: subs.thisMonth + ps.thisMonth + fees.thisMonth,
    count: subs.count + ps.count + fees.count,
  };
  const months = [...byMonth.values()]
    .map((r) => ({
      month: r.month,
      subscriptions: round2(r.subscriptions),
      profitShare: round2(r.profitShare),
      withdrawalFees: round2(r.withdrawalFees),
      total: round2(r.subscriptions + r.profitShare + r.withdrawalFees),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
  const r2 = <T extends IncomeStream>(s: T): T => ({ ...s, total: round2(s.total), thisMonth: round2(s.thisMonth) });
  return {
    generatedAt: now.toISOString(),
    subscriptions: r2(subs),
    profitShare: { ...r2(ps), awaitingPayment: round2(ps.awaitingPayment) },
    withdrawalFees: { ...r2(fees), pendingFees: round2(fees.pendingFees) },
    total: r2(total),
    referralPayoutsSent: round2(payouts),
    months,
  };
}
