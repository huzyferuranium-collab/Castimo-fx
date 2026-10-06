import React from 'react';
import { MarketItem, TechnicalMetrics } from '../../services/aiRobotState';
import { Radar, Activity, BarChart2 } from 'lucide-react';

interface AiMarketScannerProps {
  markets: MarketItem[];
  metrics: TechnicalMetrics;
  className?: string;
}

export const AiMarketScanner: React.FC<AiMarketScannerProps> = ({
  markets,
  metrics,
  className = '',
}) => {
  return (
    <div
      className={`rounded-2xl bg-slate-900/95 border border-slate-800 p-4 sm:p-5 shadow-xl flex flex-col justify-between backdrop-blur-md ${className}`}
    >
      {/* Upper Section: AI Market Scanner Matrix */}
      <div>
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <Radar className="w-4 h-4 text-cyan-400 animate-spin" style={{ animationDuration: '10s' }} />
            <h3 className="text-xs font-black tracking-wider uppercase text-white font-mono">
              AI MARKET SCANNER
            </h3>
          </div>
          <span className="text-[10px] font-mono text-slate-500">LIVE ALGO FEED</span>
        </div>

        {/* Real-Time Market Status List */}
        <div className="space-y-1.5 font-mono text-xs">
          {markets.map((m) => {
            const isScanning = m.status === 'SCANNING';
            const isAnalyzing = m.status === 'ANALYZING';
            const isSignal = m.status === 'SIGNAL';

            return (
              <div
                key={m.symbol}
                className="flex items-center justify-between p-2 rounded-xl bg-slate-950/70 border border-slate-800/80 transition-colors hover:border-slate-700"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-[11px]">{m.displaySymbol}</span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {m.price.toFixed(m.symbol === 'USDJPY' ? 2 : m.symbol === 'XAUUSD' ? 2 : 4)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {m.changePct !== undefined && (
                    <span
                      className={`text-[10px] font-semibold ${
                        m.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {m.changePct >= 0 ? '+' : ''}
                      {m.changePct.toFixed(2)}%
                    </span>
                  )}

                  <span
                    className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 border ${
                      isSignal
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                        : isAnalyzing
                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                        : isScanning
                        ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSignal
                          ? 'bg-amber-400'
                          : isAnalyzing
                          ? 'bg-cyan-400 animate-pulse'
                          : isScanning
                          ? 'bg-blue-400'
                          : 'bg-slate-500'
                      }`}
                    />
                    <span>{m.status}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lower Section: Market Analysis Technical Metrics */}
      <div className="mt-4 pt-3 border-t border-slate-800/80">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs font-mono">
            <BarChart2 className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-bold uppercase text-[11px]">TECHNICAL METRICS</span>
          </div>
          <span className="text-[9px] font-mono text-cyan-400">15M AGGREGATE</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
          {/* RSI */}
          <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span>RSI (14)</span>
              <span className="font-bold text-cyan-400">{metrics.rsi}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-300"
                style={{ width: `${metrics.rsi}%` }}
              />
            </div>
          </div>

          {/* MACD */}
          <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-500">MACD</span>
            <span className="font-bold text-emerald-400">{metrics.macd}</span>
          </div>

          {/* TREND */}
          <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-500">TREND</span>
            <span className="font-bold text-emerald-400">{metrics.trend}</span>
          </div>

          {/* MOMENTUM */}
          <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-500">MOMENTUM</span>
            <span className="font-bold text-cyan-300">{metrics.momentum}</span>
          </div>

          {/* VOLUME */}
          <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-500">VOLUME</span>
            <span className="font-bold text-white">{metrics.volume}</span>
          </div>

          {/* LIQUIDITY */}
          <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-500">LIQUIDITY</span>
            <span className="font-bold text-emerald-400">{metrics.liquidity}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
