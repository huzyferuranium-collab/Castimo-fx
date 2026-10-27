import React, { useEffect, useState } from 'react';
import { Cpu, Search, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { authHeaders } from '../../services/apiAuth';

type MasterTrade = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  openedAt: string | null;
};

type ConsoleState = 'SEARCHING' | 'TRADE' | 'NO_TRADE' | 'UNAVAILABLE';

/**
 * Shows what the master terminal is really doing. Every line comes from the server's view of the
 * master account's open positions. Nothing here is generated, randomised or estimated, and no
 * confidence figure is shown because none exists.
 */
export const RobotConsole: React.FC = () => {
  const [state, setState] = useState<ConsoleState>('SEARCHING');
  const [trades, setTrades] = useState<MasterTrade[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/trade/robot-state', { headers: await authHeaders() });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        setState(data.state === 'TRADE' || data.state === 'NO_TRADE' ? data.state : 'UNAVAILABLE');
        setTrades(Array.isArray(data.trades) ? data.trades : []);
        setUpdatedAt(data.updatedAt || null);
      } catch {
        if (cancelled) return;
        setState('UNAVAILABLE');
        setTrades([]);
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const first = trades[0];
  const headline =
    state === 'SEARCHING'
      ? 'Searching…'
      : state === 'UNAVAILABLE'
      ? 'Trade data unavailable'
      : state === 'NO_TRADE'
      ? 'No active trade found'
      : `TRADE FOUND: ${first?.side}`;
  const tone =
    state === 'TRADE'
      ? first?.side === 'SELL'
        ? 'text-rose-400 border-rose-500/40'
        : 'text-emerald-400 border-emerald-500/40'
      : state === 'UNAVAILABLE'
      ? 'text-amber-400 border-amber-500/40'
      : 'text-slate-300 border-slate-700';

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 text-white space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
          <Cpu className="w-4 h-4 text-cyan-400" />
          <span>Robot Console</span>
        </div>
        {updatedAt && state !== 'UNAVAILABLE' && (
          <span className="text-[10px] font-mono text-slate-500">
            Updated {new Date(updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className={`flex items-center gap-2 rounded-xl border bg-slate-950 px-4 py-3 font-mono text-sm font-bold ${tone}`}>
        {state === 'SEARCHING' && <Search className="w-4 h-4 animate-pulse" />}
        {state === 'UNAVAILABLE' && <AlertTriangle className="w-4 h-4" />}
        {state === 'TRADE' && (first?.side === 'SELL' ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />)}
        <span>{headline}</span>
      </div>

      {state === 'TRADE' && (
        <ul className="space-y-1.5">
          {trades.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono">
              <span className={t.side === 'SELL' ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>{t.side}</span>
              <span className="text-slate-200">{t.symbol}</span>
              <span className="text-slate-400">{t.volume} lot @ {t.openPrice}</span>
            </li>
          ))}
        </ul>
      )}

      {state === 'UNAVAILABLE' && (
        <p className="text-[11px] text-slate-400">Live trade information could not be read right now. This is not the same as having no trade.</p>
      )}
    </div>
  );
};
