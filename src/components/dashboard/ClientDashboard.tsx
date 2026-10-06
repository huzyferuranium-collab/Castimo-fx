import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { tradingEngine } from '../../services/tradingEngine';
import {
  Mt5Account,
  CopiedTrade,
} from '../../types';
import { TradeCopierTable } from '../mt5/TradeCopierTable';
import { TradeHistory } from '../mt5/TradeHistory';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { ProfitSharePaymentModal } from '../payments/ProfitSharePaymentModal';
import { Mt5ConnectionModal } from '../mt5/Mt5ConnectionModal';
import { Mt5DisconnectModal } from '../mt5/Mt5DisconnectModal';
import { SettlementHistoryModal } from '../settlements/SettlementHistoryModal';
import { LedgerAuditModal } from '../ledger/LedgerAuditModal';
import { SidebarNav, NavGroup } from '../common/SidebarNav';

// Sleek, lightweight, non-intrusive AI Trading Assistant widget
import { AITradingAssistant } from './AITradingAssistant';

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
} from 'lucide-react';

interface ClientDashboardProps {
  onNavigateToReferrals?: () => void;
}

export const ClientDashboard: React.FC<ClientDashboardProps> = ({ onNavigateToReferrals }) => {
  const { userProfile } = useAuth();
  const [activeSection, setActiveSection] = useState<string>('overview');
  const [account, setAccount] = useState<Mt5Account>(tradingEngine.getMt5Account());
  const [trades, setTrades] = useState<CopiedTrade[]>(tradingEngine.getTrades());

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [countdownText, setCountdownText] = useState<string>('');

  useEffect(() => {
    const unsubscribe = tradingEngine.subscribe(() => {
      setAccount({ ...tradingEngine.getMt5Account() });
      setTrades([...tradingEngine.getTrades()]);
    });
    return () => unsubscribe();
  }, []);

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

  const handleExecuteAiSignal = (symbol: string, direction: 'BUY' | 'SELL') => {
    const cleanSym = (symbol.replace('/', '').includes('XAU') ? 'XAUUSD' : 'XAUUSD') as 'XAUUSD';
    tradingEngine.executeMasterTrade(cleanSym, direction, 0.20);
  };

  // Streamlined sidebar navigation: only the essentials
  const navGroups: NavGroup[] = [
    {
      groupTitle: 'Trading',
      items: [
        {
          id: 'overview',
          label: 'AI Dashboard',
          icon: Cpu,
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
      groupTitle: 'Settlements',
      items: [
        {
          id: 'settlement_due',
          label: '50% Profit Share',
          icon: Wallet,
          badge: hasPendingShare ? `$${(account.unpaidProfitShareUsdt || 0).toFixed(0)}` : undefined,
          badgeVariant: 'warning',
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
        subtitle={`MT5 #${account.accountNumber || '8829104'}`}
        accentColor="emerald"
        statusBadge={{
          text: isConnected ? 'Mirroring Live' : isBlockedUnpaid ? 'Unpaid' : 'Standby',
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
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shrink-0 font-bold">
                #{account.accountNumber || '8829104'}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 truncate">
              Continuous Market Scanning • Master MT5 #{account.copiedFromMasterAccount || '1099284'} • 50% Profit Share Model
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <NotificationCenter
              onOpenSettlements={() => setShowSettlementModal(true)}
              onOpenReferrals={onNavigateToReferrals}
              onOpenPayment={() => setShowPaymentModal(true)}
            />
          </div>
        </div>

        {/* Critical Watcher Alert Banners */}
        {isBlockedUnpaid && (
          <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl animate-in fade-in">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm text-rose-300">
                  Trade Copying Suspended: 50% Profit Share Unpaid (&gt;24h)
                </h4>
                <p className="text-xs text-rose-200/90 mt-0.5">
                  Remit your 50% profit share (${(account.unpaidProfitShareUsdt || 150).toFixed(2)} USDT) to immediately resume automated trade replication.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-bold text-xs text-slate-950 shadow-md transition flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Wallet className="w-4 h-4" />
              <span>Pay ${(account.unpaidProfitShareUsdt || 150).toFixed(2)} USDT</span>
            </button>
          </div>
        )}

        {isRiskBlocked && !isBlockedUnpaid && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 flex items-start gap-3 shadow-lg animate-in fade-in">
            <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-bold text-sm text-rose-300">
                Trade Copying Paused: Capital Below $200.00 Floor
              </h4>
              <p className="text-xs text-rose-200/90 mt-0.5">
                {account.blockedReason ||
                  'Account equity is below the mandatory $200.00 safety threshold. New trade signals are suspended to prevent account blowout.'}
              </p>
            </div>
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 1: SUMMARISED ESSENTIALS DASHBOARD
            ======================================================== */}
        {activeSection === 'overview' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* 1. HIGH-PRECISION EQUITY & ACCOUNT SUMMARY BAR */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono select-none">
              {/* Left: MT5 Connection Badge & Quick Control */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 shadow-2xs">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                    }`}
                  />
                  <span className="font-extrabold text-slate-900 dark:text-white text-xs">
                    MT5 #{account.accountNumber || '8829104'}
                  </span>
                  <span className="text-slate-600 dark:text-slate-300 text-[11px] font-medium hidden sm:inline">
                    • {account.brokerServer || 'ICMarketsSC-Live01'}
                  </span>
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
                  <button
                    type="button"
                    onClick={() => setShowConnectModal(true)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[10px] transition cursor-pointer shadow-xs flex items-center gap-1"
                  >
                    <Server className="w-3 h-3" />
                    <span>Connect MT5</span>
                  </button>
                )}
              </div>

              {/* Center / Summary Financial Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-6 border-y md:border-y-0 md:border-x border-slate-200 dark:border-slate-800/80 py-2.5 md:py-0 md:px-5">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 dark:text-slate-400 block">Balance</span>
                  <span className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-slate-100">
                    ${account.balance.toFixed(2)}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 dark:text-slate-400 block">Equity</span>
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

              {/* Right: 50% Profit Share Due Status & Positions Link */}
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
            </div>

            {/* 2. COMPACT AI TRADING ASSISTANT (ESSENTIAL CENTERPIECE) */}
            <AITradingAssistant onMirrorSignal={handleExecuteAiSignal} />
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
            SUB-SECTION 4: 50% PROFIT SHARE REMITTANCE
            ======================================================== */}
        {activeSection === 'settlement_due' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">50% Pure Profit Share Architecture</h4>
                  <p className="text-xs text-slate-400">
                    Zero management fees • Zero upfront license cost • 24h settlement window
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                You retain 50% of all net trading gains. When a profitable position closes on your MT5 terminal,
                the system calculates the 50% split. You have a full 24-hour settlement window to remit the USDT share.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono">
                  <span className="text-[10px] text-slate-500 uppercase block">Current Share Due</span>
                  <span className="text-xl font-black text-amber-400 mt-1 block">
                    ${(account.unpaidProfitShareUsdt || 0).toFixed(2)} USDT
                  </span>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono">
                  <span className="text-[10px] text-slate-500 uppercase block">Settlement Window</span>
                  <span className="text-sm font-bold text-slate-300 mt-1 block">
                    {hasPendingShare ? countdownText : 'No overdue invoices'}
                  </span>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono">
                  <span className="text-[10px] text-slate-500 uppercase block">Remittance Network</span>
                  <span className="text-sm font-bold text-emerald-400 mt-1 block">
                    TRON (TRC20 USDT)
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowPaymentModal(true)}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-md"
              >
                <Wallet className="w-4 h-4" />
                <span>Open USDT Remittance Portal</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 5: SETTLEMENT RECORDS & HIGH-WATER MARK
            ======================================================== */}
        {activeSection === 'settlement_records' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Daily Profit-Share & High-Water Mark Records</h4>
                  <p className="text-xs text-slate-400">Performance settlement audited receipts</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Fees are calculated solely when your account generates gains above the previous High-Water Mark ($2,450.00 USD).
                Any drawdown must be completely recovered before any future 50% profit share applies.
              </p>

              <button
                type="button"
                onClick={() => setShowSettlementModal(true)}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Award className="w-4 h-4 text-amber-400" />
                <span>View Full Settlement Records & HWM History</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 6: MT5 BRIDGE & SERVER SETTINGS
            ======================================================== */}
        {activeSection === 'bridge_settings' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                    <Server className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">MT5 Bridge Synchronization Settings</h4>
                    <p className="text-xs text-slate-400">Direct low-latency broker communication</p>
                  </div>
                </div>

                <span
                  className={`text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full ${
                    isConnected
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {account.status}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-500 block">BROKER TERMINAL LOGIN</span>
                  <span className="text-sm font-bold text-white">#{account.accountNumber}</span>
                  <span className="text-[11px] text-slate-400 block">{account.brokerServer}</span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-500 block">MASTER SIGNAL SOURCE</span>
                  <span className="text-sm font-bold text-purple-300">
                    #{account.copiedFromMasterAccount || '1099284'}
                  </span>
                  <span className="text-[11px] text-slate-400 block">
                    {account.masterAccountName || 'Castimo Prime Master (Alpha Bridge)'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConnectModal(true)}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition cursor-pointer"
                >
                  Reconfigure MT5 Bridge
                </button>
                {isConnected && (
                  <button
                    type="button"
                    onClick={() => setShowDisconnectModal(true)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-300 border border-slate-700 font-semibold text-xs transition cursor-pointer"
                  >
                    Disconnect Bridge
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 7: RISK PROTECTION FLOOR ($200)
            ======================================================== */}
        {activeSection === 'risk_protection' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Mandatory Capital Protection ($200.00 Floor)</h4>
                  <p className="text-xs text-slate-400">Non-negotiable terminal safety architecture</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                To prevent account wipeout, Castimofx enforces a hard capital safety stop at $200.00 USD. If market drawdown
                causes account equity to drop below $200.00, trade copying is immediately suspended.
              </p>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs font-mono">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block">Current Safe Distance</span>
                  <span className="text-lg font-bold text-emerald-400">
                    +${Math.max(0, account.equity - 200).toFixed(2)} USD above floor
                  </span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Risk Status: Normal
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            SUB-SECTION 8: FINANCIAL LEDGER & AUDIT TRAIL
            ======================================================== */}
        {activeSection === 'ledger_audit' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Cryptographic Audit Trail & Financial Ledger</h4>
                  <p className="text-xs text-slate-400">Immutable double-entry book balancing</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Every trade closure, 50% performance fee calculation, TRC20 hash, and watcher action is committed
                to a SHA-256 chained transaction log.
              </p>

              <button
                type="button"
                onClick={() => setShowLedgerModal(true)}
                className="py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer shadow-md shadow-purple-600/20"
              >
                <FileText className="w-4 h-4" />
                <span>Open Immutable Ledger & Reconciliation Modal</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals & Dialogs (Preserved Exactly) */}
      <ProfitSharePaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        userId={userProfile?.uid || 'demo-client-castimo-001'}
      />

      <Mt5ConnectionModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        userId={userProfile?.uid || 'demo-client-castimo-001'}
      />

      <Mt5DisconnectModal
        isOpen={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
        userId={userProfile?.uid || 'demo-client-castimo-001'}
      />

      <SettlementHistoryModal
        isOpen={showSettlementModal}
        onClose={() => setShowSettlementModal(false)}
        settlements={tradingEngine.getSettlements()}
        currentHwm={2450.0}
      />

      <LedgerAuditModal
        isOpen={showLedgerModal}
        onClose={() => setShowLedgerModal(false)}
        ledger={tradingEngine.getLedger()}
        auditLogs={tradingEngine.getAuditLogs()}
      />
    </div>
  );
};
