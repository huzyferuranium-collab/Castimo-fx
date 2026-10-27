import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { tradingEngine, CASTIMO_TREASURY_ADDRESS } from '../../services/tradingEngine';
import { authHeaders } from '../../services/apiAuth';
import {
  Mt5Account,
  CopiedTrade,
  ProfitShareInvoice,
} from '../../types';
import { TradeCopierTable } from '../mt5/TradeCopierTable';
import { TradeHistory } from '../mt5/TradeHistory';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { ProfitSharePaymentModal } from '../payments/ProfitSharePaymentModal';
import { TermsModal } from '../legal/TermsModal';
import { hasAcceptedTerms, acceptTerms } from '../../services/agreements';
import { Mt5ConnectionModal } from '../mt5/Mt5ConnectionModal';
import { Mt5DisconnectModal } from '../mt5/Mt5DisconnectModal';
import { SettlementHistoryModal } from '../settlements/SettlementHistoryModal';
import { LedgerAuditModal } from '../ledger/LedgerAuditModal';
import { SidebarNav, NavGroup } from '../common/SidebarNav';
import { AuthModal } from '../auth/AuthModal';

import { RobotConsole } from './RobotConsole';
import { ServicePlanPage } from './ServicePlanPage';
import { getPlanView, PlanView } from '../../services/servicePlanApi';

import {
  Wallet,
  TrendingUp,
  Server,
  Shield,
  ShieldAlert,
  Power,
  Clock,
  Award,
  FileText,
  Share2,
  History,
  Activity,
  ArrowRight,
  Sliders,
  Cpu,
  ArrowUpRight,
  ArrowDownRight,
  Mail,
  Send,
  Zap,
  Radio,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ShieldCheck,
  CreditCard,
  User,
  UserCheck,
  Copy,
  Check,
  ExternalLink,
  QrCode,
  Lock,
} from 'lucide-react';

interface ClientDashboardProps {
  onNavigateToReferrals?: () => void;
}

export const ClientDashboard: React.FC<ClientDashboardProps> = ({ onNavigateToReferrals }) => {
  const { userProfile, isEmailVerified, isAdmin, isClient } = useAuth();
  const isUserAdmin = isAdmin ?? (userProfile?.role === 'admin');
  const isUserClient = isClient ?? (!isUserAdmin || userProfile?.role === 'client');

  const [activeSection, setActiveSection] = useState<string>('overview');

  // Every real client must accept the terms before using the dashboard. null = still checking.
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  useEffect(() => {
    const uid = userProfile?.uid;
    // Administrators do not connect client accounts, so they have nothing to agree to.
    if (!uid || userProfile?.role === 'admin') {
      setTermsAccepted(true);
      return;
    }
    let cancelled = false;
    hasAcceptedTerms(uid).then((ok) => !cancelled && setTermsAccepted(ok));
    return () => {
      cancelled = true;
    };
  }, [userProfile?.uid]);
  const [account, setAccount] = useState<Mt5Account>(tradingEngine.getMt5Account());
  const [trades, setTrades] = useState<CopiedTrade[]>(tradingEngine.getTrades());

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [showEmailVerifyModal, setShowEmailVerifyModal] = useState(false);
  const [countdownText, setCountdownText] = useState<string>('');

  // Client Equity Calibration State
  const [isSavingEquity, setIsSavingEquity] = useState(false);

  // 50% Profit Share Remittance & Transaction Hash State
  const [invoices, setInvoices] = useState<ProfitShareInvoice[]>(tradingEngine.getProfitInvoices());
  const [txHashInput, setTxHashInput] = useState<string>('');
  const [isVerifyingHash, setIsVerifyingHash] = useState<boolean>(false);
  const [hashResult, setHashResult] = useState<{
    success: boolean;
    message: string;
    amountSettled?: number;
    txHash?: string;
    error?: string;
  } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);

  // Which service plan the client chose (kept on the server). undefined = still loading.
  const [planView, setPlanView] = useState<PlanView | null | undefined>(undefined);
  const refreshPlan = () => {
    if (!userProfile?.uid || userProfile.role === 'admin') return;
    getPlanView().then(setPlanView);
  };
  useEffect(refreshPlan, [userProfile?.uid]);
  const planChosen = planView === undefined || planView === null || !planView.available || planView.model !== null;
  const openConnect = () => {
    if (!planChosen) {
      setActiveSection('plan');
      return;
    }
    setShowConnectModal(true);
  };

  // Real-time MetaApi WebSocket Synchronizer & Mirror State
  const [metaApiStatus, setMetaApiStatus] = useState<{
    connected: boolean;
    status: string;
    latencyMs: number;
    masterBalance: number;
    masterEquity: number;
    openPositionsCount: number;
    activeClientsCount: number;
    mirrorActive: boolean;
    loading: boolean;
    error?: string;
    topUpNotice?: { required: boolean; message: string; topUpUrl: string };
    mode?: string;
  }>({
    connected: false,
    status: 'UNKNOWN',
    latencyMs: 0,
    masterBalance: 0,
    masterEquity: 0,
    openPositionsCount: 0,
    activeClientsCount: 0,
    mirrorActive: true,
    loading: false,
  });

  const [isRetryingMaster, setIsRetryingMaster] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  const fetchMetaApiStatus = async () => {
    try {
      const res = await fetch('/api/trade/account-status');
      if (res.ok) {
        const data = await res.json();
        setMetaApiStatus((prev) => ({
          ...prev,
          connected: data.connected === true,
          status: data.status || 'UNKNOWN',
          latencyMs: Number(data.latencyMs) || 0,
          masterBalance: data.master?.balance != null ? Number(data.master.balance) : prev.masterBalance,
          masterEquity: data.master?.equity != null ? Number(data.master.equity) : prev.masterEquity,
          openPositionsCount: data.master?.openPositionsCount ?? 0,
          activeClientsCount: Number(data.activeClientsCount) || 0,
          topUpNotice: data.topUpNotice,
          mode: data.mode,
        }));
        if (data.master) {
          tradingEngine.syncMasterAccountFromCloud(data.master, data.activeClientsCount);
          setAccount(tradingEngine.getMt5Account());
        }
      }
    } catch {
      // In offline / fallback mode, retain default live status
    }
  };

  const handleRetryMasterTerminal = async () => {
    try {
      setIsRetryingMaster(true);
      setRetryMessage(null);
      const res = await fetch('/api/trade/retry-master', { method: 'POST', headers: await authHeaders() });
      const data = await res.json();
      setRetryMessage(data.message || data.error || (data.success ? 'Master connected' : 'Retry completed'));
      await fetchMetaApiStatus();
    } catch {
      setRetryMessage('Network error while requesting master reconnect');
    } finally {
      setIsRetryingMaster(false);
    }
  };

  useEffect(() => {
    fetchMetaApiStatus();
    tradingEngine.syncClientsFromBackend();
    tradingEngine.syncInvoicesFromBackend();
    let tick = 0;
    const interval = setInterval(() => {
      fetchMetaApiStatus();
      tradingEngine.syncClientsFromBackend();
      if (++tick % 6 === 0) tradingEngine.syncInvoicesFromBackend();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleMirror = async () => {
    try {
      setMetaApiStatus((prev) => ({ ...prev, loading: true, error: undefined }));
      const targetState = metaApiStatus.mirrorActive ? 'IDLE' : 'ACTIVE';
      const res = await fetch('/api/trade/toggle-mirror', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ targetState }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMetaApiStatus((prev) => ({
          ...prev,
          mirrorActive: data.status === 'ACTIVE',
          loading: false,
        }));
      } else {
        setMetaApiStatus((prev) => ({
          ...prev,
          loading: false,
          error: data.error || 'Failed to toggle mirror state',
        }));
      }
    } catch (err: any) {
      setMetaApiStatus((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || 'Network error while contacting trade server',
      }));
    }
  };

  useEffect(() => {
    const unsubscribe = tradingEngine.subscribe(() => {
      setAccount({ ...tradingEngine.getMt5Account() });
      setTrades([...tradingEngine.getTrades()]);
      setInvoices([...tradingEngine.getProfitInvoices()]);
    });
    return () => unsubscribe();
  }, []);

  const handleCopyAddress = (addr: string) => {
    try {
      navigator.clipboard?.writeText(addr);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2500);
    } catch {
      // Ignored
    }
  };

  const handleVerifyHash = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanHash = txHashInput.trim();
    if (!cleanHash) {
      setHashResult({
        success: false,
        message: 'Transaction hash required',
        error: 'Please paste your TRC-20 Transaction Hash (TXID) before verifying.',
      });
      return;
    }

    setIsVerifyingHash(true);
    setHashResult(null);

    try {
      const res = await tradingEngine.submitAndVerifyProfitShareHash(account.accountNumber, cleanHash);
      setHashResult(res);
      if (res.success) {
        setTxHashInput('');
        setInvoices([...tradingEngine.getProfitInvoices()]);
        setAccount({ ...tradingEngine.getMt5Account() });
      }
    } catch (err: any) {
      setHashResult({
        success: false,
        message: 'Verification failed',
        error: err?.message || 'Failed to communicate with TRON blockchain validator.',
      });
    } finally {
      setIsVerifyingHash(false);
    }
  };

  // Update countdown to 24h deadline if profit share is pending
  useEffect(() => {
    const updateCountdown = () => {
      if (!account.profitShareDueAt) {
        setCountdownText('');
        return;
      }
      const dueTime = new Date(account.profitShareDueAt).getTime();
      const now = Date.now();
      const diff = dueTime - now;

      if (diff <= 0) {
        setCountdownText('24h Window Expired');
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setCountdownText(`${hours}h ${minutes}m remaining`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [account.profitShareDueAt]);

  const isConnected = account.status === 'copying' || account.status === 'connected';
  const isBlockedUnpaid = account.status === 'blocked_unpaid';
  const isRiskBlocked = account.status === 'blocked' || account.riskStatus === 'blocked';
  const hasPendingShare = (account.unpaidProfitShareUsdt || 0) > 0;
  const openTrades = trades.filter((t) => t.status === 'OPEN');
  const openTradesCount = openTrades.length;
  const floatingPnl = openTrades.reduce((acc, trade) => acc + (trade.pnl || 0), 0);

  // Streamlined collapsible sidebar navigation: clean, responsive, with Profile & 50% Share
  const navGroups: NavGroup[] = [
    {
      groupTitle: 'Trading',
      items: [
        {
          id: 'overview',
          label: 'Dashboard',
          icon: Cpu,
        },
        {
          id: 'plan',
          label: 'Service Plan',
          icon: Wallet,
          badge: planView?.model ? (planView.model === 'subscription' ? 'Monthly' : '50% Share') : planView?.available ? 'Choose' : undefined,
          badgeVariant: planView?.model ? 'success' : 'warning',
        },
        {
          id: 'positions',
          label: 'Active Trades',
          icon: Activity,
          badge: openTradesCount > 0 ? openTradesCount : undefined,
          badgeVariant: 'success',
        },
        {
          id: 'history',
          label: 'Trade History',
          icon: History,
        },
      ],
    },
    {
      groupTitle: 'More',
      items: [
        {
          id: 'settlement_due',
          label: '50% Profit Share',
          icon: Wallet,
          badge: hasPendingShare ? `$${(account.unpaidProfitShareUsdt || 0).toFixed(0)} Due` : 'Settled',
          badgeVariant: hasPendingShare ? 'warning' : 'success',
        },
        {
          id: 'profile',
          label: 'Profile',
          icon: ShieldCheck,
        },
      ],
    },
  ];

  return (
    <div className="flex flex-col lg:flex-row items-start gap-6 max-w-7xl mx-auto pb-12">
      {/* Clean, Minimal Sidebar Navigation */}
      <SidebarNav
        groups={navGroups}
        activeId={activeSection}
        onSelect={setActiveSection}
        title="Castimo Terminal"
        subtitle={isConnected ? `MT5 #${account.accountNumber}` : 'Not Connected'}
        accentColor="emerald"
        statusBadge={{
          text: isConnected ? 'Mirroring Live' : isBlockedUnpaid ? 'Unpaid' : 'Disconnected',
          variant: isConnected ? 'success' : isBlockedUnpaid ? 'danger' : 'warning',
          pulsing: isConnected,
        }}
      />

      {/* Main Content Area */}
      <div className="flex-1 w-full space-y-6 min-w-0">
        {/* Top Header Strip with Notification Center */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-black text-slate-900 dark:text-white truncate">
                {navGroups.flatMap((g) => g.items).find((i) => i.id === activeSection)?.label ||
                  'Castimo FX Terminal'}
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 shrink-0 font-bold">
                {isConnected ? `#${account.accountNumber}` : 'NOT CONNECTED'}
              </span>
            </div>
            {isConnected && (
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 truncate">
                MT5 trade mirroring active
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <NotificationCenter
              onOpenSettlements={() => setShowSettlementModal(true)}
              onOpenReferrals={onNavigateToReferrals}
              onOpenPayment={() => setShowPaymentModal(true)}
            />
          </div>
        </div>

        {/* Email Verification Alert Banner */}
        {!isEmailVerified && userProfile && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
                <Mail className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-xs text-amber-300">
                  Email Verification Required
                </h4>
                <p className="text-[11px] text-amber-200/80 mt-0.5">
                  Confirm your email ({userProfile.email}) with a 6-digit verification code to ensure trade audit delivery.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowEmailVerifyModal(true)}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 font-bold text-xs text-slate-950 transition flex items-center justify-center gap-1.5 shrink-0 cursor-pointer shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Verify Email Now</span>
            </button>
          </div>
        )}

        {/* Critical Watcher Alert Banners */}
        {isBlockedUnpaid && isConnected && (
          <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl animate-in fade-in">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm text-rose-300">
                  Trade Copying Suspended: 50% Profit Share Unpaid (&gt;24h)
                </h4>
                <p className="text-xs text-rose-200/90 mt-0.5">
                  Remit your 50% profit share (${(account.unpaidProfitShareUsdt || 0).toFixed(2)} USDT) to immediately resume automated trade replication.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-bold text-xs text-slate-950 shadow-md transition flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Wallet className="w-4 h-4" />
              <span>Pay ${(account.unpaidProfitShareUsdt || 0).toFixed(2)} USDT</span>
            </button>
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 1: SUMMARISED ESSENTIALS DASHBOARD
            ======================================================== */}
        {activeSection === 'plan' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <ServicePlanPage onChanged={refreshPlan} />
          </div>
        )}

        {activeSection === 'overview' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* 1. HIGH-PRECISION EQUITY & ACCOUNT SUMMARY BAR */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono select-none">
              {/* Left: MT5 Connection Badge & Quick Control (Keep green Connect MT5 button visible to clients) */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 shadow-2xs">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400 dark:bg-slate-600'
                    }`}
                  />
                  <span className="font-extrabold text-slate-900 dark:text-white text-xs">
                    {isConnected ? `MT5 #${account.accountNumber}` : 'MT5 Account: Not Connected'}
                  </span>
                  {isConnected ? (
                    <>
                      <span className="text-slate-600 dark:text-slate-300 text-[11px] font-medium hidden sm:inline">
                        • {account.brokerName || account.brokerServer}
                      </span>
                      {account.isBrokerVerified && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold">
                          ✓ Real Broker Verified
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 text-[9px] font-mono hidden md:inline">
                        1:{account.leverage || 500}
                      </span>
                    </>
                  ) : isUserAdmin ? (
                    <span className="text-slate-600 dark:text-slate-300 text-[11px] font-medium hidden sm:inline">
                      • {account.brokerServer || 'Awaiting MT5 Bridge'}
                    </span>
                  ) : null}
                </div>

                {isConnected ? (
                  <button
                    type="button"
                    onClick={() => setShowDisconnectModal(true)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 text-[10px] font-semibold transition cursor-pointer flex items-center gap-1"
                  >
                    <Power className="w-3 h-3 text-rose-500" />
                    <span>Manage</span>
                  </button>
                ) : (
                  /* KEEP GREEN CONNECT MT5 BUTTON VISIBLE TO CLIENTS */
                  <button
                    type="button"
                    onClick={openConnect}
                    className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition cursor-pointer shadow-md shadow-emerald-500/20 flex items-center gap-1.5"
                  >
                    <Server className="w-3.5 h-3.5" />
                    <span>Connect MT5</span>
                  </button>
                )}
              </div>

              {/* Center / Summary Financial Metrics: HIDE FROM CLIENT IF NO ACCOUNT IS LINKED */}
              {(isConnected || isUserAdmin) && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-6 border-y md:border-y-0 md:border-x border-slate-200 dark:border-slate-800/80 py-2.5 md:py-0 md:px-5">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 dark:text-slate-400 block">Balance</span>
                    <span className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-slate-100">
                      ${account.balance.toFixed(2)}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 dark:text-slate-400 block">Equity</span>
                      {isConnected && (
                        <button
                          type="button"
                          onClick={async () => {
                            setIsSavingEquity(true);
                            try {
                              await tradingEngine.refreshAccountFromBroker();
                            } finally {
                              setIsSavingEquity(false);
                            }
                          }}
                          className="text-[10px] text-blue-500 hover:text-blue-400 font-bold underline cursor-pointer"
                          title="Re-read balance and equity from your broker"
                        >
                          {isSavingEquity ? 'Refreshing...' : 'Refresh from broker'}
                        </button>
                      )}
                    </div>
                    <span className="text-xs sm:text-sm font-black text-slate-950 dark:text-white">
                      ${account.equity.toFixed(2)}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 dark:text-slate-400 block">Free Margin</span>
                    <span className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-slate-200">
                      ${account.freeMargin.toFixed(2)}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 dark:text-slate-400 block">Floating P/L</span>
                    <span
                      className={`text-xs sm:text-sm font-black ${
                        floatingPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {floatingPnl >= 0 ? '+' : ''}${floatingPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Right: 50% Profit Share Due Status & Positions Link - Only when connected or admin */}
              {(isConnected || isUserAdmin) && (
                <div className="flex items-center gap-2 flex-wrap justify-between md:justify-end">
                  {hasPendingShare ? (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/30 text-amber-900 dark:text-amber-300 text-[10px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      <span className="font-bold">
                        ${(account.unpaidProfitShareUsdt || 0).toFixed(0)} USDT Due
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPaymentModal(true)}
                        className="ml-1 px-1.5 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition cursor-pointer"
                      >
                        Pay
                      </button>
                    </div>
                  ) : (
                    <div className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-400 text-[10px] flex items-center gap-1 font-medium">
                      <Award className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                      <span>50% Model Settled</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveSection('positions')}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 text-cyan-700 dark:text-cyan-300 border border-cyan-400/30 text-[10px] font-semibold transition cursor-pointer flex items-center gap-1 shrink-0"
                    title="View active mirrored trades"
                  >
                    <Activity className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                    <span>{openTradesCount} Active</span>
                  </button>
                </div>
              )}
            </div>

            {/* 2. COMPACT AI TRADING ASSISTANT (ESSENTIAL CENTERPIECE OF AI DASHBOARD) */}
            {!planChosen && !isConnected && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs">Choose a service plan (Monthly or 50% Profit Share) before connecting your MT5 account.</p>
                <button
                  type="button"
                  onClick={() => setActiveSection('plan')}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 font-bold text-xs text-slate-950 transition shrink-0 cursor-pointer"
                >
                  Choose plan
                </button>
              </div>
            )}
            <RobotConsole />
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 2: ACTIVE COPIED POSITIONS (FULL TABLE)
            ======================================================== */}
        {activeSection === 'positions' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Live Mirrored Positions</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {openTradesCount} Active
                </span>
              </div>
              <span className="text-[11px] text-slate-500 font-mono">
                Terminal: #{account.accountNumber} • 1:{account.leverage}
              </span>
            </div>

            <TradeCopierTable trades={trades} />
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 3: EXECUTED TRADE HISTORY
            ======================================================== */}
        {activeSection === 'history' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Executed Trade History Log</h3>
              </div>
              <span className="text-[11px] text-slate-500 font-mono">
                Terminal: #{account.accountNumber}
              </span>
            </div>

            <TradeHistory accountNumber={account.accountNumber} limit={15} />
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 4: 50% PROFIT SHARE & TRANSACTION HASH VERIFICATION
            ======================================================== */}
        {activeSection === 'settlement_due' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Header Card */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-400 shrink-0 shadow-inner">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <span>50% Profit Share Remittance & Verification</span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold ${
                        hasPendingShare
                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                          : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      }`}>
                        {hasPendingShare ? 'DUE NOW' : 'ALL SETTLED'}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Zero upfront management fee • 50/50 net profit split • TRON TRC-20 USDT settlement
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    Terminal: #{account.accountNumber}
                  </span>
                </div>
              </div>

              {/* Dues KPI Overview */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 font-mono">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-sans">Current 50% Share Due</span>
                  <span className="text-2xl font-black text-amber-500 dark:text-amber-400 mt-1 block">
                    ${(account.unpaidProfitShareUsdt || 0).toFixed(2)} USDT
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    {hasPendingShare ? 'Remittance required' : 'No overdue remittance'}
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 font-mono">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-sans">24h Settlement Grace</span>
                  <span className="text-base font-bold text-slate-800 dark:text-slate-200 mt-2 block">
                    {hasPendingShare ? countdownText : 'Grace Window Inactive'}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Auto-disconnect after 24h
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 font-mono">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-sans">Settlement Protocol</span>
                  <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-2 block">
                    TRON (TRC20 USDT)
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Fast on-chain confirmation
                  </span>
                </div>
              </div>

              {/* TRC20 Receiving Address Box */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    <span>Castimo Treasury TRC-20 Receiving Address</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">TRON Network Only</span>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="flex-1 px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 select-all truncate">
                    {CASTIMO_TREASURY_ADDRESS || 'Payment address not set yet'}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyAddress(CASTIMO_TREASURY_ADDRESS)}
                    className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0 shadow-sm"
                  >
                    {copyFeedback ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copyFeedback ? 'Copied!' : 'Copy Address'}</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-400">
                  ⚠️ Send only TRC20 USDT on the TRON network to this address. After broadcasting, copy the transaction hash (TXID) from your wallet and paste it below.
                </p>
              </div>

              {/* Live Transaction Hash Input & Verification Form */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-indigo-950/40 border border-emerald-500/30 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-sm font-bold text-white">Paste Transaction Hash (TXID) to Verify Live</h4>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                    Live On-Chain Validator
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Once you have remitted your 50% profit share in USDT, paste the 64-character transaction hash (TXID) generated by your TRON wallet. The system will verify the transaction on the network, mark your invoice as settled, and ensure uninterrupted MT5 trade copying.
                </p>

                <form onSubmit={handleVerifyHash} className="space-y-3">
                  <div>
                    <div className="relative">
                      <CreditCard className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                      <input
                        type="text"
                        value={txHashInput}
                        onChange={(e) => setTxHashInput(e.target.value)}
                        placeholder="Paste 64-character TRC20 TXID (e.g. 8f4a12bc90...)"
                        className="w-full pl-9 pr-3 py-2.5 text-xs bg-slate-950 border border-slate-700/80 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500 font-mono tracking-tight"
                      />
                    </div>
                  </div>

                  {/* Verification Feedback Banner */}
                  {hashResult && (
                    <div
                      className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 animate-in fade-in ${
                        hashResult.success
                          ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-200'
                          : 'bg-rose-500/15 border border-rose-500/40 text-rose-200'
                      }`}
                    >
                      {hashResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1">
                        <div className="font-bold">{hashResult.message}</div>
                        {hashResult.error && (
                          <div className="text-[11px] text-rose-300">{hashResult.error}</div>
                        )}
                        {hashResult.txHash && (
                          <div className="text-[10px] font-mono text-emerald-300 break-all pt-1">
                            TXID: {hashResult.txHash}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <button
                      type="submit"
                      disabled={isVerifyingHash}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50"
                    >
                      {isVerifyingHash ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Verifying on TRON Network...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          <span>Verify & Confirm Payment Live</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowPaymentModal(true)}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5 text-amber-400" />
                      <span>Show QR Code & Wallet Modal</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Settlement History Log Table */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    Past Profit Share Remittance & Verified Hashes
                  </h4>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {invoices.length} Records
                  </span>
                </div>

                {invoices.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 text-xs rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    No 50% profit share remittance records yet. As your MT5 terminal mirrors institutional profits, invoices will appear here.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 text-[10px] uppercase border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3">Invoice</th>
                          <th className="py-2.5 px-3">Gross Gain</th>
                          <th className="py-2.5 px-3">50% Share</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">Transaction Hash (TXID)</th>
                          <th className="py-2.5 px-3">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                        {invoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                            <td className="py-2.5 px-3 text-white font-bold">#{inv.id}</td>
                            <td className="py-2.5 px-3 text-emerald-400 font-bold">+${inv.grossProfit.toFixed(2)}</td>
                            <td className="py-2.5 px-3 text-amber-400 font-bold">${inv.amountDueUsdt.toFixed(2)} USDT</td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                  inv.status === 'paid'
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                }`}
                              >
                                {inv.status === 'paid' ? 'Verified Paid' : 'Pending'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 max-w-[180px] truncate">
                              {inv.txHash ? (
                                <span className="text-emerald-400 text-[11px]" title={inv.txHash}>
                                  {inv.txHash.slice(0, 10)}...{inv.txHash.slice(-8)}
                                </span>
                              ) : (
                                <span className="text-slate-500 italic">Awaiting submission</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                              {new Date(inv.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 5: CLIENT PROFILE & NATIONAL ID VERIFICATION
            ======================================================== */}
        {activeSection === 'profile' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Profile Overview Card */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800/80 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500 dark:text-emerald-400 font-black text-lg shadow-inner">
                    {userProfile?.displayName ? userProfile.displayName.charAt(0).toUpperCase() : 'C'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-black text-slate-900 dark:text-white">
                        {userProfile?.displayName || 'Client Trader'}
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold">
                        CLIENT TRADER
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {userProfile?.email} • Account Custody Active
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-mono">
                    Member since {userProfile?.createdAt ? new Date(userProfile.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' }) : ''}
                  </span>
                </div>
              </div>

              {/* Linked MT5 Terminal Custody Details */}
              <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">Linked MT5 Trading Terminal</h4>
                  </div>
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                      isConnected
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {account.status.toUpperCase()}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase block font-sans">MT5 Login</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 block">
                      #{account.accountNumber}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase block font-sans">Broker Server</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 block truncate">
                      {account.brokerServer}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase block font-sans">Terminal Leverage</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 block">
                      1:{account.leverage}
                    </span>
                  </div>

                </div>

                <div className="flex items-center gap-2 pt-1">
                  {isConnected && (
                    <button
                      type="button"
                      onClick={() => setShowDisconnectModal(true)}
                      className="px-3.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/30 text-xs font-medium transition cursor-pointer"
                    >
                      Disconnect MT5
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <TermsModal
        isOpen={termsAccepted === false}
        onAccept={async () => {
          const r = await acceptTerms(userProfile?.uid || '');
          if (r.success) setTermsAccepted(true);
          return r;
        }}
      />

      {/* Modals & Dialogs (Preserved Exactly) */}
      <ProfitSharePaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        userId={userProfile?.uid || ''}
      />

      <Mt5ConnectionModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        userId={userProfile?.uid || ''}
      />

      <Mt5DisconnectModal
        isOpen={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
        userId={userProfile?.uid || ''}
      />

      <SettlementHistoryModal
        isOpen={showSettlementModal}
        onClose={() => setShowSettlementModal(false)}
        settlements={tradingEngine.getSettlements()}
        currentHwm={account.equity || 0.0}
      />

      <LedgerAuditModal
        isOpen={showLedgerModal}
        onClose={() => setShowLedgerModal(false)}
        ledger={tradingEngine.getLedger()}
        auditLogs={tradingEngine.getAuditLogs()}
      />

      <AuthModal
        isOpen={showEmailVerifyModal}
        onClose={() => setShowEmailVerifyModal(false)}
        defaultTab="verify"
        prefillEmail={userProfile?.email}
      />

    </div>
  );
};
