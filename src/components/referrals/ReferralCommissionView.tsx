import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Share2, Wallet } from 'lucide-react';
import { ReferralSummary, getReferralSummary, requestWithdrawal } from '../../services/referralApi';

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  processing: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  failed: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
};

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const gmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' GMT';

export const ReferralCommissionView: React.FC = () => {
  const [s, setS] = useState<ReferralSummary | null | undefined>(undefined);
  const [tab, setTab] = useState<'overview' | 'withdraw'>('overview');
  const [copied, setCopied] = useState('');
  const [amount, setAmount] = useState('');
  const [wallet, setWallet] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await getReferralSummary();
    setS(r.ok ? r.data! : null);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const copy = (what: string, text: string) => {
    try {
      navigator.clipboard?.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      // ignore
    }
  };

  if (s === undefined) return <p className="text-xs text-slate-500">Loading…</p>;
  if (s === null) return <p className="text-xs text-slate-500">Referral details could not be loaded right now. Please sign in and try again.</p>;

  // Preview only. The server works out the real fee when you confirm.
  const n = Number(amount);
  const valid = Number.isFinite(n) && n >= s.rules.minUsdt && n <= s.availableUsdt;
  const fee = valid ? Math.round(n * s.rules.feePct) / 100 : 0;
  const net = valid ? Math.round((n - fee) * 100) / 100 : 0;
  const open = s.withdrawals.find((w) => w.status === 'pending' || w.status === 'processing');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const r = await requestWithdrawal(n, wallet.trim());
    setBusy(false);
    if (r.ok) {
      setNote({ ok: true, text: 'Withdrawal requested. You can follow its status below.' });
      setAmount('');
      load();
    } else setNote({ ok: false, text: r.error || 'Could not submit the request.' });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-12">
      <div className="flex gap-2">
        {(['overview', 'withdraw'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer ${tab === t ? 'bg-emerald-500 text-slate-950' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}
          >
            {t === 'overview' ? 'Referrals' : 'Withdraw'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
              <Share2 className="w-4 h-4 text-emerald-500" /> Your referral link
            </div>
            <div className="flex gap-2">
              <div className="flex-1 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-950 text-xs font-mono break-all select-all text-slate-800 dark:text-emerald-300">{s.link}</div>
              <button type="button" onClick={() => copy('link', s.link)} className="px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center gap-1 cursor-pointer">
                {copied === 'link' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied === 'link' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              You earn {s.ratesPct[0]}% / {s.ratesPct[1]}% / {s.ratesPct[2]}% of what people you invited (levels 1, 2 and 3) actually pay us. Nothing is earned until they pay.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              ['Level 1', s.counts.level1],
              ['Level 2', s.counts.level2],
              ['Level 3', s.counts.level3],
            ].map(([label, count]) => (
              <div key={String(label)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-center">
                <div className="text-2xl font-black text-slate-900 dark:text-white">{count}</div>
                <div className="text-[11px] text-slate-500">{label} sign-ups</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              ['Earned', s.earnedUsdt],
              ['Held / paid out', s.heldUsdt],
              ['Available', s.availableUsdt],
            ].map(([label, v]) => (
              <div key={String(label)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <div className="text-[11px] text-slate-500">{label}</div>
                <div className="text-lg font-black text-slate-900 dark:text-white">${Number(v).toFixed(2)}</div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Recent commissions</h4>
            {s.recentCommissions.length === 0 ? (
              <p className="text-xs text-slate-500">No commissions yet. They appear here after someone you invited pays.</p>
            ) : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                {s.recentCommissions.map((c) => (
                  <li key={c.id} className="py-2 flex items-center justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-300">Level {c.level} · {c.ratePct}%</span>
                    <span className="text-slate-500">{fmt(c.createdAt)}</span>
                    <span className="font-bold text-emerald-500">+${Number(c.amountUsdt).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === 'withdraw' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
              <Wallet className="w-4 h-4 text-amber-500" /> Withdraw referral earnings
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Available: <strong>${s.availableUsdt.toFixed(2)}</strong>. Minimum request: ${s.rules.minUsdt}. A {s.rules.feePct}% processing fee is taken from the amount you request.
            </p>
            <div className="text-[11px] text-slate-500 space-y-1">
              <p>Requests made before <strong>{gmt(s.schedule.nextCutoff)}</strong> are in this week's round and are processed within {s.rules.processingHours} hours after it (by {gmt(s.schedule.nextExpectedBy)}). Later requests go into the next week's round.</p>
              <p>All deadlines use GMT. Your local time is 3 hours ahead of GMT in Uganda.</p>
            </div>

            {open ? (
              <p className="text-xs text-amber-500">You have a withdrawal in progress. You can request another one when it is finished.</p>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder={`Amount in USD (min ${s.rules.minUsdt})`}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
                <input
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  placeholder="Your TRON (TRC20) USDT wallet address"
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
                {valid && (
                  <div className="rounded-xl bg-slate-100 dark:bg-slate-950 p-3 text-xs space-y-1 font-mono">
                    <div className="flex justify-between"><span>Requested</span><span>${n.toFixed(2)}</span></div>
                    <div className="flex justify-between text-amber-500"><span>Processing fee ({s.rules.feePct}%)</span><span>-${fee.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold text-emerald-500"><span>You receive</span><span>${net.toFixed(2)}</span></div>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={busy || !valid || wallet.trim().length < 20}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs cursor-pointer"
                >
                  {busy ? 'Submitting…' : 'Confirm withdrawal'}
                </button>
              </form>
            )}
            {note && <div className={`p-3 rounded-xl text-xs border ${note.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-rose-500/10 border-rose-500/30 text-rose-500'}`}>{note.text}</div>}
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Your withdrawals</h4>
            {s.withdrawals.length === 0 ? (
              <p className="text-xs text-slate-500">No withdrawals yet.</p>
            ) : (
              <ul className="space-y-3">
                {s.withdrawals.map((w) => (
                  <li key={w.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 dark:text-white">${w.gross.toFixed(2)} → ${w.net.toFixed(2)} (fee ${w.fee.toFixed(2)})</span>
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${STATUS_STYLE[w.status]}`}>{w.status}</span>
                    </div>
                    <div className="text-slate-500">Requested {fmt(w.requestedAt)} · round closes {gmt(w.cycleCutoff)}</div>
                    {w.status === 'pending' || w.status === 'processing' ? <div className="text-slate-500">Expected by {gmt(w.expectedBy)}</div> : null}
                    {w.reason && <div className="text-rose-500">Reason: {w.reason}</div>}
                    {w.txHash && <div className="font-mono text-emerald-500 break-all">TXID {w.txHash}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
