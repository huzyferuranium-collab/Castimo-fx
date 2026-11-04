import React, { useEffect, useId, useMemo, useState } from 'react';
import type { CopiedTrade } from '../../types';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { ProgressRing } from './DashboardVisuals';

/**
 * Colourful charts drawn ONLY from the account's own trades (the same list the history and
 * positions pages use). Nothing is sampled, smoothed, projected or filled in: with no trades,
 * the dashboard does not render these at all.
 */

const money = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;

/* ---------------------------------------------------------------- net result per day */
const DAY_MS = 86_400_000;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10); // days are counted in GMT, as the rest of the site does
const closedMs = (t: CopiedTrade) => (t.closeTime ? Date.parse(t.closeTime) : NaN);
const MAX_DAYS = 60;

export const DayBars: React.FC<{ trades: CopiedTrade[]; endMs: number; days: number }> = ({ trades, endMs, days }) => {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const rows = useMemo(() => {
    const net = new Map<string, { sum: number; n: number }>();
    for (const t of trades) {
      const k = dayKey(closedMs(t));
      const cur = net.get(k) ?? { sum: 0, n: 0 };
      net.set(k, { sum: cur.sum + (t.pnl || 0), n: cur.n + 1 });
    }
    const out: Array<{ key: string; ms: number; sum: number; n: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const ms = endMs - i * DAY_MS;
      const k = dayKey(ms);
      const v = net.get(k);
      out.push({ key: k, ms, sum: v?.sum ?? 0, n: v?.n ?? 0 });
    }
    return out;
  }, [trades, endMs, days]);

  const pos = Math.max(0, ...rows.map((r) => r.sum));
  const neg = Math.max(0, ...rows.map((r) => -r.sum));
  const total = pos + neg;
  const sum = rows.reduce((a, r) => a + r.sum, 0);
  const baseTop = total === 0 ? 100 : (pos / total) * 100;
  const label = (ms: number) =>
    days <= 7
      ? new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
      : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' });

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Net result per day</div>
        <div className={`font-mono text-sm font-extrabold ${sum >= 0 ? '!text-emerald-600 dark:!text-emerald-300' : '!text-rose-600 dark:!text-rose-300'}`}>
          <AnimatedNumber value={sum} signed prefix="$" />
        </div>
      </div>

      <div className="relative mt-3 h-36 flex items-stretch justify-evenly gap-1 sm:gap-1.5" role="img" aria-label={`Net result for each of the last ${days} days, ${money(sum)} in total`}>
        {rows.map((r, i) => {
          const up = r.sum >= 0;
          const h = r.n === 0 || total === 0 ? 0 : Math.max(4, (Math.abs(r.sum) / total) * 100);
          return (
            <div key={r.key} className="relative flex-1 min-w-0 max-w-[44px] group" title={`${r.key} · ${r.n} trade${r.n === 1 ? '' : 's'} · ${money(r.sum)}`}>
              {r.n === 0 ? (
                <div className="absolute inset-x-[30%] rounded-full bg-slate-300/60 dark:bg-slate-600/60 h-1" style={{ top: `calc(${baseTop}% - 2px)` }} />
              ) : (
                <div
                  className={`absolute inset-x-0 rounded-full transition-[height] duration-[900ms] ease-out ${
                    up ? 'bg-gradient-to-t from-brand-turquoise to-brand-cyan shadow-[0_8px_18px_-6px_rgba(8,201,181,.7)]' : 'bg-gradient-to-b from-brand-crimson to-brand-magenta shadow-[0_8px_18px_-6px_rgba(245,34,54,.6)]'
                  } group-hover:brightness-110`}
                  style={up ? { bottom: `${100 - baseTop}%`, height: on ? `${h}%` : '0%', transitionDelay: `${i * 30}ms` } : { top: `${baseTop}%`, height: on ? `${h}%` : '0%', transitionDelay: `${i * 30}ms` }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-evenly gap-1 sm:gap-1.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
        {rows.map((r, i) => (
          <span key={r.key} className="flex-1 min-w-0 max-w-[44px] text-center truncate">{days <= 31 || i % 5 === 0 ? label(r.ms) : ''}</span>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-brand-cyan to-brand-turquoise" /> Profit day</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-brand-crimson to-brand-magenta" /> Loss day</span>
        <span className="ml-auto">Days are counted in GMT</span>
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- buy / sell mix */
export const SideDonut: React.FC<{ trades: CopiedTrade[]; size?: number }> = ({ trades, size = 112 }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const buys = trades.filter((t) => t.direction === 'BUY').length;
  const sells = trades.filter((t) => t.direction === 'SELL').length;
  const n = buys + sells || 1;
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
const Tile: React.FC<{ label: string; value: React.ReactNode; sub?: string; tone?: 'up' | 'down' | 'plain' }> = ({ label, value, sub, tone = 'plain' }) => (
  <div className="rounded-2xl bg-slate-50/80 dark:bg-slate-800/60 px-3.5 py-3 min-w-0">
    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{label}</div>
    <div className={`mt-1 font-mono text-base sm:text-lg font-extrabold truncate ${tone === 'up' ? '!text-emerald-600 dark:!text-emerald-300' : tone === 'down' ? '!text-rose-600 dark:!text-rose-300' : 'text-slate-900 dark:text-white'}`}>{value}</div>
    {sub && <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">{sub}</div>}
  </div>
);

type Period = '7d' | '30d' | 'all';
const PERIODS: Array<{ id: Period; label: string; days: number }> = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: 'all', label: 'All', days: 0 },
];

/**
 * Every figure here comes from the closed trades the copier service reports for this account, for the chosen period (last 7 days
 * by default). Trades whose profit was not reported are left out of the amounts and counted; trades with no close time appear only
 * under "All". Nothing is estimated.
 */
export const TradePerformance: React.FC<{ trades: CopiedTrade[] }> = ({ trades }) => {
  const [period, setPeriod] = useState<Period>('7d');
  const [showAll, setShowAll] = useState(false);
  const closedEvery = trades.filter((t) => t.status === 'CLOSED');
  if (closedEvery.length === 0) return null;

  const nowMs = Date.now();
  const spec = PERIODS.find((p) => p.id === period)!;
  const dated = closedEvery.filter((t) => Number.isFinite(closedMs(t)));
  const undated = closedEvery.length - dated.length;
  const oldest = dated.reduce((m, t) => Math.min(m, closedMs(t)), nowMs);
  const barDays = period === 'all' ? Math.min(MAX_DAYS, Math.max(7, Math.floor((nowMs - oldest) / DAY_MS) + 1)) : spec.days;
  // The window starts at the beginning of the first day shown, so a bar is never half a day.
  const startMs = period === 'all' ? 0 : Date.parse(dayKey(nowMs - (spec.days - 1) * DAY_MS));
  const inPeriod = period === 'all' ? closedEvery : dated.filter((t) => closedMs(t) >= startMs);

  const closed = inPeriod.filter((t) => t.pnlKnown !== false);
  const skipped = inPeriod.length - closed.length;
  const winners = closed.filter((t) => (t.pnl || 0) > 0);
  const losers = closed.filter((t) => (t.pnl || 0) < 0);
  const flat = closed.length - winners.length - losers.length;
  const grossWin = winners.reduce((a, t) => a + (t.pnl || 0), 0);
  const grossLoss = losers.reduce((a, t) => a + (t.pnl || 0), 0);
  const net = grossWin + grossLoss;
  const avg = closed.length > 0 ? net / closed.length : 0;
  const rate = closed.length > 0 ? winners.length / closed.length : 0;
  const best = closed.reduce((m, t) => Math.max(m, t.pnl || 0), 0);
  const worst = closed.reduce((m, t) => Math.min(m, t.pnl || 0), 0);
  const list = [...inPeriod].sort((a, b) => (closedMs(b) || 0) - (closedMs(a) || 0));
  const listShown = showAll ? list : list.slice(0, 8);
  const fmtTime = (t: CopiedTrade) => {
    const ms = closedMs(t);
    return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '—';
  };

  return (
    <div className="relative overflow-hidden rounded-3xl bg-white dark:bg-slate-900 p-5 sm:p-6" style={{ ['--rim-accent' as string]: '23,107,255' }}>
      <div aria-hidden className="absolute -left-10 -bottom-16 w-56 h-56 rounded-full bg-gradient-to-tr from-brand-electric via-brand-violet to-brand-magenta opacity-[0.28] bloom" />
      <div className="relative flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display font-extrabold text-base text-slate-900 dark:text-white">Trade performance</h3>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Closed trades from {period === 'all' ? 'everything your account has reported' : `the last ${spec.days} days`}
          </span>
        </div>
        <div className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 p-0.5" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setPeriod(p.id); setShowAll(false); }}
              aria-pressed={period === p.id}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${period === p.id ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {inPeriod.length === 0 ? (
        <p className="relative text-sm font-medium text-slate-500 dark:text-slate-400 py-6">
          No trades closed in the last {spec.days} days. Choose “All” to see every closed trade your account has reported.
        </p>
      ) : (
        <>
          <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-5">
            <Tile label="Closed trades" value={inPeriod.length} sub={`${winners.length} profit · ${losers.length} loss${flat ? ` · ${flat} even` : ''}`} />
            <Tile label="Profit trades" value={money(grossWin)} sub={`${winners.length} trade${winners.length === 1 ? '' : 's'}${winners.length ? ` · best ${money(best)}` : ''}`} tone="up" />
            <Tile label="Loss trades" value={money(grossLoss)} sub={`${losers.length} trade${losers.length === 1 ? '' : 's'}${losers.length ? ` · worst ${money(worst)}` : ''}`} tone="down" />
            <Tile label="Net result" value={money(net)} sub={closed.length ? `Average ${money(avg)} per trade` : undefined} tone={net > 0 ? 'up' : net < 0 ? 'down' : 'plain'} />
          </div>

          <div className="relative flex flex-col lg:flex-row gap-6 lg:gap-10">
            <DayBars trades={closed.filter((t) => Number.isFinite(closedMs(t)))} endMs={nowMs} days={barDays} />
            <div className="flex flex-wrap items-center gap-x-8 gap-y-5 lg:justify-end">
              <SideDonut trades={inPeriod} />
              {closed.length > 0 && (
                <div className="flex items-center gap-4">
                  <ProgressRing value={rate} size={92}>
                    <AnimatedNumber value={rate * 100} decimals={0} prefix="" suffix="%" className="font-display font-extrabold text-lg text-slate-900 dark:text-white" />
                  </ProgressRing>
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 leading-snug">
                    Win rate
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{winners.length} of {closed.length} closed</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="relative mt-5 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  <th className="py-1.5 pr-3 font-bold">Closed (GMT)</th>
                  <th className="py-1.5 pr-3 font-bold">Symbol</th>
                  <th className="py-1.5 pr-3 font-bold">Side</th>
                  <th className="py-1.5 text-right font-bold">Result</th>
                </tr>
              </thead>
              <tbody className="font-semibold text-slate-700 dark:text-slate-200">
                {listShown.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{fmtTime(t)}</td>
                    <td className="py-1.5 pr-3">{t.symbol}</td>
                    <td className="py-1.5 pr-3">{t.direction || '—'}</td>
                    <td className={`py-1.5 text-right font-mono font-extrabold ${t.pnlKnown === false ? 'text-slate-400' : (t.pnl || 0) >= 0 ? '!text-emerald-600 dark:!text-emerald-300' : '!text-rose-600 dark:!text-rose-300'}`}>
                      {t.pnlKnown === false ? '—' : money(t.pnl || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length > 8 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-[11px] font-bold text-brand-electric hover:underline">
                {showAll ? 'Show fewer' : `Show all ${list.length} trades`}
              </button>
            )}
          </div>
        </>
      )}

      {(skipped > 0 || (undated > 0 && period !== 'all') || (period === 'all' && barDays === MAX_DAYS)) && (
        <p className="relative mt-4 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {skipped > 0 && `${skipped} closed trade${skipped === 1 ? '' : 's'} did not come with a profit figure, so ${skipped === 1 ? 'it is' : 'they are'} not counted in the amounts above. `}
          {undated > 0 && period !== 'all' && `${undated} closed trade${undated === 1 ? ' has' : 's have'} no close time and ${undated === 1 ? 'shows' : 'show'} only under “All”. `}
          {period === 'all' && barDays === MAX_DAYS && `The bars show the latest ${MAX_DAYS} days; the figures and list above cover every closed trade.`}
        </p>
      )}
    </div>
  );
};
