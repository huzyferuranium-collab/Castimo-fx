import React, { useEffect, useState } from 'react';
import { AITradingAssistant, ConsoleState, MasterTrade } from './AITradingAssistant';
import { authHeaders } from '../../services/apiAuth';


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

  return <AITradingAssistant state={state} trades={trades} />;
};
