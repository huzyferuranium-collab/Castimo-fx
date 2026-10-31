import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, History, Terminal } from 'lucide-react';
import { ActivityEvent, getActivity } from '../../services/marketApi';

const clock = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/**
 * What the master really did since the server last started: its newly opened trades ("signals") and a log of
 * opened / changed / closed trades and how many clients received a copy. An empty list simply means nothing has
 * happened yet. Nothing here is generated, scored or estimated.
 */
export const ActivityPanel: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [data, setData] = useState<{ live: boolean; events: ActivityEvent[]; signals: ActivityEvent[] } | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const r = await getActivity();
      if (!cancelled) setData(r);
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const empty = 'Nothing yet. Entries appear here when the master opens, changes or closes a trade.';

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 ${className}`}>
      <div className="rounded-2xl bg-slate-900/95 border border-slate-800 p-4 sm:p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-black tracking-wider uppercase text-white font-mono">Recent Signals</h3>
          </div>
          <span className="text-[10px] font-mono text-slate-500">SINCE SERVER START</span>
        </div>
        {data === undefined && <p className="text-xs text-slate-500">Loading…</p>}
        {data === null && <p className="text-xs text-slate-500">Could not be loaded right now.</p>}
        {data && data.signals.length === 0 && <p className="text-xs text-slate-500">{empty}</p>}
        {data && data.signals.length > 0 && (
          <div className="divide-y divide-slate-800/60 font-mono text-xs max-h-[260px] overflow-y-auto">
            {data.signals.map((s) => {
              const buy = s.side === 'BUY';
              return (
                <div key={s.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded flex items-center justify-center ${buy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                      {buy ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                    </span>
                    <div>
                      <span className="font-bold text-white text-[11px]">{s.symbol}</span>{' '}
                      <span className={`text-[9px] font-bold px-1 rounded ${buy ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>{s.side}</span>
                      <span className="text-[10px] text-slate-500 block">
                        {s.volume ? `${s.volume} lots` : ''}
                        {s.price ? ` at ${s.price}` : ''}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500">{clock(s.at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-slate-900/95 border border-slate-800 p-4 sm:p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-black tracking-wider uppercase text-white font-mono">Activity Log</h3>
          </div>
          <span className={`text-[10px] font-mono ${data?.live ? 'text-emerald-400' : 'text-slate-500'}`}>
            {data?.live ? 'MASTER CONNECTED' : 'MASTER OFFLINE'}
          </span>
        </div>
        {data && data.events.length === 0 && <p className="text-xs text-slate-500">{empty}</p>}
        {data && data.events.length > 0 && (
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto font-mono text-[11px]">
            {data.events.map((e) => (
              <div key={e.id} className="flex items-start gap-2.5 p-1.5 rounded-lg hover:bg-slate-800/40">
                <span className="text-slate-500 text-[10px] shrink-0">{clock(e.at)}</span>
                <span className={`flex-1 leading-snug ${e.kind === 'master_opened' ? 'text-amber-400 font-bold' : 'text-slate-300'}`}>{e.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
