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
import { formatGmt } from '../../utils/format';

/**
 * Admin Yield Pool operations console:
 *  - Live liability / active capital metrics
 *  - Manual or backfill trigger for Mon–Fri 2.0% daily payouts
 *  - Pending TRC20 withdrawal fulfillment (verified against TronGrid) or rejection with automatic refund
 *  - Manual capital allocation credit (e.g. out-of-band / exchange batch payments)
 */
export const AdminYieldPoolPanel: React.FC = () => {
  const [data, setData] = useState<AdminYieldPoolOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');

  // Payout sweep control
  const [payoutDateKey, setPayoutDateKey] = useState('');

  // Withdrawal inputs per ledger ID
  const [txById, setTxById] = useState<Record<string, string>>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  // Manual credit form
  const [creditUserId, setCreditUserId] = useState('');
  const [creditAmount, setCreditAmount] = useState('500');
  const [creditTxHash, setCreditTxHash] = useState('');
  const [creditNote, setCreditNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await adminGetYieldPoolOverview();
    if (res.ok && res.data) {
      setData(res.data);
      setError(null);
    } else {
      setError(res.error || 'Could not load Yield Pool overview.');
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
      setError(res.error || 'Daily payout sweep failed.');
      return;
    }
    const d = res.data;
    if (d?.skipped) {
      setNotice(`Payout skipped for ${d.dateKey}: ${d.reason || 'not a business day'}`);
    } else {
      setNotice(
        `Payout completed for ${d.dateKey}: credited $${Number(d.totalDistributedUsdt || 0).toFixed(2)} across ${d.creditedPositions || 0} position(s).`
      );
    }
    void load();
  };

  const handleCompleteWithdrawal = async (id: string) => {
    setBusyKey(id);
    setError(null);
    setNotice(null);
    const res = await adminCompleteYieldPoolWithdrawal(id, txById[id] || '');
    setBusyKey('');
    if (!res.ok) {
      setError(res.error || 'Could not verify payout transaction on TRON.');
      return;
    }
    setNotice('Withdrawal verified on TronGrid and marked completed.');
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
      setError(res.error || 'Could not reject withdrawal.');
      return;
    }
    setNotice('Withdrawal rejected and USDT refunded to client wallet.');
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
      note: creditNote.trim() || undefined,
    });
    setBusyKey('');
    if (!res.ok) {
      setError(res.error || 'Failed to credit fixed 2% position.');
      return;
    }
    setNotice(`Credited $${Number(creditAmount).toFixed(2)} USDT 100-day position for user ${creditUserId.trim()}.`);
    setCreditUserId('');
    setCreditTxHash('');
    setCreditNote('');
    void load();
  };

  if (loading && !data) {
    return <p className="text-xs text-slate-400">Loading Yield Pool operations…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white">Yield Pool Operations (2.0% Mon–Fri × 100d)</h3>
          <p className="text-xs text-slate-400">
            Treasury: <span className="font-mono text-emerald-400">{data?.treasuryAddress || 'Not configured'}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      {data && (
        <>
          {/* Overview Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">Active Capital</span>
              <span className="text-base font-mono font-bold text-white">
                ${data.stats.totalActiveCapitalUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">Wallet Liability</span>
              <span className="text-base font-mono font-bold text-amber-400">
                ${data.stats.totalWalletLiabilityUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">Total Yield Paid</span>
              <span className="text-base font-mono font-bold text-emerald-400">
                ${data.stats.totalYieldPaidUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">Active Positions</span>
              <span className="text-base font-mono font-bold text-white">
                {data.stats.activePositionsCount}{' '}
                <span className="text-[11px] text-slate-500 font-normal">
                  ({data.stats.completedPositionsCount} done)
                </span>
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">Pending Withdrawals</span>
              <span className="text-base font-mono font-bold text-purple-400">
                {data.stats.pendingWithdrawalsCount}
              </span>
            </div>
          </div>

          {/* Daily Mon-Fri Payout Sweep Control */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Daily 2.0% Payout Scheduler (Mon–Fri UTC)
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Runs automatically after 00:05 UTC. Trigger manually for today&apos;s closing day or specify a YYYY-MM-DD backfill date.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="text"
                  value={payoutDateKey}
                  onChange={(e) => setPayoutDateKey(e.target.value)}
                  placeholder="YYYY-MM-DD (opt)"
                  className="w-36 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-white"
                />
                <button
                  type="button"
                  disabled={busyKey === 'sweep'}
                  onClick={handleRunPayout}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{busyKey === 'sweep' ? 'Running…' : 'Run Mon–Fri 2% Payout'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Withdrawals Queue */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Yield Pool Withdrawals ({data.withdrawals.length})
            </h4>
            {data.withdrawals.length === 0 ? (
              <p className="text-xs text-slate-500">No withdrawal requests recorded yet.</p>
            ) : (
              <div className="space-y-2.5">
                {data.withdrawals.map((w) => {
                  const isPending = w.status === 'pending';
                  return (
                    <div
                      key={w.id}
                      className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-white font-mono">
                          ${Number(w.netAmount || w.amount).toFixed(2)} USDT
                        </span>
                        <span
                          className={`uppercase font-bold text-[10px] px-2 py-0.5 rounded-full border ${
                            w.status === 'completed'
                              ? 'border-emerald-500/40 text-emerald-400'
                              : w.status === 'pending'
                              ? 'border-amber-500/40 text-amber-300'
                              : 'border-rose-500/40 text-rose-400'
                          }`}
                        >
                          {w.status}
                        </span>
                      </div>
                      <div className="font-mono text-slate-300 break-all">
                        To: {w.recipientAddress || '—'}
                      </div>
                      <div className="text-slate-500">
                        User {w.userId} · {formatGmt(w.createdAt)}
                      </div>
                      {w.txHash && (
                        <a
                          href={`https://tronscan.org/#/transaction/${w.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-emerald-400 hover:underline break-all"
                        >
                          <span>TXID: {w.txHash}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      )}

                      {isPending && (
                        <div className="space-y-2 pt-1.5 border-t border-slate-800/80">
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              value={txById[w.id] || ''}
                              onChange={(e) => setTxById((p) => ({ ...p, [w.id]: e.target.value }))}
                              placeholder="64-char TRON payout TXID"
                              className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 font-mono text-white"
                            />
                            <button
                              type="button"
                              disabled={busyKey === w.id || (txById[w.id] || '').trim().length < 64}
                              onClick={() => void handleCompleteWithdrawal(w.id)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold cursor-pointer disabled:opacity-50"
                            >
                              Verify &amp; Complete
                            </button>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              value={reasonById[w.id] || ''}
                              onChange={(e) => setReasonById((p) => ({ ...p, [w.id]: e.target.value }))}
                              placeholder="Rejection reason (refunds USDT back to client wallet)"
                              className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white"
                            />
                            <button
                              type="button"
                              disabled={busyKey === w.id || !(reasonById[w.id] || '').trim()}
                              onClick={() => void handleRejectWithdrawal(w.id)}
                              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer disabled:opacity-50"
                            >
                              Reject &amp; Refund
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Manual Credit Form */}
          <form
            onSubmit={handleManualCredit}
            className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3"
          >
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>Credit Fixed 2% Position Manually</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
              <input
                type="text"
                required
                value={creditUserId}
                onChange={(e) => setCreditUserId(e.target.value)}
                placeholder="Client Firebase UID"
                className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-white"
              />
              <input
                type="number"
                required
                min="200"
                step="0.01"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                placeholder="Principal USDT (min 200)"
                className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-white"
              />
              <input
                type="text"
                value={creditTxHash}
                onChange={(e) => setCreditTxHash(e.target.value)}
                placeholder="Optional 64-char TxHash"
                className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-white"
              />
              <input
                type="text"
                value={creditNote}
                onChange={(e) => setCreditNote(e.target.value)}
                placeholder="Note (e.g. Binance OTC batch)"
                className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
              />
            </div>
            <button
              type="submit"
              disabled={busyKey === 'credit'}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {busyKey === 'credit' ? 'Crediting…' : 'Credit Fixed 2% Position'}
            </button>
          </form>

          {/* Positions List */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Client Positions ({data.positions.length})
            </h4>
            {data.positions.length === 0 ? (
              <p className="text-xs text-slate-500">No yield pool positions created yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] text-slate-400 font-sans">
                      <th className="py-2 pr-3">User UID</th>
                      <th className="py-2 px-3">Principal</th>
                      <th className="py-2 px-3">2%/Day</th>
                      <th className="py-2 px-3">Progress</th>
                      <th className="py-2 px-3">Earned</th>
                      <th className="py-2 pl-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {data.positions.map((pos) => (
                      <tr key={pos.id} className="text-slate-200">
                        <td className="py-2 pr-3 truncate max-w-[140px]" title={pos.userId}>
                          {pos.userId}
                        </td>
                        <td className="py-2 px-3 font-bold">${Number(pos.principalUsdt).toFixed(2)}</td>
                        <td className="py-2 px-3 text-emerald-400">+${Number(pos.dailyPayoutUsdt).toFixed(2)}</td>
                        <td className="py-2 px-3">
                          {pos.businessDaysCompleted}/{pos.termBusinessDays}d
                        </td>
                        <td className="py-2 px-3 text-emerald-400">+${Number(pos.totalEarnedUsdt).toFixed(2)}</td>
                        <td className="py-2 pl-3 text-right capitalize font-sans">{pos.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
