import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  WithdrawalRow,
  adminCompleteWithdrawal,
  adminGetWithdrawals,
  adminSetWithdrawalStatus,
} from '../../services/referralApi';

const gmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' GMT';

/** Referral payouts. "Completed" needs the real TRON transaction, which the server checks before it agrees. */
export const AdminWithdrawalsPanel: React.FC = () => {
  const [rows, setRows] = useState<WithdrawalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [tx, setTx] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await adminGetWithdrawals();
    if (r.ok) setRows(r.data!.withdrawals);
    else setError(r.error || 'Could not load withdrawals.');
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id);
    setError(null);
    const r = await fn();
    if (!r.ok) setError(r.error || 'Action failed.');
    setBusy('');
    load();
  };

  if (rows === null) return <p className="text-xs text-slate-500">{error || 'Loading…'}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Referral withdrawals</h3>
        <button type="button" onClick={load} className="text-xs text-slate-500 flex items-center gap-1 cursor-pointer">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>
      {error && <div className="p-3 rounded-xl text-xs bg-rose-500/10 border border-rose-500/30 text-rose-500">{error}</div>}
      {rows.length === 0 && <p className="text-xs text-slate-500">No withdrawal requests yet.</p>}
      {rows.map((w) => {
        const finished = w.status === 'completed' || w.status === 'rejected' || w.status === 'failed';
        return (
          <div key={w.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-slate-900 dark:text-white">Pay ${w.net.toFixed(2)} USDT (requested ${w.gross.toFixed(2)}, fee ${w.fee.toFixed(2)})</span>
              <span className="uppercase font-bold text-[10px] px-2 py-0.5 rounded-full border border-slate-300 dark:border-slate-700">{w.status}</span>
            </div>
            <div className="font-mono break-all text-slate-600 dark:text-slate-300">To: {w.wallet}</div>
            <div className="text-slate-500">User {w.userId} · round closes {gmt(w.cycleCutoff)} · due by {gmt(w.expectedBy)}</div>
            {w.reason && <div className="text-rose-500">Reason: {w.reason}</div>}
            {w.txHash && <div className="font-mono break-all text-emerald-500">TXID {w.txHash}</div>}

            {!finished && (
              <div className="space-y-2 pt-1">
                {w.status === 'pending' && (
                  <button
                    type="button"
                    disabled={busy === w.id}
                    onClick={() => act(w.id, () => adminSetWithdrawalStatus(w.id, 'processing'))}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white font-bold cursor-pointer disabled:opacity-50"
                  >
                    Mark as processing
                  </button>
                )}
                {w.status === 'processing' && (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={tx[w.id] || ''}
                      onChange={(e) => setTx({ ...tx, [w.id]: e.target.value })}
                      placeholder="TXID of the payout you sent"
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      disabled={busy === w.id || (tx[w.id] || '').trim().length < 10}
                      onClick={() => act(w.id, () => adminCompleteWithdrawal(w.id, tx[w.id]))}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold cursor-pointer disabled:opacity-50"
                    >
                      Verify and complete
                    </button>
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={why[w.id] || ''}
                    onChange={(e) => setWhy({ ...why, [w.id]: e.target.value })}
                    placeholder="Reason (needed to reject or mark failed)"
                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    disabled={busy === w.id || !(why[w.id] || '').trim()}
                    onClick={() => act(w.id, () => adminSetWithdrawalStatus(w.id, 'rejected', why[w.id]))}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-bold cursor-pointer disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={busy === w.id || !(why[w.id] || '').trim()}
                    onClick={() => act(w.id, () => adminSetWithdrawalStatus(w.id, 'failed', why[w.id]))}
                    className="px-3 py-1.5 rounded-lg bg-slate-600 text-white font-bold cursor-pointer disabled:opacity-50"
                  >
                    Failed
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
