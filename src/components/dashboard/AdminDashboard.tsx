import { AdminWithdrawalsPanel } from '../admin/AdminWithdrawalsPanel';
import { AdminIncomePanel } from '../admin/AdminIncomePanel';
import { AdminConnectLogPanel } from '../admin/AdminConnectLogPanel';
import { AdminTerminalsPanel } from '../admin/AdminTerminalsPanel';
import React, { useState, useEffect, useRef } from 'react';
import { tradingEngine, CASTIMO_TREASURY_ADDRESS } from '../../services/tradingEngine';
import { authHeaders } from '../../services/apiAuth';
import { Mt5Account, ProfitShareInvoice } from '../../types';
import { getRiskRules, type RiskRules } from '../../services/riskRulesApi';
import { LedgerAuditModal } from '../ledger/LedgerAuditModal';
import { SettlementHistoryModal } from '../settlements/SettlementHistoryModal';
import { MasterAccountPanel } from '../admin/MasterAccountPanel';
import { SidebarNav, NavGroup } from '../common/SidebarNav';
import { Collapsible } from '../common/Collapsible';
import {
  Radio,
  Users,
  ShieldCheck,
  Server,
  DollarSign,
  Clock,
  RefreshCw,
  Wallet,
  Check,
  FileText,
  Award,
  ChevronDown,
  CheckCircle2,
  Layers,
} from 'lucide-react';

/** A compact summary card: a small label, one figure, and an optional short note. */
const Stat: React.FC<{ label: string; value: React.ReactNode; note?: string; tone?: 'amber' | 'rose' | 'emerald' }> = ({ label, value, note, tone }) => (
  <div className="px-3.5 py-3 rounded-xl bg-slate-900 border border-slate-800 min-w-0">
    <span className="text-[11px] text-slate-400 block truncate">{label}</span>
    <span
      className={`text-base font-bold font-mono mt-0.5 block truncate ${
        tone === 'amber' ? 'text-amber-400' : tone === 'rose' ? 'text-rose-400' : tone === 'emerald' ? 'text-emerald-400' : 'text-white'
      }`}
    >
      {value}
    </span>
    {note && <span className="text-[10px] text-slate-500 block truncate mt-0.5">{note}</span>}
  </div>
);

export const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('master');
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  const [supervisedAccounts, setSupervisedAccounts] = useState<Mt5Account[]>(
    tradingEngine.getSupervisedAccounts()
  );
  const [invoices, setInvoices] = useState<ProfitShareInvoice[]>(
    tradingEngine.getProfitInvoices()
  );
  // The rules the server really applies (read-only). undefined = still loading, null = could not be read.
  const [riskRules, setRiskRules] = useState<RiskRules | null | undefined>(undefined);

  // Per client, from the server: profit of the trades closed since the last invoice, the 50% built up on it, unpaid invoices.
  type ClientMoney = { userId: string; login: string; model: 'profit_share' | 'subscription'; periodPnl: number | null; accruedShareUsdt: number | null; unpaidUsdt: number; trades: number; readError: string };
  const [money, setMoney] = useState<Record<string, ClientMoney>>({});
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch('/api/trade/admin/client-money', { headers: await authHeaders() });
        const d = await res.json().catch(() => null);
        if (!stop && res.ok && d?.success && Array.isArray(d.clients)) {
          const map: Record<string, ClientMoney> = {};
          for (const c of d.clients as ClientMoney[]) map[String(c.login)] = c;
          setMoney(map);
        }
      } catch {
        // keep what we had
      }
    };
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  const moneyOf = (acc: Mt5Account) => {
    const m = money[String(acc.accountNumber)];
    const unpaidFromInvoices = invoices.filter((i) => i.accountNumber === acc.accountNumber && i.status !== 'paid').reduce((t, i) => t + i.amountDueUsdt, 0);
    return {
      profit: m?.periodPnl ?? null,
      due: Math.max(m?.unpaidUsdt ?? 0, unpaidFromInvoices),
      accrued: m?.accruedShareUsdt ?? null,
      monthly: m?.model === 'subscription',
      trades: m?.trades ?? 0,
    };
  };
  const signed = (n: number | null) => (n === null ? '—' : `${n < 0 ? '-' : '+'}$${Math.abs(n).toFixed(2)}`);

  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== 'governance') return;
    let cancelled = false;
    getRiskRules().then((r) => {
      if (!cancelled) setRiskRules(r);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    tradingEngine.syncClientsFromBackend();
    void tradingEngine.syncClientIp();
    tradingEngine.syncInvoicesFromBackend(true);
    const invTimer = setInterval(() => tradingEngine.syncInvoicesFromBackend(true), 30000);
    const unsub = tradingEngine.subscribe(() => {
      setSupervisedAccounts([...tradingEngine.getSupervisedAccounts()]);
      setInvoices([...tradingEngine.getProfitInvoices()]);
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

  const totalSupervisedEquity = supervisedAccounts.reduce((sum, a) => sum + a.equity, 0);
  const accountsDisconnected = supervisedAccounts.filter((a) => a.status === 'blocked_unpaid').length;
  const pendingShareTotal = supervisedAccounts.reduce((sum, a) => sum + moneyOf(a).due, 0);
  const pendingInvoicesCount = invoices.filter((i) => i.status === 'pending').length;

  // Admin navigation. Badges show real counts only.
  const adminNavGroups: NavGroup[] = [
    {
      groupTitle: 'Operations',
      items: [
        { id: 'master', label: 'Master account', icon: Radio },
        { id: 'fleet', label: 'Clients', icon: Users, badge: supervisedAccounts.length > 0 ? supervisedAccounts.length : undefined, badgeVariant: 'default' },
        { id: 'terminals', label: 'Duplikium', icon: Layers },
        { id: 'connectlog', label: 'Connection log', icon: Server },
      ],
    },
    {
      groupTitle: 'Billing & risk',
      items: [
        {
          id: 'invoices',
          label: 'Invoices',
          icon: Wallet,
          badge: pendingInvoicesCount > 0 ? `${pendingInvoicesCount} due` : undefined,
          badgeVariant: 'warning',
        },
        { id: 'withdrawals', label: 'Withdrawals', icon: Wallet },
        { id: 'income', label: 'Income', icon: DollarSign },
        {
          id: 'governance',
          label: 'Risk & watcher',
          icon: Clock,
          badge: accountsDisconnected > 0 ? `${accountsDisconnected} blocked` : undefined,
          badgeVariant: 'danger',
        },
      ],
    },
  ];

  const currentTabLabel =
    adminNavGroups.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label || 'Console';

  return (
    <div className="flex flex-col lg:flex-row items-start gap-1 lg:gap-6 max-w-7xl mx-auto pb-12 animate-in fade-in duration-200">
      {/* ========================================================
          COLLAPSIBLE ADMIN SIDEBAR NAVIGATION DOCK
          ======================================================== */}
      <SidebarNav
        groups={adminNavGroups}
        activeId={activeTab}
        onSelect={setActiveTab}
        title="Admin"
        accentColor="purple"
      />

      {/* ========================================================
          MAIN CONTENT AREA (DECONGESTED, RESPONSIVE)
          ======================================================== */}
      <div className="flex-1 w-full space-y-4 min-w-0">
        {/* Header */}
        <div className="px-3 sm:px-4 py-2 sm:py-3 rounded-2xl bg-slate-900 border border-purple-900/40 shadow-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h1 className="text-sm font-semibold text-white truncate">{currentTabLabel}</h1>
          </div>

          <div className="relative shrink-0" ref={actionsMenuRef}>
            <button
              type="button"
              onClick={() => setActionsMenuOpen(!actionsMenuOpen)}
              aria-expanded={actionsMenuOpen}
              className="btn-quiet px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>Tools</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${actionsMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {actionsMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-xl bg-slate-900 border border-purple-900/60 shadow-2xl p-1.5 z-50 text-slate-200 animate-in fade-in duration-150">
                <button
                  type="button"
                  onClick={handleExecuteDailySettlement}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg hover:bg-purple-950/40 transition text-left cursor-pointer"
                >
                  <Award className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="font-medium">Settlement</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLedgerModal(true);
                    setActionsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg hover:bg-purple-950/40 transition text-left cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                  <span className="font-medium">Audit ledger</span>
                </button>
              </div>
            )}
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <Stat label="Clients" value={supervisedAccounts.length} note={`${supervisedAccounts.filter((a) => a.status === 'copying').length} copying`} />
              <Stat label="Client equity" value={`$${totalSupervisedEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
              <Stat label="Share due" value={`$${pendingShareTotal.toFixed(2)}`} note="USDT" tone="amber" />
              <Stat label="Blocked" value={accountsDisconnected} tone="rose" />
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{supervisedAccounts.length} connected</span>
              </div>

              {/* Mobile Card View */}
              <div className="block md:hidden divide-y divide-slate-800/60">
                {supervisedAccounts.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-xs">
                    No clients connected yet.
                  </div>
                ) : (
                  supervisedAccounts.map((acc) => {
                    const isOverdue = acc.status === 'blocked_unpaid';
                    const mo = moneyOf(acc);
                    const hasDue = mo.due > 0;
                    const activeInv = invoices.find(
                      (i) => i.accountNumber === acc.accountNumber && i.status === 'pending'
                    );

                    return (
                      <div key={acc.id} className="py-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
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
                            <span className="text-[11px] text-slate-400 block mt-0.5 truncate">{acc.brokerServer}</span>
                          </div>

                          <div className="text-right">
                            <span className="font-mono font-bold text-white text-sm block">
                              ${acc.equity.toFixed(2)}
                            </span>
                            <span className={`text-[10px] block font-mono ${(mo.profit ?? 0) < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                              {mo.monthly ? 'Monthly plan' : signed(mo.profit)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 text-xs">
                          <span className="text-slate-400 font-mono">
                            Due: ${mo.due.toFixed(2)} USDT{mo.accrued ? ` · building $${mo.accrued.toFixed(2)}` : ''}
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
                                className="btn-quiet px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-500 hover:bg-blue-400 text-white transition cursor-pointer"
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
                      <th className="py-2 px-3">Account</th>
                      <th className="py-2 px-3">Broker</th>
                      <th className="py-2 px-3">Equity</th>
                      <th className="py-2 px-3">Profit since last invoice</th>
                      <th className="py-2 px-3">Share due</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {supervisedAccounts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500 font-sans text-xs">
                          No clients connected yet.
                        </td>
                      </tr>
                    ) : (
                      supervisedAccounts.map((acc) => {
                        const isOverdue = acc.status === 'blocked_unpaid';
                        const mo = moneyOf(acc);
                    const hasDue = mo.due > 0;
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
                                  ✓ Verified
                                </span>
                              ) : acc.leverage ? (
                                <span className="text-[9px] text-slate-400 block font-mono">1:{acc.leverage}</span>
                              ) : null}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-white">
                              ${acc.equity.toFixed(2)}
                              <span className="text-[10px] text-slate-500 block font-normal">
                                Bal: ${acc.balance.toFixed(2)}
                              </span>
                            </td>
                            <td className={`py-2.5 px-3 font-bold ${(mo.profit ?? 0) < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                              {mo.monthly ? <span className="text-slate-400 font-normal text-xs">Monthly plan</span> : signed(mo.profit)}
                              {!mo.monthly && mo.profit !== null && (
                                <span className="text-[10px] text-slate-500 block font-normal">{mo.trades} closed trade{mo.trades === 1 ? '' : 's'} since last invoice</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-amber-400 font-bold">
                              ${mo.due.toFixed(2)} USDT
                              {!mo.monthly && mo.accrued !== null && mo.accrued > 0 && (
                                <span className="text-[10px] text-slate-500 block font-normal">+${mo.accrued.toFixed(2)} building, not invoiced yet</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {isOverdue ? (
                                <span className="text-[10px] font-bold text-rose-300 bg-rose-500/15 px-2 py-0.5 rounded border border-rose-500/30">
                                  Blocked
                                </span>
                              ) : hasDue ? (
                                <span className="text-[10px] font-bold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30">
                                  Payment due
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                  Active
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
                                  className="btn-quiet px-2.5 py-1 text-[11px] font-bold rounded-lg bg-blue-500 hover:bg-blue-400 text-white transition cursor-pointer"
                                >
                                  Reconnect
                                </button>
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <Stat label="Outstanding" value={`$${pendingShareTotal.toFixed(2)} USDT`} note={`${pendingInvoicesCount} pending`} tone="amber" />
              <Stat label="Invoices" value={invoices.length} note={`${invoices.filter((i) => i.status === 'paid').length} paid`} />
              <Stat label="Payments" value="TRC20 USDT" note={CASTIMO_TREASURY_ADDRESS || 'Payment address not set yet'} tone="emerald" />
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{invoices.length} total</span>
              </div>

              {/* Mobile View */}
              <div className="block md:hidden divide-y divide-slate-800/60">
                {invoices.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-xs">
                    No invoices yet.
                  </div>
                ) : (
                  invoices.map((inv) => (
                    <div key={inv.id} className="py-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
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
                          <span>Mark paid</span>
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
                      <th className="py-2 px-3">Invoice</th>
                      <th className="py-2 px-3">Account</th>
                      <th className="py-2 px-3">Profit</th>
                      <th className="py-2 px-3">Due</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">TXID</th>
                      <th className="py-2 px-3 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {invoices.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500 font-sans text-xs">
                          No invoices yet.
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
                              <span className="text-slate-500">Not paid yet</span>
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
        {activeTab === 'terminals' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <AdminTerminalsPanel />
          </div>
        )}

        {activeTab === 'connectlog' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <AdminConnectLogPanel />
          </div>
        )}

        {activeTab === 'income' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <AdminIncomePanel />
          </div>
        )}

        {activeTab === 'withdrawals' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <AdminWithdrawalsPanel />
          </div>
        )}

        {activeTab === 'governance' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white">Payment watcher</h3>
                  <p className="text-xs text-slate-400">Pauses copying when an invoice is unpaid past its due time.</p>
                </div>
                <button
                  type="button"
                  onClick={handleTriggerWatcherSweep}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                  <span>Run sweep</span>
                </button>
              </div>
              <Collapsible title="How billing and pausing work" openLabel="Details" closeLabel="Hide">
                <p>Monthly-plan clients are never judged by invoices. If their month ends unpaid, copying pauses until they pay again.</p>
                <p>Profit-share clients are invoiced from real profit once per settlement period and have the invoice due time to pay. Unpaid, copying pauses until it is paid.</p>
                <p>A paused client is set to close only: no new trades are copied, and trades already open still close when the master closes them.</p>
              </Collapsible>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
                <h4 className="text-sm font-semibold text-white">Risk</h4>
                <div className="px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-500 block">Minimum to copy</span>
                    <span className="font-bold text-red-400">
                      {riskRules ? `$${riskRules.connectMinimum.usd.toFixed(2)} USD` : riskRules === undefined ? '…' : 'Not available'}
                    </span>
                  </div>
                  <div className="text-right min-w-0">
                    <span className="text-[10px] text-slate-500 block">Copy size</span>
                    <span className="font-bold text-white">
                      {riskRules?.copySize ? `type ${riskRules.copySize.type} · ${riskRules.copySize.value}` : riskRules === undefined ? '…' : 'Not available'}
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 leading-relaxed space-y-1.5">
                  <p>
                    <strong className="text-slate-300">Minimum to copy:</strong> any USD account can connect. Below this equity it shows as connected but not copying, and copying starts by itself once it reaches the minimum. An account that has started copying is never paused because its equity falls.{' '}
                    {riskRules?.connectMinimum.source === 'setting'
                      ? 'Set by MIN_CONNECT_EQUITY on Render.'
                      : 'This is the built-in default. Change it with MIN_CONNECT_EQUITY on Render.'}
                  </p>
                  <p>
                    <strong className="text-slate-300">Copy size:</strong> what Duplikium gives every new client.{' '}
                    {riskRules?.copySize?.source === 'setting'
                      ? 'Set by DUPLIKIUM_RISK_TYPE and DUPLIKIUM_RISK_VALUE on Render.'
                      : 'It comes from your Duplikium template; change it there.'}
                  </p>
                  <p className="text-slate-500">Read-only. These are the rules the server actually applies.</p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
                <h4 className="text-sm font-semibold text-white">Records</h4>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSettlementModal(true)}
                    className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <Award className="w-3.5 h-3.5 text-amber-400" />
                    <span>Settlements</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLedgerModal(true)}
                    className="btn-quiet flex-1 py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Audit ledger</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Supervisory Modals */}
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
