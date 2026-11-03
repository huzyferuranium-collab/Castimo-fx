import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Share2, Wallet, Users } from 'lucide-react';
import { SectionBanner, StatCard } from '../dashboard/DashboardVisuals';
import { Collapsible } from '../common/Collapsible';
import { ReferralSummary, getReferralSummary, requestWithdrawal, saveReferralWallet } from '../../services/referralApi';

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
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletNote, setWalletNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await getReferralSummary();
    setS(r.ok ? r.data! : null);
    if (r.ok && r.data?.wallet) setWallet((w) => w || r.data!.wallet!);
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

  const daily = s.dailyRatesPct ?? [1, 0.5, 0.5];
  const paidDays = s.dailyPaidDaysPerMonth ?? 20;
  const rateText = (r: number[]) => `${r[0]}% · ${r[1]}% · ${r[2]}%`;
  const saved = s.wallet || '';

  const saveWallet = async () => {
    setWalletBusy(true);
    setWalletNote(null);
    const r = await saveReferralWallet(wallet.trim());
    setWalletBusy(false);
    if (r.ok) {
      setWalletNote({ ok: true, text: 'Saved. Your withdrawals are sent to this address.' });
      load();
    } else setWalletNote({ ok: false, text: r.error || 'Could not save the address.' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const r = await requestWithdrawal(n, saved);
    setBusy(false);
    if (r.ok) {
      setNote({ ok: true, text: 'Withdrawal requested. You can follow its status below.' });
      setAmount('');
      load();
    } else setNote({ ok: false, text: r.error || 'Could not submit the request.' });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-3 sm:space-y-5 pb-12">
      <SectionBanner
        tone="ruby"
        art="network"
        title="Referral Hub"
        subtitle={`${rateText(s.ratesPct)} once on the $100 Monthly Plan · ${rateText(daily)} daily on 50% Profit Share clients.`}
      />
      <div className="flex gap-2">
        {(['overview', 'withdraw'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer ${tab === t ? 'is-selected bg-emerald-500 text-slate-950' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}
          >
            {t === 'overview' ? 'Referrals' : 'Withdraw'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
              <Share2 className="w-4 h-4 text-emerald-500" /> Your referral link
            </div>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-950 text-[11px] sm:text-xs font-mono break-all select-all text-slate-800 dark:text-emerald-300">{s.link}</div>
              <button type="button" onClick={() => copy('link', s.link)} className="px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center gap-1 cursor-pointer">
                {copied === 'link' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied === 'link' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* The two rates at a glance; the details are behind "How commissions work". */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Monthly Plan commission</span>
              <div className="text-lg font-black font-mono text-emerald-500 mt-0.5">{rateText(s.ratesPct)}</div>
              <span className="text-[11px] text-slate-500">of the first $100 Monthly Plan payment, paid once · levels 1 · 2 · 3</span>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Daily commission · 50% Profit Share</span>
              <div className="text-lg font-black font-mono text-amber-500 mt-0.5">{rateText(daily)}</div>
              <span className="text-[11px] text-slate-500">of the client's equity, every working day · {paidDays} days a month</span>
            </div>
          </div>

          <Collapsible title="How commissions work" summary="Levels, the daily commission, and how you get paid" openLabel="Show" closeLabel="Hide">
            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              <p><b>Levels.</b> Level 1 is someone who joined with your link. Level 2 joined with their link, and level 3 with the next one down.</p>
              <p><b>Monthly Plan commission ({rateText(s.ratesPct)}), paid once.</b> When a client you referred pays the $100 Monthly Plan for the first time, you earn ${(100 * s.ratesPct[0] / 100).toFixed(0)} (level 1), ${(100 * s.ratesPct[1] / 100).toFixed(0)} (level 2) or ${(100 * s.ratesPct[2] / 100).toFixed(0)} (level 3). Renewals in later months earn nothing. Nothing is earned until the payment is verified.</p>
              <p><b>Daily commission ({rateText(daily)}).</b> Every 24 hours, for each 50% Profit Share client you referred whose MT5 account stays connected, you earn that percentage of their equity as shown by the copier. It is paid on the first {paidDays} working days (Monday to Friday) of every month and starts again on the 1st. A disconnected account earns nothing that day. Example: a level 1 client with $1,000 equity earns you ${(1000 * daily[0] / 100).toFixed(2)} a day.</p>
              <p><b>Getting paid.</b> Commissions build up as your balance here. Save your TRON (TRC20) address under Withdraw and request a withdrawal (minimum ${s.rules.minUsdt}, {s.rules.feePct}% processing fee). The admin checks it and sends the USDT to your address.</p>
            </div>
          </Collapsible>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {([
              ['Level 1', s.counts.level1, 'ruby'],
              ['Level 2', s.counts.level2, 'magenta'],
              ['Level 3', s.counts.level3, 'violet'],
            ] as const).map(([label, count, tone]) => (
              <StatCard key={label} tone={tone} icon={<Users className="w-5 h-5" />} label={label} value={Number(count)} prefix="" decimals={0} footer="sign-ups" />
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            {([
              ['Earned', s.earnedUsdt, 'gold', 'coins'],
              ['Held / paid out', s.heldUsdt, 'royal', 'clock'],
              ['Available', s.availableUsdt, 'mint', 'gem'],
            ] as const).map(([label, v, tone, art]) => (
              <StatCard key={label} tone={tone} art={art} icon={<Wallet className="w-5 h-5" />} label={label} value={Number(v)} rowOnPhone />
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Recent commissions</h4>
            {s.recentCommissions.length === 0 ? (
              <p className="text-xs text-slate-500">No commissions yet. They appear here after someone you invited pays.</p>
            ) : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                {s.recentCommissions.map((c) => (
                  <li key={c.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-600 dark:text-slate-300 min-w-0">
                      Level {c.level} · {c.ratePct}%
                      {c.basePaidUsdt != null && (
                        <span className="block text-[10px] text-slate-500">
                          of ${Number(c.basePaidUsdt).toFixed(2)}
                          {c.sourceType === 'subscription' ? ' · Monthly Plan' : c.sourceType === 'profit_invoice' ? ' · Profit Share fee' : c.sourceType === 'daily_equity' ? ' equity · daily commission' : ''}
                        </span>
                      )}
                    </span>
                    <span className="text-slate-500 text-[10px] sm:text-xs text-center">{fmt(c.createdAt)}</span>
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
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
              <Wallet className="w-4 h-4 text-amber-500" /> Withdraw referral earnings
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Available: <strong>${s.availableUsdt.toFixed(2)}</strong>. Minimum request: ${s.rules.minUsdt}. A {s.rules.feePct}% processing fee is taken from the amount you request.
            </p>
            <div className="text-[11px] text-slate-500 space-y-1">
              <p>Requests made before <strong>{gmt(s.schedule.nextCutoff)}</strong> are in this week's round and are processed within {s.rules.processingHours} hours after it (by {gmt(s.schedule.nextExpectedBy)}). Later requests go into the next week's round.</p>
              <p>All deadlines use GMT. East Africa (Kenya, Uganda, Tanzania) is 3 hours ahead of GMT.</p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 block">Your TRON (TRC20) payout address</span>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  placeholder="T... (USDT on the TRON network)"
                  className="flex-1 px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => void saveWallet()}
                  disabled={walletBusy || wallet.trim().length < 30 || wallet.trim() === saved}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white disabled:opacity-40 cursor-pointer"
                >
                  {walletBusy ? 'Saving…' : saved && wallet.trim() === saved ? 'Saved' : 'Save address'}
                </button>
              </div>
              <p className="text-[10px] text-slate-500">
                {saved ? `Withdrawals go to ${saved.slice(0, 6)}…${saved.slice(-4)}. The admin sends your USDT here.` : 'Save it once; every withdrawal request is sent to the admin with this address.'}
              </p>
              {walletNote && <p className={`text-[11px] ${walletNote.ok ? 'text-emerald-500' : 'text-rose-500'}`}>{walletNote.text}</p>}
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
                {valid && (
                  <div className="rounded-xl bg-slate-100 dark:bg-slate-950 p-3 text-xs space-y-1 font-mono">
                    <div className="flex justify-between"><span>Requested</span><span>${n.toFixed(2)}</span></div>
                    <div className="flex justify-between text-amber-500"><span>Processing fee ({s.rules.feePct}%)</span><span>-${fee.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold text-emerald-500"><span>You receive</span><span>${net.toFixed(2)}</span></div>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={busy || !valid || !saved}
                  className="btn-gold px-4 py-2 rounded-xl font-bold text-xs cursor-pointer"
                >
                  {busy ? 'Submitting…' : 'Confirm withdrawal'}
                </button>
                {!saved && <p className="text-[11px] text-amber-500">Save your TRON address above first.</p>}
              </form>
            )}
            {note && <div className={`p-3 rounded-xl text-xs border ${note.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-rose-500/10 border-rose-500/30 text-rose-500'}`}>{note.text}</div>}
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
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
