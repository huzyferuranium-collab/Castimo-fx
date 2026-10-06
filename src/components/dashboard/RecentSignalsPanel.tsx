import React from 'react';
import { AiSignal } from '../../services/aiRobotState';
import { History, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface RecentSignalsPanelProps {
  signals: AiSignal[];
  className?: string;
}

export const RecentSignalsPanel: React.FC<RecentSignalsPanelProps> = ({
  signals,
  className = '',
}) => {
  return (
    <div
      className={`rounded-2xl bg-slate-900/95 border border-slate-800 p-4 sm:p-5 shadow-xl backdrop-blur-md flex flex-col justify-between ${className}`}
    >
      <div>
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-black tracking-wider uppercase text-white font-mono">
              RECENT SIGNALS
            </h3>
          </div>
          <span className="text-[10px] font-mono text-slate-500">PAST 24H</span>
        </div>

        <div className="divide-y divide-slate-800/60 font-mono text-xs">
          {signals.map((s) => {
            const isBuy = s.direction === 'BUY';

            return (
              <div key={s.id} className="py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
                      isBuy
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {isBuy ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                  </span>

                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white text-[11px]">{s.symbol}</span>
                      <span
                        className={`text-[9px] font-bold px-1 rounded ${
                          isBuy ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'
                        }`}
                      >
                        {s.direction}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 block truncate max-w-[160px]">
                      {s.analysis}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-xs font-black text-cyan-400">{s.confidence}%</span>
                    <span className="text-[9px] text-slate-500">{s.timestamp}</span>
                  </div>
                  {/* Small confidence meter bar */}
                  <div className="w-16 h-1 rounded-full bg-slate-800 overflow-hidden ml-auto mt-1">
                    <div
                      className={`h-full ${
                        s.confidence >= 80 ? 'bg-emerald-400' : 'bg-cyan-400'
                      }`}
                      style={{ width: `${s.confidence}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-500 flex items-center justify-between">
        <span>Verified AI Algorithm</span>
        <span className="text-emerald-400 font-semibold">100% Systematic</span>
      </div>
    </div>
  );
};
