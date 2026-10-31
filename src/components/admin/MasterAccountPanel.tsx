import React, { useState, useEffect } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import { MasterMt5Account } from '../../types';
import { authHeaders } from '../../services/apiAuth';
import {
  Server,
  Zap,
  Radio,
  Play,
  Pause,
  Power,
  RefreshCw,
  TrendingUp,
  Activity,
  Layers,
  Users,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  PlusCircle,
  X,
  Lock,
  RotateCcw,
  Cloud,
  ExternalLink,
} from 'lucide-react';

interface MasterAccountPanelProps {
  onTradeBroadcasted?: (msg: string) => void;
}

export const MasterAccountPanel: React.FC<MasterAccountPanelProps> = ({
  onTradeBroadcasted,
}) => {
  const [masterAccount, setMasterAccount] = useState<MasterMt5Account>(
    tradingEngine.getMasterAccount()
  );
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const unsub = tradingEngine.subscribe(() => {
      const current = tradingEngine.getMasterAccount();
      setMasterAccount({ ...current });
      setBrokerServer(current.brokerServer);
      setAccountNumber(current.accountNumber);
      setAccountName(current.accountName);
    });
    return () => unsub();
  }, []);

  // Quick Trade Broadcast Form
  const [symbol, setSymbol] = useState<'XAUUSD'>('XAUUSD');
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [volume, setVolume] = useState<number>(0.5);

  // Connect Master Form
  const [brokerServer, setBrokerServer] = useState(masterAccount.brokerServer);
  const [accountNumber, setAccountNumber] = useState(masterAccount.accountNumber);
  const [accountName, setAccountName] = useState(masterAccount.accountName);
  const [password, setPassword] = useState('••••••••••••');
  const [isConnecting, setIsConnecting] = useState(false);

  // MetaApi Cloud Deployment & Top-up verification state
  const [metaApiCloud, setMetaApiCloud] = useState<{
    connected: boolean;
    status: string;
    mode: string;
    masterId?: string;
    topUpRequired?: boolean;
    message?: string;
  } | null>(null);
  const [isDeployingMaster, setIsDeployingMaster] = useState(false);
  const [deployFeedback, setDeployFeedback] = useState<string | null>(null);

  const fetchCloudStatus = async () => {
    try {
      const res = await fetch('/api/trade/account-status');
      if (res.ok) {
        const data = await res.json();
        setMetaApiCloud({
          connected: data.connected,
          status: data.status,
          mode: data.mode || 'LIVE_METAAPI',
          masterId: data.master?.accountId,
          topUpRequired: data.topUpNotice?.required,
          message: data.topUpNotice?.message,
        });
        if (data.master) {
          tradingEngine.syncMasterAccountFromCloud(data.master, data.activeClientsCount);
          setMasterAccount({ ...tradingEngine.getMasterAccount() });
          setAccountNumber(data.master.login || masterAccount.accountNumber);
          setBrokerServer(data.master.server || masterAccount.brokerServer);
        }
      }
    } catch {
      // offline
    }
  };

  useEffect(() => {
    fetchCloudStatus();
    const interval = setInterval(fetchCloudStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleVerifyAndDeploy = async () => {
    setIsDeployingMaster(true);
    setDeployFeedback(null);
    try {
      const res = await fetch('/api/trade/retry-master', { method: 'POST', headers: await authHeaders() });
      const data = await res.json();
      if (data.success) {
        setDeployFeedback('✅ ' + (data.message || 'Master MT5 successfully deployed and connected via live WebSocket streaming!'));
        await fetchCloudStatus();
      } else {
        setDeployFeedback(
          data.topUpRequired
            ? '⚠️ MetaApi requires account top-up before deployment. Please top up at app.metaapi.cloud, then click Verify again.'
            : (data.message || 'Deployment check failed. Please verify credentials.')
        );
      }
    } catch (err: any) {
      setDeployFeedback('❌ Network error: ' + err.message);
    } finally {
      setIsDeployingMaster(false);
    }
  };

  const handleToggleBroadcast = () => {
    tradingEngine.toggleMasterSignalBroadcasting();
    setMasterAccount({ ...tradingEngine.getMasterAccount() });
  };

  const handleRefreshPing = async () => {
    setIsRefreshing(true);
    await fetchCloudStatus();
    setTimeout(() => {
      setIsRefreshing(false);
    }, 400);
  };

  const handleResetToInitialState = () => {
    tradingEngine.resetAdminToInitialState();
    if (onTradeBroadcasted) {
      onTradeBroadcasted('Admin Master MT5 terminal reset to initial state configuration ($0.00, Disconnected).');
    }
  };

  const handleBroadcastTrade = (e: React.FormEvent) => {
    e.preventDefault();
    if (isDisconnected) {
      setShowTradeModal(false);
      setShowConnectModal(true);
      if (onTradeBroadcasted) {
        onTradeBroadcasted('Please connect the Master MT5 Bridge before broadcasting signals.');
      }
      return;
    }
    const result = tradingEngine.executeMasterTrade(symbol, direction, volume);
    setMasterAccount({ ...tradingEngine.getMasterAccount() });
    setShowTradeModal(false);
    if (onTradeBroadcasted) {
      onTradeBroadcasted(
        `Master order ${direction} ${volume} Lots ${symbol} (#${result.masterTradeId}) broadcasted! Instantaneously replicated to connected client accounts.`
      );
    }
  };

  const handleConnectMaster = (e: React.FormEvent) => {
    e.preventDefault();
    setIsConnecting(true);
    setTimeout(() => {
      const updated = tradingEngine.connectMasterAccount({
        accountNumber,
        brokerServer,
        accountName,
        password,
      });
      setMasterAccount({ ...updated });
      setIsConnecting(false);
      setShowConnectModal(false);
      if (onTradeBroadcasted) {
        onTradeBroadcasted(
          `Main Master MT5 Account #${accountNumber} connected on ${brokerServer}. Broadcasting active.`
        );
      }
    }, 600);
  };

  const isDisconnected = masterAccount.status === 'disconnected' || masterAccount.accountNumber === 'Not Connected';
  const isBroadcasting = !isDisconnected && masterAccount.signalBroadcasting && masterAccount.status === 'broadcasting';

  return (
    <div className="bg-slate-900 border border-purple-800/60 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
      {/* Top Title Banner */}
      <div className="p-5 bg-gradient-to-r from-purple-950/70 via-slate-900 to-slate-900 border-b border-purple-800/40 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shadow-lg shadow-purple-950/50 shrink-0">
            <Radio className={`w-6 h-6 ${isBroadcasting ? 'animate-pulse text-purple-300' : 'text-slate-400'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-mono font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">
                Primary Signal Provider
              </span>
              {isDisconnected ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                  <Power className="w-3 h-3 text-rose-400" />
                  <span>DISCONNECTED (STANDBY)</span>
                </span>
              ) : isBroadcasting ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>BROADCASTING TO CLIENTS</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  <Pause className="w-3 h-3 text-amber-400" />
                  <span>BROADCAST PAUSED</span>
                </span>
              )}
            </div>
            <h3 className="text-lg font-black text-white mt-1">
              Main Master MT5 Account {isDisconnected ? '(Not Connected)' : `(${masterAccount.accountName})`}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {isDisconnected
                ? 'Standby configuration: Initialized with $0.00 balance awaiting MT5 bridge linkage to broadcast signals.'
                : 'The primary institutional bridge account that generates all trading signals for connected client MT5 accounts.'}
            </p>
          </div>
        </div>

        {/* Master Control Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {isDisconnected ? (
            <button
              type="button"
              onClick={() => setShowConnectModal(true)}
              className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-md shadow-purple-950/40"
            >
              <Server className="w-3.5 h-3.5" />
              <span>Connect Master Bridge</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleToggleBroadcast}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-md ${
                  isBroadcasting
                    ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                }`}
              >
                {isBroadcasting ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause Signal Replication</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Resume Broadcasting</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowTradeModal(true)}
                className="px-3.5 py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/40 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <PlusCircle className="w-3.5 h-3.5 text-purple-400" />
                <span>Broadcast Master Signal</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setShowConnectModal(true)}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
          >
            <Server className="w-3.5 h-3.5 text-slate-400" />
            <span>{isDisconnected ? 'Configure Bridge' : 'Switch Master Account'}</span>
          </button>

          <button
            type="button"
            onClick={handleResetToInitialState}
            className="px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition flex items-center gap-1.5 cursor-pointer"
            title="Reset Master Account to Initial State Configuration ($0.00, Disconnected)"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>Reset Initial State</span>
          </button>

          {!isDisconnected && (
            <button
              type="button"
              onClick={handleRefreshPing}
              disabled={isRefreshing}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
              title="Refresh Bridge Ping"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-purple-400' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Real-Time Metrics & Bridge Stats */}
      <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-950/70 border-b border-slate-800/80">
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
            <span>MASTER ACCOUNT #</span>
            <Server className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="font-mono text-base font-black text-white">
            {masterAccount.accountNumber}
          </div>
          <div className="text-[10px] text-slate-400 font-mono truncate">
            {masterAccount.brokerServer}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
            <span>MASTER EQUITY</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="font-mono text-base font-black text-emerald-400">
            ${(masterAccount.equity || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-400 font-mono">
            Balance: ${(masterAccount.balance || 0).toFixed(2)} | Floating P/L: ${(masterAccount.floatingPL || 0).toFixed(2)}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
            <span>CONNECTED COPIERS</span>
            <Users className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="font-mono text-base font-black text-blue-400">
            {masterAccount.activeCopiersCount || 0} Client MT5s
          </div>
          <div className="text-[10px] text-slate-400 font-mono">
            {masterAccount.activeCopiersCount ? 'Synchronized Replication' : 'Awaiting Client Connections'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
            <span>BRIDGE LATENCY</span>
            <Activity className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="font-mono text-base font-black text-amber-400">
            {isDisconnected ? '0' : masterAccount.latencyMs} ms
          </div>
          <div className="text-[10px] text-slate-400 font-mono">
            {isDisconnected
              ? 'Awaiting MT5 Bridge Link'
              : `Zero-Delay EA Webhook (Port ${masterAccount.bridgePort})`}
          </div>
        </div>
      </div>

      {/* Institutional Signal Execution Callout */}
      <div className="p-4 bg-slate-950/40 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5 text-slate-300">
          <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0" />
          <span>
            <strong>Master Trade Broadcast Engine:</strong>{' '}
            {isDisconnected
              ? 'Standby mode: Master terminal is currently in initial disconnected configuration ($0.00 balance). Connect credentials to initiate auto-replication.'
              : 'Any trade placed or closed on this Master Account is mirrored across all active client accounts with zero manual intervention.'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400">
            Signal Publisher EA:{' '}
            <span className={isDisconnected ? 'text-slate-400' : 'text-emerald-400 font-bold'}>
              {isDisconnected ? 'Awaiting MT5 Bridge Connection' : 'CastimoMasterBridge-v4.2'}
            </span>
          </span>
        </div>
      </div>

      {/* MetaApi Cloud Deployment & Live Bridge Verification (Admin Only) */}
      <div className="p-4 bg-gradient-to-r from-purple-950/40 via-slate-900 to-slate-900 border-t border-purple-900/30 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-xs sm:text-sm text-white">MetaApi Cloud Live Terminal Status</h4>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                  metaApiCloud?.mode === 'LIVE_METAAPI'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                }`}>
                  {metaApiCloud?.mode === 'LIVE_METAAPI' ? 'LIVE CLOUD STREAMING' : 'NOT CONNECTED TO METAAPI'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Master ID: <span className="font-mono text-slate-300">eac52c91-a258-4aed-97de-4d7cd83a405a</span> • Server: <span className="font-mono text-slate-300">HFMarketsGlobal-Live20 (#261089492)</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href="https://app.metaapi.cloud"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded-xl border border-purple-800/60 bg-purple-950/40 hover:bg-purple-900/40 text-purple-200 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>MetaApi Console</span>
              <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
            </a>

            <button
              type="button"
              onClick={handleVerifyAndDeploy}
              disabled={isDeployingMaster}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-md shadow-purple-950/40 disabled:opacity-50"
            >
              <Zap className={`w-3.5 h-3.5 text-amber-300 ${isDeployingMaster ? 'animate-bounce' : ''}`} />
              <span>{isDeployingMaster ? 'Verifying Cloud Deployment...' : '⚡ Verify & Deploy Master'}</span>
            </button>
          </div>
        </div>

        {deployFeedback && (
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 animate-in fade-in">
            {deployFeedback}
          </div>
        )}
      </div>

      {/* Modal: Broadcast Master Signal */}
      {showTradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-purple-800/60 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-base text-white">Broadcast Master Signal</h3>
              </div>
              <button
                onClick={() => setShowTradeModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              This will execute a live order on the <strong>Master MT5 Account ({masterAccount.accountNumber})</strong> and replicate it immediately to all {masterAccount.activeCopiersCount} connected client accounts according to their risk rules.
            </p>

            <form onSubmit={handleBroadcastTrade} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Trading Symbol
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {(['XAUUSD'] as const).map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => setSymbol(sym)}
                      className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                        symbol === sym
                          ? 'bg-purple-500/25 text-purple-200 border border-purple-500/50'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {sym} (Gold Spot)
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Order Direction
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDirection('BUY')}
                    className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                      direction === 'BUY'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border border-slate-800'
                    }`}
                  >
                    <span>BUY (Long)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection('SELL')}
                    className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                      direction === 'SELL'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border border-slate-800'
                    }`}
                  >
                    <span>SELL (Short)</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Master Lot Size
                </label>
                <div className="flex items-center gap-2">
                  {[0.25, 0.5, 1.0, 2.0].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVolume(v)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-bold transition cursor-pointer ${
                        volume === v
                          ? 'bg-purple-500 text-slate-950'
                          : 'bg-slate-950 text-slate-400 border border-slate-800'
                      }`}
                    >
                      {v.toFixed(2)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowTradeModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-950/40 transition flex items-center gap-2 cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Execute & Mirror to Clients</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Connect or Switch Master MT5 Account */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-purple-800/60 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-base text-white">Connect Main Master Account</h3>
              </div>
              <button
                onClick={() => setShowConnectModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Enter the credentials for the Master Signal Provider MT5 terminal. All verified client accounts will replicate trades executed on this account.
            </p>

            <form onSubmit={handleConnectMaster} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Master Account Label
                </label>
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="e.g. Castimo Prime Master Alpha"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Broker MT5 Server
                </label>
                <input
                  type="text"
                  value={brokerServer}
                  onChange={(e) => setBrokerServer(e.target.value)}
                  placeholder="e.g. ICMarketsSC-Live01"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Master Login / Account Number
                </label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="e.g. 1099284"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Master Trading Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                  required
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Encrypted via TLS 1.3 to Castimo Bridge daemon.
                </span>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowConnectModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isConnecting}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-950/40 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Server className="w-3.5 h-3.5" />
                  <span>{isConnecting ? 'Verifying Bridge...' : 'Connect Master Bridge'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
