import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, PlusCircle, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import {
  AdminYieldPoolOverview,
  adminCompleteYieldPoolWithdrawal,
  adminGetYieldPoolOverview,
  adminManualCreditYieldAllocation,
  adminRejectYieldPoolWithdrawal,
  adminRunYieldPoolPayout,
} from '../../services/yieldPoolService';
import { Collapsible } from '../common/Collapsible';
import { formatGmt } from '../../utils/format';

export const AdminYieldPoolPanel: React.FC = () => {
  const [data, setData] = useState<AdminYieldPoolOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');

  const [payoutDateKey, setPayoutDateKey] = useState('');
  const [showCreditForm, setShowCreditForm] = useState(false);

  const [txById, setTxById] = useState<Record<string, string>>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  const [creditUserId, setCreditUserId] = useState('');
  const [creditAmount, setCreditAmount] = useState('500');
  const [creditTxHash, setCreditTxHash] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await adminGetYieldPoolOverview();
    if (res.ok && res.data) {
      setData(res.data);
      setError(null);
    } else {
      setError(res.error || 'Failed to load.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRunPayout = async () => {
    setBusyKey('sweep');
    setError(null);
    setNotice(null);
    const res = await adminRunYieldPoolPayout(payoutDateKey.trim() || undefined);
    setBusyKey('');
    if (!res.ok) {
      setError(res.error || 'Sweep failed.');
      return;
    }
    const d = res.data;
    setNotice(
      d?.skipped
        ? `${d.dateKey}: skipped (${d.reason || 'weekend'})`
        : `${d.dateKey}: +$${Number(d.totalDistributedUsdt || 0).toFixed(2)} (${d.creditedPositions || 0})`
    );
    void load();
  };

  const handleCompleteWithdrawal = async (id: string) => {
    setBusyKey(id);
    setError(null);
    setNotice(null);
    const res = await adminCompleteYieldPoolWithdrawal(id, txById[id] || '');
    setBusyKey('');
    if (!res.ok) {
      setError(res.error || 'Verification failed.');
      return;
    }
    setNotice('Payout verified.');
    setTxById((prev) => ({ ...prev, [id]: '' }));
    void load();
  };

  const handleRejectWithdrawal = async (id: string) => {
    setBusyKey(id);
    setError(null);
    setNotice(null);
    const res = await adminRejectYieldPoolWithdrawal(id, reasonById[id] || '');
    setBusyKey('');
    if (!res.ok) {
      setError(res.error || 'Rejection failed.');
      return;
    }
    setNotice('Rejected & refunded.');
    setReasonById((prev) => ({ ...prev, [id]: '' }));
    void load();
  };

  const handleManualCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyKey('credit');
    setError(null);
    setNotice(null);
    const res = await adminManualCreditYieldAllocation({
      userId: creditUserId.trim(),
      amountUsdt: Number(creditAmount),
      txHash: creditTxHash.trim() || undefined,
    });
    setBusyKey('');
    if (!res.ok) {
      setError(res.error || 'Credit failed.');
      return;
    }
    setNotice(`Credited $${Number(creditAmount).toFixed(2)} USDT.`);
    setCreditUserId('');
    setCreditTxHash('');
    setShowCreditForm(false);
    void load();
  };

  if (loading && !data) {
    return <p className="text-xs text-slate-400">Loading…</p>;
  }

  const pendingWithdrawals = (data?.withdrawals || []).filter((w) => w.status === 'pending');

  return (
    <div className="space-y-3">
      {/* PRIMARY ACTION BUTTONS */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busyKey === 'sweep'}
          onClick={handleRunPayout}
          className="keep-ink btn-gold col-span-2 sm:col-span-1 min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl font-display font-extrabold tracking-tight text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
        >
          <Play className="w-3.5 h-3.5 shrink-0" />
          <span>{busyKey === 'sweep' ? 'Running…' : 'Run 2% Payout'}</span>
        </button>

        <input
          type="text"
          value={payoutDateKey}
          onChange={(e) => setPayoutDateKey(e.target.value)}
          placeholder="YYYY-MM-DD"
          aria-label="Payout date override"
          className="w-full sm:w-28 min-h-[44px] sm:min-h-[40px] px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-base sm:text-xs font-mono text-white"
        />

        <button
          type="button"
          onClick={() => setShowCreditForm((v) => !v)}
          className="min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 font-display text-xs font-bold tracking-tight text-white flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <PlusCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Credit Position</span>
        </button>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="col-span-2 sm:col-span-1 min-h-[44px] sm:min-h-[40px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 font-display text-xs font-semibold tracking-tight text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 sm:ml-auto whitespace-nowrap"
        >
          <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      {/* MANUAL CREDIT BAR (ON DEMAND) */}
      {showCreditForm && (
        <form
          onSubmit={handleManualCredit}
          className="keep-border p-3 rounded-2xl bg-slate-900 border border-slate-700/80 flex flex-col sm:flex-row gap-2 text-xs"
        >
          <input
            type="text"
            required
            value={creditUserId}
            onChange={(e) => setCreditUserId(e.target.value)}
            placeholder="User UID"
            className="flex-1 min-h-[42px] px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs font-mono text-white"
          />
          <input
            type="number"
            inputMode="decimal"
            required
            min="200"
            step="0.01"
            value={creditAmount}
            onChange={(e) => setCreditAmount(e.target.value)}
            placeholder="USDT"
            className="w-full sm:w-28 min-h-[42px] px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs font-mono text-white"
          />
          <input
            type="text"
            value={creditTxHash}
            onChange={(e) => setCreditTxHash(e.target.value)}
            placeholder="TxID (opt)"
            className="flex-1 min-h-[42px] px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs font-mono text-white"
          />
          <button
            type="submit"
            disabled={busyKey === 'credit'}
            className="keep-ink btn-gold min-h-[44px] sm:min-h-[42px] px-4 py-2 rounded-xl font-display font-extrabold tracking-tight text-xs cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
          >
            {busyKey === 'credit' ? 'Saving…' : 'Confirm Credit'}
          </button>
        </form>
      )}

      {data && (
        <>
          {/* 4 COMPACT NUMBERS */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="keep-border p-3 rounded-xl bg-slate-900 border border-slate-700/80 min-w-0">
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 block">
                Capital
              </span>
              <span className="mt-1 block font-display text-base sm:text-lg font-extrabold tracking-tight tabular-nums text-white truncate">
                ${data.stats.totalActiveCapitalUsdt.toFixed(2)}
              </span>
            </div>
            <div className="keep-border p-3 rounded-xl bg-slate-900 border border-slate-700/80 min-w-0">
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 block">
                Wallet Due
              </span>
              <span className="mt-1 block font-display text-base sm:text-lg font-extrabold tracking-tight tabular-nums text-amber-400 truncate">
                ${data.stats.totalWalletLiabilityUsdt.toFixed(2)}
              </span>
            </div>
            <div className="keep-border p-3 rounded-xl bg-slate-900 border border-slate-700/80 min-w-0">
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 block">
                Paid
              </span>
              <span className="mt-1 block font-display text-base sm:text-lg font-extrabold tracking-tight tabular-nums text-emerald-400 truncate">
                ${data.stats.totalYieldPaidUsdt.toFixed(2)}
              </span>
            </div>
            <div className="keep-border p-3 rounded-xl bg-slate-900 border border-slate-700/80 min-w-0">
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 block">
                Pending Payouts
              </span>
              <span className="mt-1 block font-display text-base sm:text-lg font-extrabold tracking-tight tabular-nums text-white truncate">
                {pendingWithdrawals.length}
              </span>
            </div>
          </div>

          {/* PENDING WITHDRAWALS QUEUE (ONLY IF ANY PENDING) */}
          {pendingWithdrawals.length > 0 && (
            <div className="space-y-2">
              {pendingWithdrawals.map((w) => (
                <div
                  key={w.id}
                  className="keep-border p-3 rounded-xl bg-slate-900 border border-slate-700/80 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display font-extrabold tracking-tight tabular-nums text-sm text-white shrink-0">
                      ${Number(w.netAmount || w.amount).toFixed(2)}
                    </span>
                    <span className="font-mono text-slate-400 truncate">{w.recipientAddress}</span>
                    <span className="font-mono text-[11px] text-slate-500 shrink-0">{w.userId.slice(0, 8)}</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={txById[w.id] || ''}
                      onChange={(e) => setTxById((p) => ({ ...p, [w.id]: e.target.value }))}
                      placeholder="64-char TxID"
                      className="flex-1 min-h-[42px] sm:min-h-[36px] px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-base sm:text-xs font-mono text-white"
                    />
                    <button
                      type="button"
                      disabled={busyKey === w.id || (txById[w.id] || '').trim().length < 64}
                      onClick={() => void handleCompleteWithdrawal(w.id)}
                      className="keep-ink btn-gold min-h-[42px] sm:min-h-[36px] px-3 py-1.5 rounded-lg font-display font-extrabold tracking-tight text-xs cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
                    >
                      Verify &amp; Complete
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={reasonById[w.id] || ''}
                      onChange={(e) => setReasonById((p) => ({ ...p, [w.id]: e.target.value }))}
                      placeholder="Reject reason"
                      className="flex-1 min-h-[42px] sm:min-h-[36px] px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-base sm:text-xs text-white"
                    />
                    <button
                      type="button"
                      disabled={busyKey === w.id || !(reasonById[w.id] || '').trim()}
                      onClick={() => void handleRejectWithdrawal(w.id)}
                      className="btn-red min-h-[42px] sm:min-h-[36px] px-3 py-1.5 rounded-lg font-display font-bold tracking-tight text-xs cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
                    >
                      Reject &amp; Refund
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* POSITIONS & HISTORY COLLAPSIBLE */}
          <Collapsible
            adaptive
            title="Positions & Payout Log"
            summary={`${data.stats.activePositionsCount} active · ${data.withdrawals.length} withdrawals`}
            openLabel="Open"
            closeLabel="Hide"
          >
            <div className="space-y-3 pt-1">
              {data.positions.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-800 font-display text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <th className="py-2 pr-2">UID</th>
                        <th className="py-2 px-2">Capital</th>
                        <th className="py-2 px-2">Days</th>
                        <th className="py-2 px-2">Earned</th>
                        <th className="py-2 pl-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {data.positions.map((pos) => (
                        <tr key={pos.id} className="text-slate-200">
                          <td className="py-2 pr-2 truncate max-w-[110px]" title={pos.userId}>
                            {pos.userId}
                          </td>
                          <td className="py-2 px-2 font-display font-bold">${Number(pos.principalUsdt).toFixed(2)}</td>
                          <td className="py-2 px-2">
                            {pos.businessDaysCompleted}/{pos.termBusinessDays}
                          </td>
                          <td className="py-2 px-2 font-display font-bold text-emerald-400">+${Number(pos.totalEarnedUsdt).toFixed(2)}</td>
                          <td className="py-2 pl-2 text-right capitalize font-sans">{pos.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.withdrawals.length > 0 && (
                <div className="divide-y divide-slate-800/70">
                  {data.withdrawals.map((w) => (
                    <div key={w.id} className="py-2.5 flex items-center justify-between gap-2 text-xs min-h-[44px]">
                      <span className="font-display font-bold tabular-nums text-white shrink-0">
                        ${Number(w.netAmount || w.amount).toFixed(2)}
                      </span>
                      <span className="font-mono text-slate-400 truncate">{w.recipientAddress}</span>
                      <span className="text-[11px] text-slate-500 hidden sm:inline shrink-0">{formatGmt(w.createdAt)}</span>
                      <span className="capitalize text-[11px] text-slate-300 shrink-0">{w.status}</span>
                      {w.txHash && (
                        <a
                          href={`https://tronscan.org/#/transaction/${w.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-400 hover:underline inline-flex items-center p-1 shrink-0"
                          aria-label="Tronscan"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Collapsible>
        </>
      )}
    </div>
  );
};
