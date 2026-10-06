import React, { useState, useEffect } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import { CopiedTrade } from '../../types';
import {
  History,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  RefreshCw,
  Search,
  Filter,
  DollarSign,
  Award,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
} from 'lucide-react';

interface TradeHistoryProps {
  limit?: number;
  accountNumber?: string;
  className?: string;
}

export const TradeHistory: React.FC<TradeHistoryProps> = ({
  limit = 10,
  accountNumber,
  className = '',
}) => {
  const [trades, setTrades] = useState<CopiedTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchHistory = () => {
    setLoading(true);
    // Simulating sub-50ms MT5 bridge query
    const data = tradingEngine.getTradeHistory(limit);
    setTrades(data);
    setLastRefreshed(new Date());
    setTimeout(() => setLoading(false), 250);
  };

  useEffect(() => {
    fetchHistory();
    const unsubscribe = tradingEngine.subscribe(() => {
      setTrades(tradingEngine.getTradeHistory(limit));
    });
    return () => unsubscribe();
  }, [limit]);

  // Unique symbols for quick filters
  const symbols = ['ALL', ...Array.from(new Set(trades.map((t) => t.symbol)))];

  // Filtered trades
  const filteredTrades = trades.filter((trade) => {
    const matchesSymbol = selectedSymbol === 'ALL' || trade.symbol === selectedSymbol;
    const matchesSearch =
      trade.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      trade.masterTradeId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      trade.direction.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSymbol && matchesSearch;
  });

  // Performance calculations on fetched history
  const totalProfit = trades.reduce((sum, t) => sum + t.pnl, 0);
  const winCount = trades.filter((t) => t.pnl > 0).length;
  const lossCount = trades.filter((t) => t.pnl < 0).length;
  const winRate = trades.length > 0 ? (winCount / trades.length) * 100 : 0;

  const formatTimestamp = (dateString: string) => {
    try {
      const d = new Date(dateString);
      return {
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      };
    } catch {
      return { date: dateString, time: '' };
    }
  };

  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden text-slate-100 ${className}`}>
      {/* Header with Title and Quick Stats */}
      <div className="p-5 border-b border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <History className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm sm:text-base text-white">
                  Executed Trade History
                </h3>
                <span className="text-[10px] font-mono font-bold bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
                  Last {trades.length} Executions
                </span>
                {accountNumber && (
                  <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">
                    #{accountNumber}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Confirmed MT5 bridge closures with verified entry timestamps, exit prices, and net profits.
              </p>
            </div>
          </div>
        </div>

        {/* Action Button: Manual Refresh */}
        <button
          onClick={fetchHistory}
          disabled={loading}
          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          title="Query latest MT5 trade records"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          <span>{loading ? 'Fetching...' : 'Sync History'}</span>
        </button>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-800 border-b border-slate-800 text-xs">
        <div className="bg-slate-950/70 p-3 sm:p-4">
          <span className="text-[10px] text-slate-500 block uppercase font-bold">Total Net Profit</span>
          <div className={`text-base sm:text-lg font-black font-mono mt-0.5 ${totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalProfit >= 0 ? `+$${totalProfit.toFixed(2)}` : `-$${Math.abs(totalProfit).toFixed(2)}`}{' '}
            <span className="text-[10px] font-normal text-slate-400">USD</span>
          </div>
        </div>

        <div className="bg-slate-950/70 p-3 sm:p-4">
          <span className="text-[10px] text-slate-500 block uppercase font-bold">Win Rate</span>
          <div className="text-base sm:text-lg font-black font-mono text-white mt-0.5 flex items-center gap-1.5">
            <span>{winRate.toFixed(1)}%</span>
            <span className="text-[10px] font-semibold text-emerald-400">
              ({winCount}W / {lossCount}L)
            </span>
          </div>
        </div>

        <div className="bg-slate-950/70 p-3 sm:p-4">
          <span className="text-[10px] text-slate-500 block uppercase font-bold">Closed Positions</span>
          <div className="text-base sm:text-lg font-black font-mono text-slate-200 mt-0.5">
            {trades.length} Trades
          </div>
        </div>

        <div className="bg-slate-950/70 p-3 sm:p-4">
          <span className="text-[10px] text-slate-500 block uppercase font-bold">50% Profit Share Base</span>
          <div className="text-base sm:text-lg font-black font-mono text-amber-400 mt-0.5">
            ${Math.max(0, totalProfit * 0.5).toFixed(2)}{' '}
            <span className="text-[10px] font-normal text-slate-400">USDT</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-3.5 bg-slate-950/40 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <span className="text-[11px] text-slate-500 font-semibold flex items-center gap-1 mr-1">
            <Filter className="w-3 h-3" />
            <span>Pair:</span>
          </span>
          {symbols.map((sym) => (
            <button
              key={sym}
              onClick={() => setSelectedSymbol(sym)}
              className={`px-2.5 py-1 rounded-lg font-semibold text-xs transition cursor-pointer ${
                selectedSymbol === sym
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {sym}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-48">
          <input
            type="text"
            placeholder="Search symbol, ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
        </div>
      </div>

      {/* MOBILE VIEW: Touch-friendly cards for smaller screens (< md) */}
      <div className="block md:hidden divide-y divide-slate-800/60">
        {filteredTrades.length === 0 ? (
          <div className="py-8 px-4 text-center text-slate-500 font-sans text-xs">
            No executed trades found matching current filter.
          </div>
        ) : (
          filteredTrades.map((trade) => {
            const isBuy = trade.direction === 'BUY';
            const isProfit = trade.pnl >= 0;
            const openTimeFormatted = formatTimestamp(trade.openTime);
            const closeTimeFormatted = trade.closeTime ? formatTimestamp(trade.closeTime) : null;

            return (
              <div key={trade.id} className="p-4 space-y-2 hover:bg-slate-800/30 transition">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${
                        isBuy
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {isBuy ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    </span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-white text-sm">{trade.symbol}</span>
                        <span
                          className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded ${
                            isBuy ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
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
                      {isProfit ? `+$${trade.pnl.toFixed(2)}` : `-$${Math.abs(trade.pnl).toFixed(2)}`}
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      Comm: -${trade.commission.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs font-mono grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Entry → Exit:</span>
                    <span className="text-slate-200">
                      {trade.openPrice.toFixed(trade.symbol.includes('JPY') ? 3 : trade.symbol.includes('XAU') ? 2 : 4)} → {(trade.closePrice || trade.currentPrice).toFixed(trade.symbol.includes('JPY') ? 3 : trade.symbol.includes('XAU') ? 2 : 4)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">Closed At:</span>
                    <span className="text-slate-300">
                      {closeTimeFormatted?.time || openTimeFormatted.time}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Main Trade History Table (Desktop md and above) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 border-b border-slate-800 text-[10px] uppercase font-semibold text-slate-400">
            <tr>
              <th className="py-3 px-4">Symbol / Type</th>
              <th className="py-3 px-4">Volume</th>
              <th className="py-3 px-4">Entry Time (UTC)</th>
              <th className="py-3 px-4">Exit Time</th>
              <th className="py-3 px-4">Execution Prices</th>
              <th className="py-3 px-4 text-right">Profit / PnL</th>
              <th className="py-3 px-4 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {filteredTrades.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                  No executed trades found matching current filter.
                </td>
              </tr>
            ) : (
              filteredTrades.map((trade) => {
                const isBuy = trade.direction === 'BUY';
                const isProfit = trade.pnl >= 0;
                const openTimeFormatted = formatTimestamp(trade.openTime);
                const closeTimeFormatted = trade.closeTime ? formatTimestamp(trade.closeTime) : null;

                return (
                  <tr key={trade.id} className="hover:bg-slate-800/40 transition">
                    {/* Symbol & Direction */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                            isBuy
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                          }`}
                        >
                          {isBuy ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        </span>
                        <div>
                          <span className="font-bold text-white text-xs">{trade.symbol}</span>
                          <span
                            className={`ml-1.5 text-[9px] font-bold uppercase px-1.5 py-0.2 rounded ${
                              isBuy ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
                            }`}
                          >
                            {trade.direction}
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 font-sans">
                        #{trade.masterTradeId}
                      </div>
                    </td>

                    {/* Volume (Lots) */}
                    <td className="py-3 px-4 font-semibold text-slate-200">
                      {trade.volume.toFixed(2)} <span className="text-[10px] text-slate-500 font-normal">Lots</span>
                    </td>

                    {/* Entry Time */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 text-slate-200">
                        <Clock className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="font-semibold">{openTimeFormatted.time}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {openTimeFormatted.date}
                      </div>
                    </td>

                    {/* Exit Time */}
                    <td className="py-3 px-4">
                      {closeTimeFormatted ? (
                        <>
                          <div className="text-slate-300 font-semibold">
                            {closeTimeFormatted.time}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {closeTimeFormatted.date}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>

                    {/* Execution Prices */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-slate-400">{trade.openPrice.toFixed(trade.symbol.includes('JPY') ? 3 : trade.symbol.includes('XAU') ? 2 : 5)}</span>
                        <span className="text-slate-600">→</span>
                        <span className="font-bold text-white">
                          {(trade.closePrice || trade.currentPrice).toFixed(trade.symbol.includes('JPY') ? 3 : trade.symbol.includes('XAU') ? 2 : 5)}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        SL: {trade.sl} • TP: {trade.tp}
                      </div>
                    </td>

                    {/* Profit / PnL */}
                    <td className="py-3 px-4 text-right">
                      <div
                        className={`text-sm font-black font-mono ${
                          isProfit ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isProfit ? `+$${trade.pnl.toFixed(2)}` : `-$${Math.abs(trade.pnl).toFixed(2)}`}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Comm: -${trade.commission.toFixed(2)}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                        <span>{trade.status}</span>
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="p-3 bg-slate-950/80 border-t border-slate-800/80 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span>Showing last {filteredTrades.length} executed positions replicated via MT5 broker bridge</span>
        </div>
        <div>
          <span>Last synced: {lastRefreshed.toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  );
};
