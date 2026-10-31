import { authHeaders } from './apiAuth';

export interface MarketRow {
  symbol: string;
  available: boolean;
  bid?: number;
  ask?: number;
  spread?: number;
  quotedAt?: string | null;
  digits?: number;
}

export interface ActivityEvent {
  id: string;
  at: string;
  kind: 'master_opened' | 'master_modified' | 'master_closed' | 'copied';
  symbol: string;
  side?: 'BUY' | 'SELL';
  volume?: number;
  price?: number;
  text: string;
}

export async function getMarketWatch(): Promise<{ live: boolean; markets: MarketRow[] } | null> {
  try {
    const res = await fetch('/api/trade/market-watch', { headers: await authHeaders() });
    if (!res.ok) return null;
    const d = await res.json();
    return d.success ? { live: Boolean(d.live), markets: Array.isArray(d.markets) ? d.markets : [] } : null;
  } catch {
    return null;
  }
}

export async function getActivity(): Promise<{ live: boolean; events: ActivityEvent[]; signals: ActivityEvent[] } | null> {
  try {
    const res = await fetch('/api/trade/activity', { headers: await authHeaders() });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.success) return null;
    return {
      live: Boolean(d.live),
      events: Array.isArray(d.events) ? d.events : [],
      signals: Array.isArray(d.signals) ? d.signals : [],
    };
  } catch {
    return null;
  }
}
