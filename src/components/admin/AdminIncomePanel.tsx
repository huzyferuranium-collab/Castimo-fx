import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { IncomeView, adminGetIncome } from '../../services/referralApi';

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = (m: string) => {
  const d = new Date(`${m}-01T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
};

const Card: React.FC<{ title: string; total: number; thisMonth: number; lines: string[]; accent?: boolean }> = ({ title, total, thisMonth, lines, accent }) => (
  <div className={`rounded-2xl border p-4 space-y-1.5 ${accent ? 'border-amber-500/40 bg-amber-500/10' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'}`}>
    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{title}</div>
    <div className="font-mono text-2xl font-extrabold text-slate-900 dark:text-white">{usd(total)}</div>
    <div className="text-xs text-slate-600 dark:text-slate-300">This month: <span className="font-mono font-bold">{usd(thisMonth)}</span></div>
    {lines.map((l) => (
      <div key={l} className="text-[11px] text-slate-500 dark:text-slate-400">{l}</div>
    ))}
  </div>
);

/** Castimofx's own income, in USDT, from real payment records: three streams and their total. */
export const AdminIncomePanel: React.FC = () => {
  const [income, setIncome] = useState<IncomeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await adminGetIncome();
    if (r.ok && r.data) {
      setIncome(r.data.income);
      setError(null);
    } else {
      setError(r.error || 'Could not load income.');
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!income) return <p className="text-xs text-slate-500">{error || 'Loading…'}</p>;
  const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Castimofx income</h3>
          <p className="text-xs text-slate-500">All figures are USDT actually received, from verified payment records. Months are GMT.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="text-xs text-slate-500 flex items-center gap-1 cursor-pointer shrink-0">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {error && <div className="p-3 rounded-xl text-xs bg-rose-500/10 border border-rose-500/30 text-rose-500">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card
          title="Monthly subscriptions"
          total={income.subscriptions.total}
          thisMonth={income.subscriptions.thisMonth}
          lines={[n(income.subscriptions.count, 'payment', 'payments')]}
        />
        <Card
          title="50% profit share"
          total={income.profitShare.total}
          thisMonth={income.profitShare.thisMonth}
          lines={[
            n(income.profitShare.count, 'paid invoice', 'paid invoices'),
            income.profitShare.awaitingCount > 0
              ? `${usd(income.profitShare.awaitingPayment)} still unpaid (${n(income.profitShare.awaitingCount, 'invoice', 'invoices')}), not counted`
              : 'No unpaid invoices',
          ]}
        />
        <Card
          title="Referral withdrawal charges"
          total={income.withdrawalFees.total}
          thisMonth={income.withdrawalFees.thisMonth}
          lines={[
            n(income.withdrawalFees.count, 'paid-out withdrawal', 'paid-out withdrawals'),
            income.withdrawalFees.pendingCount > 0
              ? `${usd(income.withdrawalFees.pendingFees)} on ${n(income.withdrawalFees.pendingCount, 'request', 'requests')} not paid out yet, not counted`
              : 'No withdrawals waiting',
          ]}
        />
      </div>

      <Card
        accent
        title="Total Castimofx income"
        total={income.total.total}
        thisMonth={income.total.thisMonth}
        lines={['Monthly subscriptions + 50% profit share + referral withdrawal charges']}
      />

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs text-slate-600 dark:text-slate-300 space-y-1">
        <div>
          Paid out to referrers so far (after the charge): <span className="font-mono font-bold">{usd(income.referralPayoutsSent)}</span>
        </div>
        <div className="text-[11px] text-slate-500">The total above is income before that money. Referral commissions are paid from it.</div>
      </div>

      {income.months.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="p-3">Month</th>
                <th className="p-3 text-right">Subscriptions</th>
                <th className="p-3 text-right">Profit share</th>
                <th className="p-3 text-right">Withdraw charges</th>
                <th className="p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {income.months.map((m) => (
                <tr key={m.month} className="border-t border-slate-200 dark:border-slate-800 font-mono">
                  <td className="p-3 font-sans font-semibold text-slate-900 dark:text-white">{monthName(m.month)}</td>
                  <td className="p-3 text-right">{usd(m.subscriptions)}</td>
                  <td className="p-3 text-right">{usd(m.profitShare)}</td>
                  <td className="p-3 text-right">{usd(m.withdrawalFees)}</td>
                  <td className="p-3 text-right font-bold text-slate-900 dark:text-white">{usd(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {income.months.length === 0 && <p className="text-xs text-slate-500">No payments have been received yet, so every figure is $0.00.</p>}
    </div>
  );
};
