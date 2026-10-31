import React, { useEffect, useState } from 'react';
import { AITradingAssistant, ConsoleState, MasterTrade } from './AITradingAssistant';
import { authHeaders } from '../../services/apiAuth';
import { HumanoidAiRobot } from './HumanoidAiRobot';


/**
 * Shows what the master terminal is really doing. Every line comes from the server's view of the
 * master account's open positions. Nothing here is generated, randomised or estimated, and no
 * confidence figure is shown because none exists.
 */
export const RobotConsole: React.FC = () => {
  const [state, setState] = useState<ConsoleState>('SEARCHING');
  const [trades, setTrades] = useState<MasterTrade[]>([]);

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
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-900/95 border border-slate-800 overflow-hidden">
        {/* The graphic is decorative. Its words come only from the master's real state. */}
        <HumanoidAiRobot state={state} currentMarket={state === 'TRADE' ? first?.symbol || '' : ''} direction={first?.side} />
      </div>
      <AITradingAssistant state={state} trades={trades} />
    </div>
  );
};
