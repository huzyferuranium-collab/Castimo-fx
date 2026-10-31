import React, { useState, useEffect, useCallback } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import { authHeaders } from '../../services/apiAuth';
import { Collapsible } from '../common/Collapsible';
import {
  RefreshCw,
  ExternalLink,
  Zap,
} from 'lucide-react';

interface MasterAccountPanelProps {
  onTradeBroadcasted?: (msg: string) => void;
}

interface CloudMaster {
  accountId: string;
  login: string;
  server: string;
  balance: number;
  equity: number;
  freeMargin: number;
  currency: string;
  openPositionsCount: number;
}

interface CloudStatus {
  connected: boolean;
  state: string;
  connectionStatus: string;
  lastPing: string;
  mode: string;
  master: CloudMaster | null;
  activeClientsCount: number;
}

const fmtMoney = (n: number | undefined, currency?: string): string =>
  `${currency && currency !== 'USD' ? `${currency} ` : '$'}${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The master account as the copier service (Duplikium) reports it. Only what the service has actually
 * reported is shown. Copying itself is run by Duplikium from the master account set up there: to pause it or
 * change the master, use the Duplikium dashboard.
 */
export const MasterAccountPanel: React.FC<MasterAccountPanelProps> = ({ onTradeBroadcasted }) => {
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchCloudStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/trade/account-status');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setCloud({
        connected: Boolean(data.connected),
        state: String(data.status || ''),
        connectionStatus: String(data.connectionStatus || ''),
        lastPing: String(data.lastPing || ''),
        mode: String(data.mode || ''),
        master: data.master || null,
        activeClientsCount: Number(data.activeClientsCount) || 0,
      });
      setLoadError(false);
      if (data.master) tradingEngine.syncMasterAccountFromCloud(data.master, data.activeClientsCount);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    fetchCloudStatus();
    const interval = setInterval(fetchCloudStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchCloudStatus]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchCloudStatus();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  const handleCheck = async () => {
    setIsChecking(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/trade/retry-master', { method: 'POST', headers: await authHeaders() });
      const data = await res.json().catch(() => ({} as any));
      const text = data.message || data.error || 'The check did not return a result.';
      setFeedback(text);
      if (onTradeBroadcasted) onTradeBroadcasted(text);
      await fetchCloudStatus();
    } catch {
      setFeedback('Could not reach the server.');
    } finally {
      setIsChecking(false);
    }
  };

  const connected = Boolean(cloud?.connected);
  // The first read from the service stamps lastPing; before that the numbers are placeholders and are not shown.
  const hasFigures = connected && Boolean(cloud?.lastPing) && Boolean(cloud?.master);
  const m = cloud?.master;

  return (
    <div className="bg-slate-900 border border-purple-800/60 rounded-2xl shadow-xl overflow-hidden text-slate-100">
      <div className="px-4 py-3.5 flex items-center justify-between gap-3 border-b border-slate-800/80">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white font-mono">{m?.login ? `#${m.login}` : 'Not reported yet'}</h3>
            {cloud === null ? (
              <span className="text-[11px] text-slate-400">{loadError ? 'Status unavailable' : 'Reading…'}</span>
            ) : connected ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                Not connected
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
            {m?.server || 'Server not reported'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer shrink-0"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-purple-400' : ''}`} />
        </button>
      </div>

      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-950/60">
        <div className="px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 min-w-0">
          <span className="text-[11px] text-slate-400 block">Equity</span>
          <span className={`font-mono text-sm font-semibold block truncate ${hasFigures ? 'text-emerald-400' : 'text-slate-500'}`}>
            {hasFigures ? fmtMoney(m!.equity, m!.currency) : '—'}
          </span>
          <span className="text-[10px] text-slate-500 font-mono block truncate">
            {hasFigures ? `Balance ${fmtMoney(m!.balance, m!.currency)}` : 'Not reported'}
          </span>
        </div>
        <div className="px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 min-w-0">
          <span className="text-[11px] text-slate-400 block">Free margin</span>
          <span className={`font-mono text-sm font-semibold block truncate ${hasFigures ? 'text-white' : 'text-slate-500'}`}>
            {hasFigures ? fmtMoney(m!.freeMargin, m!.currency) : '—'}
          </span>
        </div>
        <div className="px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 min-w-0">
          <span className="text-[11px] text-slate-400 block">Open trades</span>
          <span className={`font-mono text-sm font-semibold block ${hasFigures ? 'text-amber-400' : 'text-slate-500'}`}>
            {hasFigures ? m!.openPositionsCount : '—'}
          </span>
        </div>
        <div className="px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 min-w-0">
          <span className="text-[11px] text-slate-400 block">Clients</span>
          <span className="font-mono text-sm font-semibold text-blue-400 block">{cloud ? cloud.activeClientsCount : '—'}</span>
          <span className="text-[10px] text-slate-500 block truncate">
            {cloud?.lastPing ? `Read ${new Date(cloud.lastPing).toLocaleTimeString()}` : 'No reading yet'}
          </span>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-slate-800/80 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400 min-w-0">
            {connected ? 'Connected at Duplikium.' : 'Not connected at Duplikium.'}
            {cloud?.connectionStatus ? <span className="font-mono text-slate-300"> {cloud.connectionStatus}</span> : null}
          </p>
          <div className="flex items-center gap-2">
            <a
              href="https://trade-copier.com"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>Duplikium</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>
            <button
              type="button"
              onClick={handleCheck}
              disabled={isChecking}
              className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Zap className={`w-3.5 h-3.5 text-amber-300 ${isChecking ? 'animate-bounce' : ''}`} />
              <span>{isChecking ? 'Checking…' : 'Check connection'}</span>
            </button>
          </div>
        </div>

        {feedback && (
          <div className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 break-words">{feedback}</div>
        )}

        <Collapsible title="About copying" openLabel="Details" closeLabel="Hide">
          <p>Every trade placed or closed on the master account is copied to the connected client accounts by Duplikium.</p>
          <p>To pause copying or change the master account, use the Duplikium dashboard. Balances there refresh after each trade and about every five minutes.</p>
          <p>The full step-by-step check (sign-in, master, template, master trades) is under the Duplikium tab.</p>
        </Collapsible>
      </div>
    </div>
  );
};
