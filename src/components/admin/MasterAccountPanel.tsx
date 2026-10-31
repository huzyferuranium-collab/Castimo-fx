import React, { useState, useEffect, useCallback } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import { authHeaders } from '../../services/apiAuth';
import {
  Server,
  Radio,
  RefreshCw,
  TrendingUp,
  Activity,
  Users,
  ShieldCheck,
  Cloud,
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
    <div className="bg-slate-900 border border-purple-800/60 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
      <div className="p-5 bg-gradient-to-r from-purple-950/70 via-slate-900 to-slate-900 border-b border-purple-800/40 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shadow-lg shadow-purple-950/50 shrink-0">
            <Radio className={`w-6 h-6 ${connected ? 'animate-pulse text-purple-300' : 'text-slate-400'}`} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase font-mono font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">
                Master account
              </span>
              {cloud === null ? (
                <span className="text-[11px] font-bold text-slate-400">{loadError ? 'Status unavailable' : 'Reading…'}</span>
              ) : connected ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>CONNECTED AT DUPLIKIUM</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                  <span className="w-2 h-2 rounded-full bg-rose-400" />
                  <span>NOT CONNECTED</span>
                </span>
              )}
            </div>
            <h3 className="text-lg font-black text-white mt-1">
              {m?.login ? `Master MT5 account #${m.login}` : 'Master MT5 account'}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Every trade placed or closed on the master account is copied to the connected client accounts by Duplikium.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-purple-400' : ''}`} />
        </button>
      </div>

      <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-950/70 border-b border-slate-800/80">
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
            <span>MASTER ACCOUNT #</span>
            <Server className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="font-mono text-base font-black text-white">{m?.login || 'not reported'}</div>
          <div className="text-[10px] text-slate-400 font-mono truncate">{m?.server || 'not reported'}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
            <span>MASTER EQUITY</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className={`font-mono text-base font-black ${hasFigures ? 'text-emerald-400' : 'text-slate-500'}`}>
            {hasFigures ? fmtMoney(m!.equity, m!.currency) : 'not reported'}
          </div>
          <div className="text-[10px] text-slate-400 font-mono">
            {hasFigures ? `Balance: ${fmtMoney(m!.balance, m!.currency)}` : 'Waiting for the first reading'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
            <span>CONNECTED CLIENTS</span>
            <Users className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="font-mono text-base font-black text-blue-400">{cloud ? cloud.activeClientsCount : '—'}</div>
          <div className="text-[10px] text-slate-400 font-mono">
            {cloud && cloud.activeClientsCount > 0 ? 'Verified client accounts' : 'No verified clients yet'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
            <span>OPEN TRADES</span>
            <Activity className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className={`font-mono text-base font-black ${hasFigures ? 'text-amber-400' : 'text-slate-500'}`}>
            {hasFigures ? m!.openPositionsCount : 'not reported'}
          </div>
          <div className="text-[10px] text-slate-400 font-mono">
            {cloud?.lastPing ? `Last reading ${new Date(cloud.lastPing).toLocaleTimeString()}` : 'No reading yet'}
          </div>
        </div>
      </div>

      <div className="p-4 bg-slate-950/40 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5 text-slate-300">
          <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0" />
          <span>
            <strong>Copying is run by Duplikium.</strong> To pause copying or change the master account, use the Duplikium dashboard. Balances there refresh after each trade and about every five minutes.
          </span>
        </div>
      </div>

      <div className="p-4 bg-gradient-to-r from-purple-950/40 via-slate-900 to-slate-900 border-t border-purple-900/30 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-xs sm:text-sm text-white">Duplikium connection</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {connected
                  ? 'The master account is connected and being read.'
                  : 'The master account is not connected. Use the check to see why.'}
                {cloud?.connectionStatus ? (
                  <>
                    {' '}State: <span className="font-mono text-slate-300">{cloud.connectionStatus}</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href="https://trade-copier.com"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded-xl border border-purple-800/60 bg-purple-950/40 hover:bg-purple-900/40 text-purple-200 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>Duplikium dashboard</span>
              <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
            </a>

            <button
              type="button"
              onClick={handleCheck}
              disabled={isChecking}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-md shadow-purple-950/40 disabled:opacity-50"
            >
              <Zap className={`w-3.5 h-3.5 text-amber-300 ${isChecking ? 'animate-bounce' : ''}`} />
              <span>{isChecking ? 'Checking…' : 'Check master connection'}</span>
            </button>
          </div>
        </div>

        {feedback && (
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 break-words">
            {feedback}
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          The full step-by-step check (sign-in, master, template, master trades) is under the Duplikium accounts tab.
        </p>
      </div>
    </div>
  );
};
