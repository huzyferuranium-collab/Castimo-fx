import React from 'react';
import { MarketItem } from '../../services/aiRobotState';
import { TrendingUp, TrendingDown, Eye } from 'lucide-react';

interface LiveMarketWatchProps {
  markets: MarketItem[];
  onSelectMarket?: (symbol: string) => void;
  selectedSymbol?: string;
  className?: string;
}

export const LiveMarketWatch: React.FC<LiveMarketWatchProps> = ({
  markets,
  onSelectMarket,
  selectedSymbol = 'EURUSD',
  className = '',
}) => {
  return (
    <div
      className={`rounded-2xl bg-slate-900/95 border border-slate-800 p-4 sm:p-5 shadow-xl backdrop-blur-md flex flex-col justify-between ${className}`}
    >
      <div>
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-black tracking-wider uppercase text-white font-mono">
              LIVE MARKET WATCH
            </h3>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 font-semibold">MT5 DIRECT FEED</span>
        </div>

        {/* Table of Instruments */}
        <div className="overflow-x-auto no-scrollbar font-mono text-xs">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-slate-500 uppercase border-b border-slate-800/60 pb-1">
                <th className="pb-1.5 font-bold">Symbol</th>
                <th className="pb-1.5 font-bold text-right">Price</th>
                <th className="pb-1.5 font-bold text-right">24h Chg</th>
                <th className="pb-1.5 font-bold text-right hidden sm:table-cell">Spread</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {markets.map((m) => {
                const isSelected = selectedSymbol === m.symbol;
                const isPositive = m.changePct >= 0;

                return (
                  <tr
                    key={m.symbol}
                    onClick={() => onSelectMarket && onSelectMarket(m.symbol)}
                    className={`transition-colors cursor-pointer hover:bg-slate-800/50 ${
                      isSelected ? 'bg-slate-800/70' : ''
                    }`}
                  >
                    <td className="py-2.5 font-bold text-white text-[11px] flex items-center gap-1.5">
                      <span>{m.displaySymbol}</span>
                    </td>

                    <td className="py-2.5 text-right font-bold text-slate-200 text-xs">
                      {m.price.toFixed(m.symbol === 'USDJPY' ? 2 : m.symbol === 'XAUUSD' ? 2 : 4)}
                    </td>

                    <td className="py-2.5 text-right">
                      <span
                        className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${
                          isPositive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isPositive ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        <span>
                          {isPositive ? '+' : ''}
                          {m.changePct.toFixed(2)}%
                        </span>
                      </span>
                    </td>

                    <td className="py-2.5 text-right text-slate-400 text-[10px] hidden sm:table-cell">
                      {m.spread.toFixed(1)} pip
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-500 flex items-center justify-between">
        <span>Zero Re-quote Latency</span>
        <span className="text-slate-400">ECN Liquidity</span>
      </div>
    </div>
  );
};
