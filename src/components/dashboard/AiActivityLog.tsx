import React, { useRef, useEffect } from 'react';
import { ActivityLogEntry } from '../../services/aiRobotState';
import { Terminal, Shield } from 'lucide-react';

interface AiActivityLogProps {
  logs: ActivityLogEntry[];
  className?: string;
}

export const AiActivityLog: React.FC<AiActivityLogProps> = ({ logs, className = '' }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [logs]);

  return (
    <div
      className={`rounded-2xl bg-slate-900/95 border border-slate-800 p-4 sm:p-5 shadow-xl backdrop-blur-md flex flex-col justify-between ${className}`}
    >
      <div>
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-black tracking-wider uppercase text-white font-mono">
              AI ACTIVITY LOG
            </h3>
          </div>
          <span className="text-[10px] font-mono text-cyan-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            <span>REAL-TIME STREAM</span>
          </span>
        </div>

        {/* Streaming Log List */}
        <div
          ref={scrollRef}
          className="space-y-2 max-h-[220px] overflow-y-auto no-scrollbar font-mono text-[11px]"
        >
          {logs.map((log) => {
            const isSignal = log.type === 'signal';
            const isAnalyze = log.type === 'analyze';

            return (
              <div
                key={log.id}
                className="flex items-start gap-2.5 p-1.5 rounded-lg hover:bg-slate-800/40 transition-colors"
              >
                <span className="text-slate-500 text-[10px] shrink-0 font-medium">
                  {log.time}
                </span>

                <span
                  className={`flex-1 leading-snug ${
                    isSignal
                      ? 'text-amber-400 font-bold'
                      : isAnalyze
                      ? 'text-cyan-300 font-medium'
                      : 'text-slate-300'
                  }`}
                >
                  {log.text}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-500 flex items-center justify-between">
        <span className="flex items-center gap-1">
          <Shield className="w-3 h-3 text-emerald-400" />
          <span>Execution Protocol:</span>
        </span>
        <span className="text-slate-300 font-semibold">Strict Rule-Based Algorithmic Confluence</span>
      </div>
    </div>
  );
};
