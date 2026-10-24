import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { tradingEngine, CASTIMO_TREASURY_ADDRESS } from '../../services/tradingEngine';
import { Mt5Account, RiskSettings, ProfitShareInvoice } from '../../types';
import { RiskSettingsModal } from '../risk/RiskSettingsModal';
import { LedgerAuditModal } from '../ledger/LedgerAuditModal';
import { SettlementHistoryModal } from '../settlements/SettlementHistoryModal';
import { MasterAccountPanel } from '../admin/MasterAccountPanel';
import { SidebarNav, NavGroup } from '../common/SidebarNav';
import {
  Radio,
  Users,
  ShieldCheck,
  Server,
  DollarSign,
  Clock,
  Zap,
  RefreshCw,
  Wallet,
  Activity,
  Check,
  RotateCcw,
  Sliders,
  FileText,
  Award,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Layers,
  ArrowRight,
  CreditCard,
  ExternalLink,
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const { userProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('master');
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

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
    tradingEngine.syncClientsFromBackend();
    tradingEngine.syncInvoicesFromBackend(true);
    const invTimer = setInterval(() => tradingEngine.syncInvoicesFromBackend(true), 30000);
    const unsub = tradingEngine.subscribe(() => {
      setSupervisedAccounts([...tradingEngine.getSupervisedAccounts()]);
      setInvoices([...tradingEngine.getProfitInvoices()]);
      setRiskSettings({ ...tradingEngine.getRiskSettings() });
    });

    const syncTimer = setInterval(() => {
      tradingEngine.syncClientsFromBackend();
    }, 4000);

    return () => {
      clearInterval(invTimer);
      unsub();
      clearInterval(syncTimer);
    };
  }, []);

  // Close actions dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTriggerWatcherSweep = () => {
    const res = tradingEngine.trigger24hWatcherSweep();
    setActionSuccess(res.message);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  const handleSimulateNewProfit = () => {
    setActionSuccess('Test profit is switched off. Invoices are created automatically from each client\'s real broker profit.');
    setTimeout(() => setActionSuccess(null), 5000);
  };

  const handleSimulate24hTimeout = () => {
    setActionSuccess('Time simulation is switched off. Overdue invoices pause copying automatically.');
    setTimeout(() => setActionSuccess(null), 5000);
  };

  const handleExecuteDailySettlement = () => {
    setActionSuccess('Settlement runs automatically on the server each period. Nothing to run by hand.');
    setActionsMenuOpen(false);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  const handleMarkPaid = async (invoiceId: string) => {
    const r = await tradingEngine.adminConfirmInvoice(invoiceId, 'Confirmed by administrator');
    setActionSuccess(r.success ? `Invoice #${invoiceId} marked as paid. Copying resumes shortly.` : r.error || 'Could not confirm the invoice.');
    setTimeout(() => setActionSuccess(null), 4000);
  };

  const handleReconnect = (accNum: string) => {
    tradingEngine.reconnectAccount(accNum);
    setActionSuccess(`Client account #${accNum} trade copying reconnected.`);
    setTimeout(() => setActionSuccess(null), 3000);
  };

  const handleResetToInitialState = () => {
    tradingEngine.resetAdminToInitialState();
    setActionSuccess('Admin oversight console & Master MT5 bridge reset to initial clean state ($0.00, Disconnected).');
    setActionsMenuOpen(false);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  const totalSupervisedEquity = supervisedAccounts.reduce((sum, a) => sum + a.equity, 0);
  const accountsDisconnected = supervisedAccounts.filter((a) => a.status === 'blocked_unpaid').length;
  const pendingShareTotal = supervisedAccounts.reduce(
    (sum, a) => sum + (a.unpaidProfitShareUsdt || 0),
    0
  );
  const pendingInvoicesCount = invoices.filter((i) => i.status === 'pending').length;

  // Streamlined, collapsible Admin navigation groups
  const adminNavGroups: NavGroup[] = [
    {
      groupTitle: 'Signal & Infrastructure',
      items: [
        {
          id: 'master',
          label: 'Master MT5 Bridge',
          icon: Radio,
          badge: 'Broadcasting',
          badgeVariant: 'default',
        },
        {
          id: 'fleet',
          label: 'Client Fleets',
          icon: Users,
          badge: supervisedAccounts.length,
          badgeVariant: 'default',
        },
      ],
    },
    {
      groupTitle: 'Revenue & Governance',
      items: [
        {
          id: 'invoices',
          label: '50% Share & Hashes',
          icon: Wallet,
          badge: pendingInvoicesCount > 0 ? `${pendingInvoicesCount} Due` : 'Settled',
          badgeVariant: pendingInvoicesCount > 0 ? 'warning' : 'success',
        },
        {
          id: 'governance',
          label: '24h Watcher & Risk',
          icon: Clock,
          badge: accountsDisconnected > 0 ? `${accountsDisconnected} Blocked` : 'Active',
          badgeVariant: accountsDisconnected > 0 ? 'danger' : 'success',
        },
      ],
    },
  ];

  const currentTabLabel =
    adminNavGroups.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label || 'Console';

  return (
    <div className="flex flex-col lg:flex-row items-start gap-6 max-w-7xl mx-auto pb-12 animate-in fade-in duration-200">
      {/* ========================================================
          COLLAPSIBLE ADMIN SIDEBAR NAVIGATION DOCK
          ======================================================== */}
      <SidebarNav
        groups={adminNavGroups}
        activeId={activeTab}
        onSelect={setActiveTab}
        title="Admin Console"
        subtitle="Institutional Desk"
        accentColor="purple"
        statusBadge={{
          text: 'Watcher Active',
          variant: 'purple',
          pulsing: true,
        }}
      />

      {/* ========================================================
          MAIN CONTENT AREA (DECONGESTED, RESPONSIVE)
          ======================================================== */}
      <div className="flex-1 w-full space-y-4 min-w-0">
        {/* Streamlined Top Control Header */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-purple-900/40 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0 shadow-inner">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black text-white">
                  {currentTabLabel}
                </h1>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <p className="text-xs text-slate-400 truncate">
                Admin Oversight • 50% Profit Share Protocol • 24h Autonomous Watcher
              </p>
            </div>
          </div>

          {/* Quick Actions Dropdown */}
          <div className="flex items-center gap-2 self-end sm:self-auto" ref={actionsMenuRef}>
            <div className="relative">
              <button
                type="button"
                onClick={() => setActionsMenuOpen(!actionsMenuOpen)}
                className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-md shadow-purple-950/40"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300" />
                <span>Supervisory Tools</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${actionsMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {actionsMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-xl bg-slate-900 border border-purple-900/60 shadow-2xl p-2 z-50 text-slate-200 animate-in fade-in duration-150">
                  <div className="px-3 py-1.5 border-b border-slate-800 text-[10px] font-semibold text-purple-400 uppercase tracking-wider">
                    Administrative Tools
                  </div>
                  <div className="space-y-1 pt-1">
                    <button
                      type="button"
                      onClick={handleExecuteDailySettlement}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg hover:bg-purple-950/40 text-slate-200 hover:text-amber-300 transition text-left cursor-pointer"
                    >
                      <Award className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <span className="font-semibold block">Execute 50% Settlement</span>
                        <span className="text-[10px] text-slate-400 block">Run UTC daily performance sweep</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowRiskModal(true);
                        setActionsMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg hover:bg-purple-950/40 text-slate-200 hover:text-rose-300 transition text-left cursor-pointer"
                    >
                      <Sliders className="w-4 h-4 text-rose-400 shrink-0" />
                      <div>
                        <span className="font-semibold block">Risk Guard Floor ($200)</span>
                        <span className="text-[10px] text-slate-400 block">Configure drawdown & lot limits</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowLedgerModal(true);
                        setActionsMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg hover:bg-purple-950/40 text-slate-200 hover:text-purple-300 transition text-left cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                      <div>
                        <span className="font-semibold block">Ledger & Audit Trail</span>
                        <span className="text-[10px] text-slate-400 block">Cryptographic event logs</span>
                      </div>
                    </button>

                    <div className="border-t border-slate-800 my-1" />

                    <button
                      type="button"
                      onClick={handleResetToInitialState}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition text-left cursor-pointer"
                    >
                      <RotateCcw className="w-4 h-4 text-slate-400 shrink-0" />
                      <div>
                        <span className="font-semibold block">Reset Console to Initial</span>
                        <span className="text-[10px] text-slate-500 block">Clear to $0.00 standby mode</span>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Success Notification Bar */}
        {actionSuccess && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* ========================================================
            TAB 1: MASTER SIGNAL PROVIDER & CLOUD BRIDGE
            ======================================================== */}
        {activeTab === 'master' && (
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
            TAB 2: CLIENT FLEET TERMINALS
            ======================================================== */}
        {activeTab === 'fleet' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Quick KPI Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <span className="text-[11px] text-slate-400 block font-medium">Total Terminals</span>
                <span className="text-xl sm:text-2xl font-black font-mono text-white mt-1 block">
                  {supervisedAccounts.length}
                </span>
                <span className="text-[10px] text-emerald-400 block mt-0.5">
                  {supervisedAccounts.filter((a) => a.status === 'copying').length} Actively Copying
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <span className="text-[11px] text-slate-400 block font-medium">Total Client Equity</span>
                <span className="text-xl sm:text-2xl font-black font-mono text-white mt-1 block">
                  ${totalSupervisedEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  Direct broker custody
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <span className="text-[11px] text-slate-400 block font-medium">50% Share Due</span>
                <span className="text-xl sm:text-2xl font-black font-mono text-amber-400 mt-1 block">
                  ${pendingShareTotal.toFixed(2)} USDT
                </span>
                <span className="text-[10px] text-amber-300 block mt-0.5">
                  24h settlement grace
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <span className="text-[11px] text-slate-400 block font-medium">Blocked (&gt;24h)</span>
                <span className="text-xl sm:text-2xl font-black font-mono text-rose-400 mt-1 block">
                  {accountsDisconnected}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  Auto-disconnected by daemon
                </span>
              </div>
            </div>

            {/* Client Fleet List Card */}
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Supervised Client Terminals</h3>
                    <p className="text-xs text-slate-400">Real-time replication status and equity monitoring</p>
                  </div>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {supervisedAccounts.length} Connected
                </span>
              </div>

              {/* Mobile Card View */}
              <div className="block md:hidden divide-y divide-slate-800/60">
                {supervisedAccounts.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-xs">
                    No supervised MT5 client terminals connected.
                  </div>
                ) : (
                  supervisedAccounts.map((acc) => {
                    const isOverdue = acc.status === 'blocked_unpaid';
                    const hasDue = (acc.unpaidProfitShareUsdt || 0) > 0;
                    const activeInv = invoices.find(
                      (i) => i.accountNumber === acc.accountNumber && i.status === 'pending'
                    );

                    return (
                      <div key={acc.id} className="py-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-white text-sm">#{acc.accountNumber}</span>
                              <span
                                className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                  acc.status === 'copying'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : isOverdue
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {acc.status}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-400 block mt-0.5">{acc.brokerServer}</span>
                          </div>

                          <div className="text-right">
                            <span className="font-mono font-bold text-white text-sm block">
                              ${acc.equity.toFixed(2)}
                            </span>
                            <span className="text-[10px] text-emerald-400 block font-mono">
                              +${(acc.lastProfitGenerated || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 text-xs">
                          <span className="text-slate-400 font-mono">
                            Due: ${(acc.unpaidProfitShareUsdt || 0).toFixed(2)} USDT
                          </span>
                          <div className="flex items-center gap-1.5">
                            {hasDue && activeInv && (
                              <button
                                type="button"
                                onClick={() => handleMarkPaid(activeInv.id)}
                                className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition cursor-pointer"
                              >
                                Mark Paid
                              </button>
                            )}
                            {isOverdue && (
                              <button
                                type="button"
                                onClick={() => handleReconnect(acc.accountNumber)}
                                className="px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-500 hover:bg-blue-400 text-white transition cursor-pointer"
                              >
                                Reconnect
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 border-b border-slate-800 text-[10px] uppercase font-semibold text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3">Account #</th>
                      <th className="py-2.5 px-3">Broker Bridge</th>
                      <th className="py-2.5 px-3">Live Equity</th>
                      <th className="py-2.5 px-3">Last Profit</th>
                      <th className="py-2.5 px-3">50% Share Due</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {supervisedAccounts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500 font-sans text-xs">
                          No supervised MT5 client terminals connected. Awaiting client linkages.
                        </td>
                      </tr>
                    ) : (
                      supervisedAccounts.map((acc) => {
                        const isOverdue = acc.status === 'blocked_unpaid';
                        const hasDue = (acc.unpaidProfitShareUsdt || 0) > 0;
                        const activeInv = invoices.find(
                          (i) => i.accountNumber === acc.accountNumber && i.status === 'pending'
                        );

                        return (
                          <tr key={acc.id} className="hover:bg-slate-800/30 transition">
                            <td className="py-2.5 px-3">
                              <span className="font-bold text-white block">#{acc.accountNumber}</span>
                              {acc.accountHolderName && (
                                <span className="text-[10px] text-slate-400 font-sans block truncate max-w-[130px]">
                                  {acc.accountHolderName}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="text-slate-300 block">{acc.brokerName || acc.brokerServer}</span>
                              {acc.isBrokerVerified ? (
                                <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 inline-block mt-0.5">
                                  ✓ Verified Real Broker
                                </span>
                              ) : (
                                <span className="text-[9px] text-slate-400 block font-mono">1:{acc.leverage || 500}</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-white">
                              ${acc.equity.toFixed(2)}
                              <span className="text-[10px] text-slate-500 block font-normal">
                                Bal: ${acc.balance.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-emerald-400 font-bold">+${(acc.lastProfitGenerated || 0).toFixed(2)}</td>
                            <td className="py-2.5 px-3 text-amber-400 font-bold">${(acc.unpaidProfitShareUsdt || 0).toFixed(2)} USDT</td>
                            <td className="py-2.5 px-3">
                              {isOverdue ? (
                                <span className="text-[10px] font-bold text-rose-300 bg-rose-500/15 px-2 py-0.5 rounded border border-rose-500/30">
                                  Blocked (&gt;24h)
                                </span>
                              ) : hasDue ? (
                                <span className="text-[10px] font-bold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30">
                                  Grace Period
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                  Copying Active
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-sans">
                              {hasDue && activeInv && (
                                <button
                                  type="button"
                                  onClick={() => handleMarkPaid(activeInv.id)}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition cursor-pointer"
                                >
                                  Mark Paid
                                </button>
                              )}
                              {isOverdue && (
                                <button
                                  type="button"
                                  onClick={() => handleReconnect(acc.accountNumber)}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-blue-500 hover:bg-blue-400 text-white transition cursor-pointer"
                                >
                                  Reconnect
                                </button>
                              )}
                              {!hasDue && !isOverdue && (
                                <span className="text-[11px] text-slate-500">Auto-Monitored</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            TAB 3: 50% PROFIT SHARE INVOICES & HASH AUDIT QUEUE
            ======================================================== */}
        {activeTab === 'invoices' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* KPI Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <span className="text-[11px] text-slate-400 block font-medium">Outstanding 50% Dues</span>
                <span className="text-xl sm:text-2xl font-black font-mono text-amber-400 mt-1 block">
                  ${pendingShareTotal.toFixed(2)} USDT
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {pendingInvoicesCount} Invoices Pending
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <span className="text-[11px] text-slate-400 block font-medium">Total Invoices Issued</span>
                <span className="text-xl sm:text-2xl font-black font-mono text-white mt-1 block">
                  {invoices.length}
                </span>
                <span className="text-[10px] text-emerald-400 block mt-0.5">
                  {invoices.filter((i) => i.status === 'paid').length} Settled On-Chain
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <span className="text-[11px] text-slate-400 block font-medium">Remittance Rail</span>
                <span className="text-sm font-bold text-emerald-400 mt-2 block font-mono">
                  TRON (TRC20 USDT)
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5 truncate font-mono">
                  {CASTIMO_TREASURY_ADDRESS || 'Payment address not set yet'}
                </span>
              </div>
            </div>

            {/* Invoices & Hashes List */}
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <Wallet className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">50% Profit Share Invoices & Transaction Hashes</h3>
                    <p className="text-xs text-slate-400">Audited remittance records with TRC20 verification hashes</p>
                  </div>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {invoices.length} Records
                </span>
              </div>

              {/* Mobile View */}
              <div className="block md:hidden divide-y divide-slate-800/60">
                {invoices.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-xs">
                    No profit share invoices generated. Awaiting MT5 trade closures.
                  </div>
                ) : (
                  invoices.map((inv) => (
                    <div key={inv.id} className="py-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-mono font-bold text-white text-sm">Account #{inv.accountNumber}</span>
                          <span className="text-[10px] text-slate-500 block font-mono">Invoice #{inv.id.slice(0, 10)}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-mono font-bold text-amber-400 text-sm block">
                            ${inv.amountDueUsdt.toFixed(2)} USDT
                          </span>
                          <span
                            className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full inline-block mt-0.5 ${
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
                      </div>

                      {inv.txHash && (
                        <div className="p-2 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-emerald-300 break-all">
                          TXID: {inv.txHash}
                        </div>
                      )}

                      {inv.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => handleMarkPaid(inv.id)}
                          className="w-full py-2 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Verify & Mark Paid (TRC20)</span>
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Desktop View */}
              <div className="hidden md:block border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 border-b border-slate-800 text-[10px] uppercase font-semibold text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3">Invoice ID</th>
                      <th className="py-2.5 px-3">Account #</th>
                      <th className="py-2.5 px-3">Gross MT5 Profit</th>
                      <th className="py-2.5 px-3">50% Share Due</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Transaction Hash (TXID)</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {invoices.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500 font-sans text-xs">
                          No 50% profit share invoices generated. Awaiting MT5 trade settlements.
                        </td>
                      </tr>
                    ) : (
                      invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-slate-800/30 transition">
                          <td className="py-2.5 px-3 text-slate-400">#{inv.id.slice(0, 10)}</td>
                          <td className="py-2.5 px-3 font-bold text-white">#{inv.accountNumber}</td>
                          <td className="py-2.5 px-3 text-emerald-400 font-bold">+${inv.grossProfit.toFixed(2)}</td>
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
                          <td className="py-2.5 px-3 max-w-[200px] truncate">
                            {inv.txHash ? (
                              <span className="text-emerald-400 text-[11px]" title={inv.txHash}>
                                {inv.txHash.slice(0, 12)}...{inv.txHash.slice(-8)}
                              </span>
                            ) : (
                              <span className="text-slate-500 italic">Awaiting submission</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-sans">
                            {inv.status === 'pending' && (
                              <button
                                type="button"
                                onClick={() => handleMarkPaid(inv.id)}
                                className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition cursor-pointer"
                              >
                                Mark Paid
                              </button>
                            )}
                            {inv.status === 'paid' && (
                              <span className="text-[11px] text-emerald-400 flex items-center justify-end gap-1">
                                <Check className="w-3 h-3" />
                                <span>Verified</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            TAB 4: 24H WATCHER & RISK GOVERNANCE
            ======================================================== */}
        {activeTab === 'governance' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Autonomous 24h Watcher Daemon Card */}
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping absolute" />
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>Autonomous 24-Hour Settlement Watcher</span>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        ACTIVE
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Continuous watcher reads closed MT5 profits, issues 50% invoices, and terminates copying after 24 hours.
                    </p>
                  </div>
                </div>

                {/* Simulation Testing Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTriggerWatcherSweep}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
                    title="Runs background sweep daemon"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                    <span>Run Sweep</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSimulateNewProfit}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition flex items-center gap-1.5 cursor-pointer"
                    title="Simulates +$200 trade profit"
                  >
                    <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Simulate Profit (+$200)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSimulate24hTimeout}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition flex items-center gap-1.5 cursor-pointer"
                    title="Simulates 24h expiration"
                  >
                    <Clock className="w-3.5 h-3.5 text-rose-400" />
                    <span>Simulate 24h Timeout</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Risk Floor & Ledger Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Risk Floor Card */}
              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                    <Sliders className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Risk Safety Floor ($200.00 Floor)</h4>
                    <p className="text-xs text-slate-400">Enforced capital preservation limit</p>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-2 gap-2 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Critical Floor:</span>
                    <span className="font-bold text-red-400">$200.00 USD</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">Lot Multiplier:</span>
                    <span className="font-bold text-white">{riskSettings.lotSizeMultiplier || 1.0}x</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowRiskModal(true)}
                  className="w-full py-2.5 px-4 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Adjust Risk Safety Floor & Multipliers</span>
                </button>
              </div>

              {/* Daily Settlement & Ledger Records */}
              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Cryptographic Audit & Daily Settlements</h4>
                    <p className="text-xs text-slate-400">SHA-256 ledger integrity tracking</p>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowSettlementModal(true)}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <Award className="w-3.5 h-3.5 text-amber-400" />
                    <span>Settlements</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowLedgerModal(true)}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-md"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Audit Ledger</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Supervisory Modals */}
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
        currentHwm={totalSupervisedEquity}
      />
    </div>
  );
};
