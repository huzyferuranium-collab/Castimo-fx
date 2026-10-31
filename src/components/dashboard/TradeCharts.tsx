import React, { useEffect, useId, useState } from 'react';
import type { CopiedTrade } from '../../types';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { ProgressRing } from './DashboardVisuals';

/**
 * Colourful charts drawn ONLY from the account's own trades (the same list the history and
 * positions pages use). Nothing is sampled, smoothed, projected or filled in: with no trades,
 * the dashboard does not render these at all.
 */

const money = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
const when = (t: CopiedTrade) => Date.parse(t.closeTime || t.openTime) || 0;

/* ---------------------------------------------------------------- profit / loss per trade */
export const TradeBars: React.FC<{ trades: CopiedTrade[]; max?: number }> = ({ trades, max = 14 }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [on, setOn] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const shown = [...trades].sort((a, b) => when(a) - when(b)).slice(-max);
  const pos = Math.max(0, ...shown.map((t) => t.pnl || 0));
  const neg = Math.max(0, ...shown.map((t) => -(t.pnl || 0)));
  const total = pos + neg;
  const sum = shown.reduce((s, t) => s + (t.pnl || 0), 0);
  const baseTop = total === 0 ? 100 : (pos / total) * 100; // where zero sits, as % from the top

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Profit &amp; loss per trade</div>
        <div className={`font-mono text-sm font-extrabold ${sum >= 0 ? '!text-emerald-600 dark:!text-emerald-300' : '!text-rose-600 dark:!text-rose-300'}`}>
          <AnimatedNumber value={sum} signed prefix="$" />
        </div>
      </div>

      <div className="relative mt-3 h-36 flex items-stretch justify-evenly gap-1.5 sm:gap-2.5" role="img" aria-label={`Profit and loss for your last ${shown.length} trades, ${money(sum)} in total`}>
        <svg width="0" height="0" aria-hidden className="absolute">
          <defs>
            <linearGradient id={`${id}p`} x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#08c9b5" /><stop offset="1" stopColor="#06d6e9" /></linearGradient>
          </defs>
        </svg>
        {shown.map((t, i) => {
          const v = t.pnl || 0;
          const h = total === 0 ? 4 : Math.max(4, (Math.abs(v) / total) * 100);
          const up = v >= 0;
          return (
            <div key={t.id} className="relative flex-1 min-w-0 max-w-[52px] group" title={`${t.symbol} ${t.direction} · ${money(v)}`}>
              <div
                className={`absolute inset-x-0 rounded-full transition-[height] duration-[900ms] ease-out ${
                  up ? 'bottom-0 bg-gradient-to-t from-brand-turquoise to-brand-cyan shadow-[0_8px_18px_-6px_rgba(8,201,181,.7)]' : 'top-0 bg-gradient-to-b from-brand-crimson to-brand-magenta shadow-[0_8px_18px_-6px_rgba(245,34,54,.6)]'
                } group-hover:brightness-110`}
                style={
                  up
                    ? { bottom: `${100 - baseTop}%`, height: on ? `${h}%` : '0%', transitionDelay: `${i * 45}ms` }
                    : { top: `${baseTop}%`, height: on ? `${h}%` : '0%', transitionDelay: `${i * 45}ms` }
                }
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-brand-cyan to-brand-turquoise" /> Profit</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-brand-crimson to-brand-magenta" /> Loss</span>
        <span className="ml-auto">Last {shown.length} trade{shown.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- buy / sell mix */
export const SideDonut: React.FC<{ trades: CopiedTrade[]; size?: number }> = ({ trades, size = 112 }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const buys = trades.filter((t) => t.direction === 'BUY').length;
  const sells = trades.length - buys;
  const n = trades.length || 1;
  const b = buys / n;
  const gap = buys > 0 && sells > 0 ? 0.02 : 0;

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden>
          <defs>
            <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#176bff" /><stop offset="1" stopColor="#06d6e9" /></linearGradient>
            <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f52236" /><stop offset="1" stopColor="#e83eff" /></linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(148,163,184,.18)" strokeWidth="13" />
          {buys > 0 && <circle cx="50" cy="50" r="38" fill="none" stroke={`url(#${id}b)`} strokeWidth="13" strokeLinecap="round" pathLength={1} strokeDasharray={`${Math.max(0.001, b - gap)} 1`} />}
          {sells > 0 && <circle cx="50" cy="50" r="38" fill="none" stroke={`url(#${id}s)`} strokeWidth="13" strokeLinecap="round" pathLength={1} strokeDasharray={`${Math.max(0.001, 1 - b - gap)} 1`} strokeDashoffset={-b} />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <AnimatedNumber value={trades.length} decimals={0} prefix="" className="font-display font-extrabold text-xl text-slate-900 dark:text-white" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">trades</span>
        </div>
      </div>
      <ul className="space-y-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
        <li className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-brand-electric to-brand-cyan" /> Buy <span className="font-mono font-extrabold text-slate-900 dark:text-white">{buys}</span></li>
        <li className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-brand-crimson to-brand-magenta" /> Sell <span className="font-mono font-extrabold text-slate-900 dark:text-white">{sells}</span></li>
      </ul>
    </div>
  );
};

/* ---------------------------------------------------------------- the whole card */
export const TradePerformance: React.FC<{ trades: CopiedTrade[] }> = ({ trades }) => {
  if (trades.length === 0) return null;
  const closed = trades.filter((t) => t.status === 'CLOSED');
  const wins = closed.filter((t) => (t.pnl || 0) > 0).length;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-white dark:bg-slate-900 p-5 sm:p-6" style={{ ['--rim-accent' as string]: '23,107,255' }}>
      <div aria-hidden className="absolute -left-10 -bottom-16 w-56 h-56 rounded-full bg-gradient-to-tr from-brand-electric via-brand-violet to-brand-magenta opacity-[0.28] bloom" />
      <div className="relative flex items-center justify-between gap-3 mb-4">
        <h3 className="font-display font-extrabold text-base text-slate-900 dark:text-white">Trade performance</h3>
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">From your mirrored trades</span>
      </div>
      <div className="relative flex flex-col lg:flex-row gap-6 lg:gap-10">
        <TradeBars trades={trades} />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-5 lg:justify-end">
          <SideDonut trades={trades} />
          {closed.length > 0 && (
            <div className="flex items-center gap-4">
              <ProgressRing value={wins / closed.length} size={92}>
                <AnimatedNumber value={(wins / closed.length) * 100} decimals={0} prefix="" suffix="%" className="font-display font-extrabold text-lg text-slate-900 dark:text-white" />
              </ProgressRing>
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 leading-snug">
                Win rate
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{wins} of {closed.length} closed</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
