import React, { useState } from 'react';
import { CopiedTrade } from '../../types';
import { price, hasCosts } from '../../utils/tradeFormat';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Shield,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
} from 'lucide-react';

interface TradeCopierTableProps {
  trades: CopiedTrade[];
}

export const TradeCopierTable: React.FC<TradeCopierTableProps> = ({ trades }) => {
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'CLOSED'>('OPEN');

  const filteredTrades = trades.filter((trade) => {
    if (filter === 'ALL') return true;
    return trade.status === filter;
  });

  const openOnes = trades.filter((t) => t.status === 'OPEN');
  const floatingKnown = openOnes.every((t) => t.pnlKnown !== false);
  const totalFloatingPnl = openOnes.reduce((acc, curr) => acc + curr.pnl, 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden text-slate-100">
      {/* Top Header & Mobile Responsive Filters */}
      <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm sm:text-base text-white">
                MT5 Copied Trades
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700">
                Bridge Mirror
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Copied from the Castimofx master account
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
          {/* Floating PnL Pill */}
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-slate-400 font-medium">Floating PnL:</span>
            <span
              className={`text-xs font-mono font-bold ${
                !floatingKnown ? 'text-slate-400' : totalFloatingPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {floatingKnown ? `${totalFloatingPnl >= 0 ? '+' : ''}$${totalFloatingPnl.toFixed(2)}` : '—'}
            </span>
          </div>

          {/* Filter Pills */}
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0">
            <button
              onClick={() => setFilter('OPEN')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition cursor-pointer ${
                filter === 'OPEN'
                  ? 'bg-slate-800 text-emerald-400 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Open ({trades.filter((t) => t.status === 'OPEN').length})
            </button>
            <button
              onClick={() => setFilter('CLOSED')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition cursor-pointer ${
                filter === 'CLOSED'
                  ? 'bg-slate-800 text-slate-200 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              History ({trades.filter((t) => t.status === 'CLOSED').length})
            </button>
            <button
              onClick={() => setFilter('ALL')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition cursor-pointer ${
                filter === 'ALL'
                  ? 'bg-slate-800 text-slate-200 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All
            </button>
          </div>
        </div>
      </div>

      {/* MOBILE VIEW: Touch-friendly cards for smaller screens (< md) */}
      <div className="block md:hidden divide-y divide-slate-800/60">
        {filteredTrades.length === 0 ? (
          <div className="py-8 px-4 text-center text-slate-500 text-xs">
            No copied positions match the current filter.
          </div>
        ) : (
          filteredTrades.map((trade) => {
            const isBuy = trade.direction === 'BUY';
            const hasSide = trade.direction === 'BUY' || trade.direction === 'SELL';
            const isProfit = trade.pnl >= 0;

            return (
              <div key={trade.id} className="p-4 space-y-2.5 hover:bg-slate-800/30 transition">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${
                        isBuy
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : hasSide ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30' : 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
                      }`}
                    >
                      {isBuy ? <ArrowUpRight className="w-4 h-4" /> : hasSide ? <ArrowDownRight className="w-4 h-4" /> : <span>–</span>}
                    </span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-white text-sm">{trade.symbol}</span>
                        <span
                          className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded ${
                            isBuy ? 'text-emerald-400 bg-emerald-500/10' : hasSide ? 'text-rose-400 bg-rose-500/10' : 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
                          }`}
                        >
                          {trade.direction} {trade.volume.toFixed(2)}L
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">
                        #{trade.masterTradeId}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div
                      className={`font-mono text-base font-bold ${
                        isProfit ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {trade.pnlKnown === false ? '—' : `${isProfit ? '+' : ''}$${trade.pnl.toFixed(2)}`}
                    </div>
                    <span
                      className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-semibold ${
                        trade.status === 'OPEN'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {trade.status}
                    </span>
                  </div>
                </div>

                {/* Price & Risk Info */}
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Entry / Current:</span>
                    <span className="text-slate-200">
                      {price(trade.openPrice, trade.symbol.includes('JPY') ? 3 : 5)} → {price(trade.currentPrice, trade.symbol.includes('JPY') ? 3 : 5)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">SL / TP:</span>
                    <span className="text-slate-300">
                      {price(trade.sl, trade.symbol.includes('JPY') ? 3 : 4)} / {price(trade.tp, trade.symbol.includes('JPY') ? 3 : 4)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>
                      {new Date(trade.openTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                  {hasCosts(trade) ? <span>Comm: -${trade.commission.toFixed(2)} • Swap: ${trade.swap.toFixed(2)}</span> : <span />}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* DESKTOP VIEW: Tabular Data Table (md and above) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/60 border-b border-slate-800 text-[10px] font-semibold uppercase text-slate-400 tracking-wider">
            <tr>
              <th className="py-3 px-4">Symbol / Signal</th>
              <th className="py-3 px-4">Direction</th>
              <th className="py-3 px-4">Volume (Lots)</th>
              <th className="py-3 px-4">Entry / Current</th>
              <th className="py-3 px-4">SL / TP</th>
              <th className="py-3 px-4">Commission & Swap</th>
              <th className="py-3 px-4 text-right">Profit / Loss</th>
              <th className="py-3 px-4 text-right">Idempotency Key</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filteredTrades.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500 text-xs">
                  No copied positions match the current filter.
                </td>
              </tr>
            ) : (
              filteredTrades.map((trade) => {
                const isBuy = trade.direction === 'BUY';
            const hasSide = trade.direction === 'BUY' || trade.direction === 'SELL';
                const isProfit = trade.pnl >= 0;

                return (
                  <tr key={trade.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3.5 px-4 font-semibold text-white">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{trade.symbol}</span>
                        <span className="text-[10px] text-slate-400 font-normal">
                          {trade.masterTradeId}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                        {new Date(trade.openTime).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          isBuy
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : hasSide ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
                        }`}
                      >
                        {isBuy ? <TrendingUp className="w-3 h-3" /> : hasSide ? <TrendingDown className="w-3 h-3" /> : <span>–</span>}
                        {trade.direction}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-medium text-slate-200">
                      {trade.volume.toFixed(2)}
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px]">
                      <div className="text-slate-200">{price(trade.openPrice, trade.symbol.includes('JPY') ? 3 : 5)}</div>
                      <div className="text-slate-400 text-[10px]">
                        now: {price(trade.currentPrice, trade.symbol.includes('JPY') ? 3 : 5)}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[10px] text-slate-400">
                      <div>SL: {price(trade.sl, trade.symbol.includes('JPY') ? 3 : 5)}</div>
                      <div>TP: {price(trade.tp, trade.symbol.includes('JPY') ? 3 : 5)}</div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[10px] text-slate-400">
                      {hasCosts(trade) ? (
                        <>
                          <div>Comm: -${trade.commission.toFixed(2)}</div>
                          <div>Swap: ${trade.swap.toFixed(2)}</div>
                        </>
                      ) : (
                        <div>{'\u2014'}</div>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div
                        className={`font-mono text-sm font-bold ${
                          isProfit ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {trade.pnlKnown === false ? '—' : `${isProfit ? '+' : ''}$${trade.pnl.toFixed(2)}`}
                      </div>
                      <span
                        className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-semibold ${
                          trade.status === 'OPEN'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {trade.status}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <span className="font-mono text-[10px] text-slate-500 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                        {trade.idempotencyKey}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
