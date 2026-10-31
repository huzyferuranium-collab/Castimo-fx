import React, { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { MarketRow, getMarketWatch } from '../../services/marketApi';

/**
 * Live bid / ask / spread read from the master's broker feed. A symbol the feed has no price for is shown as
 * "no price", and when the feed is down the panel says so. No change figures: the feed does not provide them.
 */
export const MarketWatchPanel: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [data, setData] = useState<{ live: boolean; markets: MarketRow[] } | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const r = await getMarketWatch();
      if (!cancelled) setData(r);
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const fmt = (n: number | undefined, d = 2) => (n === undefined ? '—' : n.toFixed(d));

  return (
    <div className={`rounded-2xl bg-slate-900/95 border border-slate-800 p-4 sm:p-5 shadow-xl ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-black tracking-wider uppercase text-white font-mono">Live Market Watch</h3>
        </div>
        <span className={`text-[10px] font-mono font-semibold ${data?.live ? 'text-emerald-400' : 'text-slate-500'}`}>
          {data === undefined ? 'LOADING' : data?.live ? 'BROKER FEED' : 'FEED OFFLINE'}
        </span>
      </div>

      {data === undefined && <p className="text-xs text-slate-500">Loading prices…</p>}
      {data === null && <p className="text-xs text-slate-500">Prices could not be loaded right now.</p>}
      {data && !data.live && <p className="text-xs text-slate-500">The broker price feed is not connected, so no prices are shown.</p>}
      {data && data.live && (
        <table className="w-full text-left font-mono text-xs">
          <thead>
            <tr className="text-[10px] text-slate-500 uppercase border-b border-slate-800/60">
              <th className="pb-1.5 font-bold">Symbol</th>
              <th className="pb-1.5 font-bold text-right">Bid</th>
              <th className="pb-1.5 font-bold text-right">Ask</th>
              <th className="pb-1.5 font-bold text-right">Spread</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {data.markets.map((m) => (
              <tr key={m.symbol}>
                <td className="py-2.5 font-bold text-white text-[11px]">{m.symbol}</td>
                {m.available ? (
                  <>
                    <td className="py-2.5 text-right text-slate-200">{fmt(m.bid, m.digits)}</td>
                    <td className="py-2.5 text-right text-slate-200">{fmt(m.ask, m.digits)}</td>
                    <td className="py-2.5 text-right text-slate-400">{fmt(m.spread, m.digits)}</td>
                  </>
                ) : (
                  <td colSpan={3} className="py-2.5 text-right text-slate-500 text-[11px]">no price from the feed</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
