import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { ART } from './Illustrations';
import {
  PlanView,
  ServiceModel,
  cancelSubscription,
  getPlanView,
  paySubscription,
  selectPlan,
} from '../../services/servicePlanApi';

interface Props {
  onChanged?: () => void;
}

/** Two service options side by side. Everything shown comes from the server's records. */
export const ServicePlanPage: React.FC<Props> = ({ onChanged }) => {
  const [view, setView] = useState<PlanView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [tx, setTx] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setView(await getPlanView());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => {
    setBusy(true);
    setNote(null);
    const r = await fn();
    setNote(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error || 'Something went wrong.' });
    setBusy(false);
    if (r.ok) {
      await load();
      onChanged?.();
    }
  };

  if (view === undefined) return <p className="text-xs text-slate-500">Loading your plan…</p>;
  if (view === null) return <p className="text-xs text-slate-500">Your plan could not be loaded right now. Please try again shortly.</p>;
  if (!view.available) return <p className="text-xs text-slate-500">Plan selection is not open yet.</p>;

  const selected = view.model;
  const sub = view.subscription;
  const stat = (n: number, label: string) =>
    n > 0 ? <span className="text-[11px] text-slate-500">{n} {label}</span> : null;

  const card = (model: ServiceModel) => {
    const isSub = model === 'subscription';
    const isSelected = selected === model;
    return (
      <div
        className={`relative overflow-hidden flex flex-col rounded-2xl sm:rounded-3xl p-4 sm:p-6 space-y-2.5 sm:space-y-3 bg-white dark:bg-slate-900 border border-transparent ${
          isSelected ? 'outline outline-2 outline-brand-electric/70' : ''
        }`}
        style={{ ['--rim-accent' as string]: isSub ? '23,107,255' : '133,59,255' }}
      >
        <div aria-hidden className={`absolute -right-12 -top-14 w-40 h-40 sm:w-52 sm:h-52 rounded-full bloom opacity-40 bg-gradient-to-br ${isSub ? 'from-brand-sky via-brand-electric to-brand-royal' : 'from-brand-magenta via-brand-violet to-brand-royal'}`} />
        <div className="relative flex items-start gap-3 sm:gap-4">
          {(() => {
            const PlanArt = isSub ? ART.shield : ART.coins;
            return <PlanArt size={76} className="shrink-0 -ml-1 animate-float-a w-14 h-14 sm:w-[76px] sm:h-[76px]" />;
          })()}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display font-extrabold text-slate-900 dark:text-white">{isSub ? 'Monthly Subscription' : '50% Profit Share'}</span>
              {isSelected && (
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 shrink-0">
                  SELECTED
                </span>
              )}
            </div>
            <div className="mt-1 font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              {isSub ? `$${view.price.subscriptionUsdt}` : `${view.price.feePct}%`}
              <span className="text-sm font-medium text-slate-500">
                {isSub ? ` USD / ${view.price.periodDays} days` : ' of new profit'}
              </span>
            </div>
          </div>
        </div>

        {isSub ? (
          <ul className="relative text-[11.5px] sm:text-xs text-slate-600 dark:text-slate-300 space-y-1 list-disc pl-4">
            <li>One flat price, with no profit share.</li>
            <li>Paid in USDT (TRC20). Copying starts once the payment is verified.</li>
            <li>No automatic charges: copying stops when the period ends, until you pay again.</li>
            <li>Paying early adds to the time you have left.</li>
          </ul>
        ) : (
          <ul className="relative text-[11.5px] sm:text-xs text-slate-600 dark:text-slate-300 space-y-1 list-disc pl-4">
            <li>No upfront fee. {view.price.feePct}% of NEW profit only, measured on your broker equity.</li>
            <li>Deposits and withdrawals never count as profit. Losses are recovered first.</li>
            <li>If a period has new profit, an invoice is created, payable in USDT (TRC20) within {view.price.dueHours ?? 24} hours.</li>
            <li>While an invoice is unpaid after that, copying is paused.</li>
          </ul>
        )}

        <div className="relative min-h-[16px]">{isSub ? stat(view.stats.activeSubscribers, 'active subscribers') : stat(view.stats.profitShareClients, 'clients on this plan')}</div>

        <div className="relative mt-auto">
          {isSelected ? (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
              <Check className="w-4 h-4" /> Your current plan
            </div>
          ) : (
            <button
              type="button"
              disabled={busy || (!!selected && !view.canSwitch.ok)}
              onClick={() => run(() => selectPlan(model), 'Plan selected.')}
              className="btn-gold w-full py-2.5 rounded-xl font-bold text-xs disabled:cursor-not-allowed cursor-pointer"
            >
              {selected ? 'Switch to this plan' : 'Choose this plan'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {card('subscription')}
        {card('profit_share')}
      </div>

      {selected && !view.canSwitch.ok && view.canSwitch.reason && (
        <p className="text-[11px] text-slate-500">{view.canSwitch.reason}</p>
      )}

      {selected === 'subscription' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Your subscription</h4>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                sub?.active
                  ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-500 border-amber-500/30'
              }`}
            >
              {sub?.active ? 'ACTIVE' : sub ? 'EXPIRED' : 'NOT PAID YET'}
            </span>
          </div>
          {sub && (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {sub.active
                ? `Runs until ${new Date(sub.periodEnd).toLocaleDateString()} (${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'} left).${
                    sub.cancelAtPeriodEnd ? ' It will not renew.' : ''
                  }`
                : `Ended on ${new Date(sub.periodEnd).toLocaleDateString()}.`}
            </p>
          )}

          {view.paymentsOpen ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Send at least <strong>{view.price.subscriptionUsdt} USDT</strong> on the <strong>TRON (TRC20)</strong> network to:
              </p>
              <div className="flex items-stretch gap-2">
                <div className="flex-1 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono break-all select-all text-slate-800 dark:text-emerald-300">
                  {view.treasuryAddress}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      navigator.clipboard?.writeText(view.treasuryAddress);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      // ignore
                    }
                  }}
                  className="px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">Then paste the 64-character transaction ID (TXID) from your wallet:</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={tx}
                  onChange={(e) => setTx(e.target.value)}
                  placeholder="TXID"
                  className="flex-1 px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  disabled={busy || tx.trim().length < 10}
                  onClick={() =>
                    run(async () => {
                      const r = await paySubscription(tx.trim());
                      if (r.ok) setTx('');
                      return r;
                    }, 'Payment verified. Your subscription is active.')
                  }
                  className="btn-gold px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {busy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  Verify payment
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">The payment address is not available yet. Please contact support.</p>
          )}

          {sub?.active && !sub.cancelAtPeriodEnd && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => cancelSubscription(), 'Renewal cancelled. You keep access until the end date.')}
              className="text-[11px] text-rose-500 hover:text-rose-400 underline cursor-pointer"
            >
              Cancel renewal
            </button>
          )}
        </div>
      )}

      {note && (
        <div
          className={`p-3 rounded-xl text-xs border ${
            note.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300'
          }`}
        >
          {note.text}
        </div>
      )}
    </div>
  );
};
