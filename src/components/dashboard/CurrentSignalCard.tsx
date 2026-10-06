import React from 'react';
import { AiSignal } from '../../services/aiRobotState';
import { Zap, ArrowUpRight, ArrowDownRight, Clock, ShieldCheck } from 'lucide-react';

interface CurrentSignalCardProps {
  signal: AiSignal | null;
  onExecuteTrade?: (symbol: string, direction: 'BUY' | 'SELL') => void;
  className?: string;
}

export const CurrentSignalCard: React.FC<CurrentSignalCardProps> = ({
  signal,
  onExecuteTrade,
  className = '',
}) => {
  if (!signal) {
    return (
      <div
        className={`rounded-md bg-[#090D16] border border-white/5 p-3 shadow-sm flex items-center justify-center text-center text-slate-500 font-mono text-[11px] select-none ${className}`}
      >
        <span>Awaiting algorithmic market signal...</span>
      </div>
    );
  }

  const isBuy = signal.direction === 'BUY';

  return (
    <div
      className={`rounded-md bg-[#090D16] border border-white/5 p-2.5 sm:p-3 shadow-sm flex flex-col justify-between select-none font-mono ${className}`}
    >
      <div>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 pb-2">
          <div className="flex items-center gap-1.5">
            <Zap className={`w-3.5 h-3.5 ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`} />
            <h3 className="text-[11px] font-bold tracking-wider uppercase text-white">
              ACTIVE SIGNAL
            </h3>
          </div>
          <span className="text-[9px] text-slate-500 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            <span>{signal.timestamp} UTC</span>
          </span>
        </div>

        {/* Hero Pair & Direction */}
        <div className="mt-2.5 flex items-center justify-between">
          <div>
            <div className="text-sm sm:text-base font-black text-white tracking-wide">
              {signal.symbol}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-xs text-[10px] font-bold border ${
                  isBuy
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                }`}
              >
                {isBuy ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                <span>{signal.direction}</span>
              </span>
              <span className="text-[10px] text-cyan-400 font-semibold">{signal.timeframe}</span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[9px] text-slate-500 uppercase block">CONFIDENCE</span>
            <span
              className={`text-base sm:text-lg font-black ${
                signal.confidence >= 80 ? 'text-emerald-400' : 'text-cyan-300'
              }`}
            >
              {signal.confidence}%
            </span>
          </div>
        </div>

        {/* Rationale */}
        <div className="mt-2 p-1.5 rounded-xs bg-slate-950/80 border border-white/5 text-[10px] text-slate-300 leading-snug">
          <span className="text-slate-500 block uppercase text-[8px] tracking-wider mb-0.5">ALGO RATIONALE</span>
          <p className="line-clamp-2">{signal.analysis}</p>
        </div>

        {/* Trade Parameters (Entry / SL / TP) */}
        <div className="grid grid-cols-3 gap-1.5 mt-2 text-[9px]">
          <div className="p-1 rounded-xs bg-slate-950/60 border border-white/5">
            <span className="text-slate-500 block">ENTRY</span>
            <span className="text-white font-bold">{signal.entryPrice}</span>
          </div>
          <div className="p-1 rounded-xs bg-slate-950/60 border border-white/5">
            <span className="text-slate-500 block">STOP LOSS</span>
            <span className="text-rose-400 font-bold">{signal.stopLoss}</span>
          </div>
          <div className="p-1 rounded-xs bg-slate-950/60 border border-white/5">
            <span className="text-slate-500 block">TAKE PROFIT</span>
            <span className="text-emerald-400 font-bold">{signal.takeProfit}</span>
          </div>
        </div>
      </div>

      {/* Action Button */}
      {onExecuteTrade && (
        <div className="mt-2.5 pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={() => onExecuteTrade(signal.symbol.replace('/', ''), signal.direction)}
            className={`w-full py-1.5 px-2 rounded-xs font-bold text-[10px] transition cursor-pointer flex items-center justify-center gap-1 active:scale-98 ${
              isBuy
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-xs'
                : 'bg-rose-500 hover:bg-rose-400 text-white shadow-xs'
            }`}
          >
            <ShieldCheck className="w-3 h-3" />
            <span>Mirror Signal to MT5</span>
          </button>
        </div>
      )}
    </div>
  );
};
