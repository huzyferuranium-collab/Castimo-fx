import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { tradingEngine } from '../../services/tradingEngine';
import { Mt5Account, RiskSettings, ProfitShareInvoice } from '../../types';
import { RiskSettingsModal } from '../risk/RiskSettingsModal';
import { LedgerAuditModal } from '../ledger/LedgerAuditModal';
import { SettlementHistoryModal } from '../settlements/SettlementHistoryModal';
import { MasterAccountPanel } from '../admin/MasterAccountPanel';
import { SidebarNav, NavGroup } from '../common/SidebarNav';
import {
  ShieldAlert,
  CheckCircle2,
  Sliders,
  Award,
  FileText,
  Users,
  Server,
  DollarSign,
  Clock,
  Play,
  Zap,
  RefreshCw,
  AlertTriangle,
  Wallet,
  Activity,
  Check,
  Radio,
  Layers,
  ShieldCheck,
  LayoutDashboard,
  TrendingUp,
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const { userProfile } = useAuth();
  const [activeSection, setActiveSection] = useState<string>('overview');
  const [supervisedAccounts, setSupervisedAccounts] = useState<Mt5Account[]>(
    tradingEngine.getSupervisedAccounts()
  );
  const [invoices, setInvoices] = useState<ProfitShareInvoice[]>(
    tradingEngine.getProfitInvoices()
  );
  const [riskSettings, setRiskSettings] = useState<RiskSettings>(
    tradingEngine.getRiskSettings()
  );

  const [showRiskModal, setShowRiskModal] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    const unsub = tradingEngine.subscribe(() => {
      setSupervisedAccounts([...tradingEngine.getSupervisedAccounts()]);
      setInvoices([...tradingEngine.getProfitInvoices()]);
      setRiskSettings({ ...tradingEngine.getRiskSettings() });
    });
    return () => unsub();
  }, []);

  const handleTriggerWatcherSweep = () => {
    const res = tradingEngine.trigger24hWatcherSweep();
    setActionSuccess(res.message);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  const handleSimulateNewProfit = () => {
    const inv = tradingEngine.simulateNewProfits(200.0);
    setActionSuccess(
      `Simulated MT5 +$200 trade profit. 50% Share Invoice #${inv.id} created ($${inv.amountDueUsdt.toFixed(2)} USDT due).`
    );
    setTimeout(() => setActionSuccess(null), 5000);
  };

  const handleSimulate24hTimeout = () => {
    tradingEngine.simulateFastForward24h();
    setActionSuccess('Fast-forwarded 24 hours: Overdue invoices processed and accounts auto-disconnected.');
    setTimeout(() => setActionSuccess(null), 5000);
  };

  const handleExecuteDailySettlement = () => {
    tradingEngine.executeDailySettlement(userProfile?.displayName || 'Administrator');
    setActionSuccess('Daily 50% performance fee settlement sweep executed.');
    setTimeout(() => setActionSuccess(null), 4000);
  };

  const handleMarkPaid = async (invoiceId: string) => {
    await tradingEngine.payProfitShareInvoice(invoiceId);
    setActionSuccess(`Invoice #${invoiceId} marked as received via TRC20 USDT. Account connection restored.`);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  const handleReconnect = (accNum: string) => {
    tradingEngine.reconnectAccount(accNum);
    setActionSuccess(`Account #${accNum} trade copying reconnected.`);
    setTimeout(() => setActionSuccess(null), 3000);
  };

  const totalSupervisedEquity = supervisedAccounts.reduce((sum, a) => sum + a.equity, 0);
  const accountsDisconnected = supervisedAccounts.filter((a) => a.status === 'blocked_unpaid').length;
  const pendingShareTotal = supervisedAccounts.reduce(
    (sum, a) => sum + (a.unpaidProfitShareUsdt || 0),
    0
  );
  const pendingInvoicesCount = invoices.filter((i) => i.status === 'pending').length;

  // Sidebar navigation groups for Admin Dashboard
  const adminNavGroups: NavGroup[] = [
    {
      groupTitle: 'Fleet Supervision',
      items: [
        {
          id: 'overview',
          label: 'Accounts & Bridges',
          icon: LayoutDashboard,
          badge: supervisedAccounts.length,
          description: 'Monitored bridges & equity',
        },
        {
          id: 'master_provider',
          label: 'Master MT5 Signal Provider',
          icon: Radio,
          description: 'Broadcast & signal injector',
        },
      ],
    },
    {
      groupTitle: 'Autonomous Watcher',
      items: [
        {
          id: 'watcher_daemon',
          label: '24h Watcher Control',
          icon: Clock,
          badge: accountsDisconnected > 0 ? `${accountsDisconnected} Blocked` : undefined,
          badgeVariant: accountsDisconnected > 0 ? 'danger' : 'default',
          description: 'Auto-disconnect engine & tests',
        },
        {
          id: 'invoices_pending',
          label: '50% Profit Share Invoices',
          icon: Wallet,
          badge: pendingInvoicesCount > 0 ? pendingInvoicesCount : undefined,
          badgeVariant: 'warning',
          description: 'TRC20 remittance verification',
        },
      ],
    },
    {
      groupTitle: 'Governance & Risk',
      items: [
        {
          id: 'risk_guard',
          label: 'Risk Safety Guard ($200)',
          icon: Sliders,
          description: 'Capital floor parameters',
        },
        {
          id: 'daily_settlement',
          label: 'UTC Daily Settlement',
          icon: Award,
          description: 'Automated 50% performance fee run',
        },
        {
          id: 'financial_ledger',
          label: 'System Ledger & Audit Trail',
          icon: FileText,
          description: 'Immutable hash chain & logs',
        },
      ],
    },
  ];

  return (
    <div className="flex flex-col lg:flex-row items-start gap-6 max-w-7xl mx-auto pb-12">
      {/* Collapsible Sidebar Navigation */}
      <SidebarNav
        groups={adminNavGroups}
        activeId={activeSection}
        onSelect={setActiveSection}
        title="Admin Oversight"
        subtitle="Institutional MT5 Copier Console"
        accentColor="purple"
        statusBadge={{
          text: 'Supervision Active',
          variant: 'purple',
          pulsing: true,
        }}
      />

      {/* Main Content Area */}
      <div className="flex-1 w-full space-y-5 min-w-0">
        {/* Top Executive Header Card */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-purple-800/40 shadow-lg flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-mono font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">
                Administrator Oversight Console
              </span>
              <span className="text-xs text-slate-400">Pure 50% Profit Share & Automated Watcher</span>
            </div>
            <h2 className="text-xl font-black text-white mt-1">
              {adminNavGroups.flatMap((g) => g.items).find((i) => i.id === activeSection)?.label ||
                'Institutional Platform Supervision'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Admin oversees trade copying, 24h automated settlement enforcement, and risk compliance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExecuteDailySettlement}
              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <Award className="w-3.5 h-3.5 text-amber-400" />
              <span>Execute 50% Settlement</span>
            </button>
            <button
              onClick={() => setShowRiskModal(true)}
              className="px-3 py-1.5 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Risk Guard ($200)</span>
            </button>
            <button
              onClick={() => setShowLedgerModal(true)}
              className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition flex items-center gap-1.5 shadow-md shadow-purple-600/20 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Ledger & Audit</span>
            </button>
          </div>
        </div>

        {actionSuccess && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* ========================================================
            ADMIN SECTION 1: ACCOUNTS & TERMINALS
            ======================================================== */}
        {activeSection === 'overview' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            {/* KPI Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span>Supervised MT5 Terminals</span>
                  <Users className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-black font-mono text-white mt-2">
                  {supervisedAccounts.length}
                </div>
                <div className="text-[11px] text-emerald-400 mt-1">
                  {supervisedAccounts.filter((a) => a.status === 'copying').length} Actively Copying
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span>Total MT5 Supervised Equity</span>
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-black font-mono text-white mt-2">
                  ${totalSupervisedEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Across 4 Broker Bridges</div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span>50% Share Pending (24h Window)</span>
                  <Clock className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-black font-mono text-amber-400 mt-2">
                  ${pendingShareTotal.toFixed(2)} <span className="text-xs text-slate-400">USDT</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {supervisedAccounts.filter((a) => (a.unpaidProfitShareUsdt || 0) > 0).length} Terminal(s) in Grace Period
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span>Auto-Disconnected (Unpaid &gt;24h)</span>
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                </div>
                <div className="text-2xl font-black font-mono text-rose-400 mt-2">
                  {accountsDisconnected}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Copying Terminated by Watcher</div>
              </div>
            </div>

            {/* Supervised MT5 Accounts Master Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-400" />
                  <span>Supervised MT5 Bridges & 50% Profit Share</span>
                </h3>
                <span className="text-xs text-slate-400">
                  Automated Disconnect on 24h Expiry
                </span>
              </div>

              {/* Mobile View: Terminal Cards */}
              <div className="block md:hidden divide-y divide-slate-800/60">
                {supervisedAccounts.map((acc) => {
                  const isOverdue = acc.status === 'blocked_unpaid';
                  const hasDue = (acc.unpaidProfitShareUsdt || 0) > 0;
                  const activeInv = invoices.find(
                    (i) => i.accountNumber === acc.accountNumber && i.status === 'pending'
                  );

                  return (
                    <div key={acc.id} className="p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-white text-sm">#{acc.accountNumber}</span>
                            <span
                              className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                acc.status === 'copying'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              }`}
                            >
                              {acc.status}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400">{acc.brokerServer}</span>
                        </div>

                        <div className="text-right">
                          <span className="text-[10px] text-slate-500 block">Equity:</span>
                          <span className="font-mono font-bold text-white text-sm">${acc.equity.toFixed(2)}</span>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-500 block">Last Profit:</span>
                          <span className="font-mono font-bold text-emerald-400">
                            +${(acc.lastProfitGenerated || 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500 block">50% Share Due:</span>
                          <span className="font-mono font-bold text-amber-400">
                            ${(acc.unpaidProfitShareUsdt || 0).toFixed(2)} USDT
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div>
                          {isOverdue ? (
                            <span className="text-[10px] uppercase font-bold text-rose-300 bg-rose-500/15 px-2 py-0.5 rounded border border-rose-500/30">
                              Disconnected (&gt;24h)
                            </span>
                          ) : hasDue ? (
                            <span className="text-[10px] uppercase font-bold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-amber-400" />
                              <span>24h Grace Window</span>
                            </span>
                          ) : (
                            <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                              Up to Date (Paid)
                            </span>
                          )}
                        </div>

                        <div>
                          {hasDue && activeInv && (
                            <button
                              onClick={() => handleMarkPaid(activeInv.id)}
                              className="px-3 py-1 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition cursor-pointer"
                            >
                              Mark 50% Paid
                            </button>
                          )}
                          {isOverdue && (
                            <button
                              onClick={() => handleReconnect(acc.accountNumber)}
                              className="px-3 py-1 text-xs font-bold rounded-lg bg-blue-500 hover:bg-blue-400 text-white transition cursor-pointer"
                            >
                              Reconnect
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop View: Full Table */}
              <div className="hidden md:block border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 border-b border-slate-800 text-[10px] uppercase font-semibold text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3">Account #</th>
                      <th className="py-2.5 px-3">Broker Bridge</th>
                      <th className="py-2.5 px-3">Live Equity</th>
                      <th className="py-2.5 px-3">Last Profit</th>
                      <th className="py-2.5 px-3">50% Share Due</th>
                      <th className="py-2.5 px-3">24h Settlement Status</th>
                      <th className="py-2.5 px-3">Bridge Status</th>
                      <th className="py-2.5 px-3 text-right">Watcher Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {supervisedAccounts.map((acc) => {
                      const isOverdue = acc.status === 'blocked_unpaid';
                      const hasDue = (acc.unpaidProfitShareUsdt || 0) > 0;
                      const activeInv = invoices.find(
                        (i) => i.accountNumber === acc.accountNumber && i.status === 'pending'
                      );

                      return (
                        <tr key={acc.id} className="hover:bg-slate-800/30 transition">
                          <td className="py-3 px-3 font-bold text-white">#{acc.accountNumber}</td>
                          <td className="py-3 px-3 text-slate-400">{acc.brokerServer}</td>
                          <td className="py-3 px-3 text-slate-100 font-bold">${acc.equity.toFixed(2)}</td>
                          <td className="py-3 px-3 text-emerald-400 font-bold">
                            +${(acc.lastProfitGenerated || 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-3">
                            {hasDue ? (
                              <span className="text-amber-400 font-bold font-mono">
                                ${acc.unpaidProfitShareUsdt?.toFixed(2)} USDT
                              </span>
                            ) : (
                              <span className="text-slate-500">$0.00</span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            {isOverdue ? (
                              <span className="text-[10px] uppercase font-bold text-rose-300 bg-rose-500/15 px-2 py-0.5 rounded border border-rose-500/30">
                                Auto-Disconnected (&gt;24h)
                              </span>
                            ) : hasDue ? (
                              <span className="text-[10px] uppercase font-bold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30 flex items-center gap-1 w-fit">
                                <Clock className="w-3 h-3 text-amber-400" />
                                <span>Within 24h Window</span>
                              </span>
                            ) : (
                              <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                Up to Date (Paid)
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                acc.status === 'copying'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              }`}
                            >
                              {acc.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5 font-sans">
                              {hasDue && activeInv && (
                                <button
                                  onClick={() => handleMarkPaid(activeInv.id)}
                                  className="px-2 py-1 text-[11px] font-bold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition cursor-pointer"
                                  title="Record USDT received on TRC20"
                                >
                                  Mark 50% Paid
                                </button>
                              )}
                              {isOverdue && (
                                <button
                                  onClick={() => handleReconnect(acc.accountNumber)}
                                  className="px-2 py-1 text-[11px] font-bold rounded-lg bg-blue-500 hover:bg-blue-400 text-white transition cursor-pointer"
                                >
                                  Reconnect
                                </button>
                              )}
                              {!hasDue && !isOverdue && (
                                <span className="text-[11px] text-slate-500">Auto-Monitored</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            ADMIN SECTION 2: MASTER MT5 SIGNAL PROVIDER
            ======================================================== */}
        {activeSection === 'master_provider' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <MasterAccountPanel
              onTradeBroadcasted={(msg) => {
                setActionSuccess(msg);
                setTimeout(() => setActionSuccess(null), 4500);
              }}
            />
          </div>
        )}

        {/* ========================================================
            ADMIN SECTION 3: 24H WATCHER CONTROL & SIMULATION
            ======================================================== */}
        {activeSection === 'watcher_daemon' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping absolute" />
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>Autonomous 24-Hour Settlement Watcher</span>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        DAEMON ACTIVE & WATCHING
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Automatically reads MT5 profits, calculates 50% share, and terminates copying if unpaid after 24 hours.
                    </p>
                  </div>
                </div>

                {/* Test & Simulation Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleTriggerWatcherSweep}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
                    title="Runs the background sweep algorithm"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                    <span>Trigger Watcher Sweep</span>
                  </button>
                  <button
                    onClick={handleSimulateNewProfit}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition flex items-center gap-1.5 cursor-pointer"
                    title="Simulates an MT5 profitable trade closure (+ $200)"
                  >
                    <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Simulate Profit (+ $200)</span>
                  </button>
                  <button
                    onClick={handleSimulate24hTimeout}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition flex items-center gap-1.5 cursor-pointer"
                    title="Simulates 24h expiration to test auto-disconnect"
                  >
                    <Clock className="w-3.5 h-3.5 text-rose-400" />
                    <span>Simulate 24h Timeout</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            ADMIN SECTION 4: 50% PROFIT SHARE INVOICES
            ======================================================== */}
        {activeSection === 'invoices_pending' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>All 50% Profit Share Invoices ({invoices.length})</span>
                </h4>
                <span className="text-xs text-slate-400">TRON TRC20 USDT Settlement</span>
              </div>

              {/* Mobile View: Invoice Cards */}
              <div className="block md:hidden divide-y divide-slate-800/60">
                {invoices.map((inv) => (
                  <div key={inv.id} className="p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-white text-sm">Account #{inv.accountNumber}</span>
                          <span
                            className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                              inv.status === 'paid'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : inv.status === 'overdue_blocked'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">Invoice #{inv.id.slice(0, 10)}</span>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">50% Share Due:</span>
                        <span className="font-mono font-bold text-amber-400 text-sm">
                          ${inv.amountDueUsdt.toFixed(2)} USDT
                        </span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs font-mono">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Gross Profit:</span>
                        <span className="text-emerald-400 font-bold">+${inv.grossProfit.toFixed(2)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Due Deadline:</span>
                        <span className="text-slate-300 text-[11px]">
                          {new Date(inv.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>

                    {inv.status === 'pending' && (
                      <button
                        onClick={() => handleMarkPaid(inv.id)}
                        className="w-full py-2 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Mark 50% Share Received (TRC20)</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop View: Full Invoices Table */}
              <div className="hidden md:block border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 border-b border-slate-800 text-[10px] uppercase font-semibold text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3">Invoice ID</th>
                      <th className="py-2.5 px-3">Account #</th>
                      <th className="py-2.5 px-3">Gross MT5 Profit</th>
                      <th className="py-2.5 px-3">50% Share Due</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Due Deadline</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-800/30 transition">
                        <td className="py-2.5 px-3 text-slate-400">#{inv.id.slice(0, 10)}</td>
                        <td className="py-2.5 px-3 font-bold text-white">#{inv.accountNumber}</td>
                        <td className="py-2.5 px-3 text-emerald-400 font-bold">${inv.grossProfit.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-amber-400 font-bold">${inv.amountDueUsdt.toFixed(2)} USDT</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                              inv.status === 'paid'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : inv.status === 'overdue_blocked'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                          {new Date(inv.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2.5 px-3 text-right font-sans">
                          {inv.status === 'pending' && (
                            <button
                              onClick={() => handleMarkPaid(inv.id)}
                              className="px-2 py-1 text-[11px] font-bold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition cursor-pointer"
                            >
                              Mark Paid
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            ADMIN SECTION 5: RISK SAFETY GUARD ($200)
            ======================================================== */}
        {activeSection === 'risk_guard' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Risk Safety Floor ($200.00 Minimum)</h4>
                  <p className="text-xs text-slate-400">Strict capital preservation controls</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Prevents client accounts from suffering drawdowns below the mandatory $200 threshold.
                If equity hits the safety floor, copying is suspended automatically to preserve remaining capital.
              </p>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-mono block">Enforced Critical Floor</span>
                  <span className="text-base font-bold font-mono text-red-400 mt-1 block">
                    $200.00 USD
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-mono block">Max Lot Multiplier</span>
                  <span className="text-base font-bold font-mono text-white mt-1 block">
                    {riskSettings.lotSizeMultiplier || 1.0}x
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-mono block">Auto Drawdown Stop</span>
                  <span className="text-base font-bold font-mono text-emerald-400 mt-1 block">
                    Enabled (Automated)
                  </span>
                </div>
              </div>

              <button
                onClick={() => setShowRiskModal(true)}
                className="py-2.5 px-4 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Adjust Risk Safety Floor & Multipliers</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================
            ADMIN SECTION 6: DAILY 50% SETTLEMENT
            ======================================================== */}
        {activeSection === 'daily_settlement' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Daily 50% Profit Share Settlement Engine</h4>
                  <p className="text-xs text-slate-400">Automated UTC daily sweep against High-Water Mark</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                The daily settlement sweep iterates through all monitored client MT5 terminals. Any account exceeding its previous
                High-Water Mark generates a 50% performance fee invoice with an atomic 24-hour settlement window.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={handleExecuteDailySettlement}
                  className="py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 transition cursor-pointer shadow-md"
                >
                  <Award className="w-4 h-4" />
                  <span>Execute Settlement Sweep Now</span>
                </button>

                <button
                  onClick={() => setShowSettlementModal(true)}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 transition cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                  <span>View Settlement Ledger Records</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            ADMIN SECTION 7: FINANCIAL LEDGER & AUDIT TRAIL
            ======================================================== */}
        {activeSection === 'financial_ledger' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">System Financial Ledger & Immutable Audit Trail</h4>
                  <p className="text-xs text-slate-400">Cryptographic audit log verification</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Every trade replication event, fee calculation, TRC20 hash verification, and operator intervention is logged
                with SHA-256 state integrity.
              </p>

              <button
                onClick={() => setShowLedgerModal(true)}
                className="py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer shadow-md"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Open Full Ledger & Audit Trail Dialog</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <RiskSettingsModal
        isOpen={showRiskModal}
        onClose={() => setShowRiskModal(false)}
        currentSettings={riskSettings}
        adminActor={userProfile?.displayName || 'Admin'}
      />
      <LedgerAuditModal
        isOpen={showLedgerModal}
        onClose={() => setShowLedgerModal(false)}
        ledger={tradingEngine.getLedger()}
        auditLogs={tradingEngine.getAuditLogs()}
      />
      <SettlementHistoryModal
        isOpen={showSettlementModal}
        onClose={() => setShowSettlementModal(false)}
        settlements={tradingEngine.getSettlements()}
        currentHwm={2450.0}
      />
    </div>
  );
};
