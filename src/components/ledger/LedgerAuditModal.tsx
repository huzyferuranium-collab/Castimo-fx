import React, { useState } from 'react';
import { LedgerEntry, AuditLog, ReconciliationReport } from '../../types';
import { tradingEngine } from '../../services/tradingEngine';
import {
  FileText,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  ExternalLink,
} from 'lucide-react';

interface LedgerAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  ledger: LedgerEntry[];
  auditLogs: AuditLog[];
}

export const LedgerAuditModal: React.FC<LedgerAuditModalProps> = ({
  isOpen,
  onClose,
  ledger,
  auditLogs,
}) => {
  const [tab, setTab] = useState<'ledger' | 'audit' | 'reconciliation'>('ledger');
  const [reconReport, setReconReport] = useState<ReconciliationReport | null>(null);
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const handleRunReconciliation = () => {
    const report = tradingEngine.generateReconciliationReport();
    setReconReport(report);
  };

  const filteredLedger = ledger.filter(
    (l) =>
      l.description.toLowerCase().includes(search.toLowerCase()) ||
      l.referenceId.toLowerCase().includes(search.toLowerCase()) ||
      l.referenceType.toLowerCase().includes(search.toLowerCase())
  );

  const filteredAudit = auditLogs.filter(
    (a) =>
      a.action.toLowerCase().includes(search.toLowerCase()) ||
      a.actor.toLowerCase().includes(search.toLowerCase()) ||
      a.details.toLowerCase().includes(search.toLowerCase()) ||
      a.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-gradient-to-r from-slate-800 via-slate-900 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Financial Ledger & Audit Console</h3>
              <p className="text-xs text-slate-400">Sections 4, 13 & 14: Immutable double-entry records & security traces</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            ✕
          </button>
        </div>

        {/* Tab & Search Bar */}
        <div className="p-3 border-b border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setTab('ledger')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                tab === 'ledger'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Authoritative Ledger ({ledger.length})
            </button>
            <button
              onClick={() => setTab('audit')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                tab === 'audit'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Audit Trail ({auditLogs.length})
            </button>
            <button
              onClick={() => setTab('reconciliation')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                tab === 'reconciliation'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              System Reconciliation
            </button>
          </div>

          {tab !== 'reconciliation' && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by ID, action, reference..."
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 w-56"
              />
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {tab === 'ledger' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Immutable financial movements with UTC timestamps & reference types</span>
                <span className="font-mono text-emerald-400 font-semibold">
                  Balance After Last Op: ${ledger[0]?.balanceAfter.toFixed(2) || '0.00'} USDT
                </span>
              </div>

              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 border-b border-slate-800 text-[10px] uppercase font-semibold text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3">Entry ID & Date (UTC)</th>
                      <th className="py-2.5 px-3">Reference & Event</th>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3 text-right">Debit (-)</th>
                      <th className="py-2.5 px-3 text-right">Credit (+)</th>
                      <th className="py-2.5 px-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {filteredLedger.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-800/40">
                        <td className="py-3 px-3">
                          <span className="font-bold text-white block">{entry.id}</span>
                          <span className="text-[10px] text-slate-500">
                            {new Date(entry.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 block max-w-fit">
                            {entry.referenceType}
                          </span>
                          <span className="text-[10px] text-slate-400 mt-0.5 block truncate max-w-[120px]">
                            {entry.referenceId}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-sans text-slate-300 text-xs">
                          {entry.description}
                        </td>
                        <td className="py-3 px-3 text-right text-rose-400 font-bold">
                          {entry.debit > 0 ? `-$${entry.debit.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-3 px-3 text-right text-emerald-400 font-bold">
                          {entry.credit > 0 ? `+$${entry.credit.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-3 px-3 text-right text-slate-100 font-bold">
                          ${entry.balanceAfter.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'audit' && (
            <div className="space-y-3">
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 border-b border-slate-800 text-[10px] uppercase font-semibold text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3">Timestamp (UTC)</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Actor / IP</th>
                      <th className="py-2.5 px-3">Action</th>
                      <th className="py-2.5 px-3">Details</th>
                      <th className="py-2.5 px-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredAudit.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-800/40">
                        <td className="py-3 px-3 font-mono text-[10px] text-slate-400">
                          {new Date(log.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
                        </td>
                        <td className="py-3 px-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {log.category}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-semibold text-white block">{log.actor}</span>
                          <span className="text-[10px] font-mono text-slate-500">{log.ip}</span>
                        </td>
                        <td className="py-3 px-3 font-mono font-semibold text-emerald-400 text-[11px]">
                          {log.action}
                        </td>
                        <td className="py-3 px-3 text-slate-300 text-xs">
                          {log.details}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span
                            className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                              log.status === 'SUCCESS'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'reconciliation' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div>
                  <h4 className="font-bold text-sm text-white">Daily Multi-Engine Reconciliation Report</h4>
                  <p className="text-xs text-slate-400">
                    Compares MT5 bridge states, database snapshots, TronGrid blockchain entries, and double-entry ledger balance.
                  </p>
                </div>
                <button
                  onClick={handleRunReconciliation}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 font-semibold text-xs text-white transition flex items-center gap-1.5 shadow-md shadow-purple-600/30 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Run Audit Reconciliation</span>
                </button>
              </div>

              {reconReport ? (
                <div className="space-y-3 animate-in fade-in">
                  <div
                    className={`p-4 rounded-xl border flex items-center justify-between ${
                      reconReport.status === 'BALANCED'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {reconReport.status === 'BALANCED' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-rose-400" />
                      )}
                      <div>
                        <div className="font-bold text-sm">
                          {reconReport.status === 'BALANCED'
                            ? 'All Financial & Copier Subsystems Balanced'
                            : 'Subsystem Discrepancy Detected'}
                        </div>
                        <div className="text-[11px] opacity-80">Report ID: {reconReport.id}</div>
                      </div>
                    </div>
                    <span className="text-xs font-mono">
                      Generated: {new Date(reconReport.timestamp).toUTCString()}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block">MT5 Bridge Equity</span>
                      <span className="text-sm font-bold text-white">${reconReport.mt5EquityVsDb.toFixed(2)}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block">Authoritative Ledger Net</span>
                      <span className="text-sm font-bold text-white">${reconReport.ledgerBalanceVsCash.toFixed(2)}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block">Active Copied Positions</span>
                      <span className="text-sm font-bold text-emerald-400">{reconReport.openCopiedPositions}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block">Pending Withdrawals Locked</span>
                      <span className="text-sm font-bold text-amber-400">{reconReport.pendingWithdrawalsCount}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
                  Click "Run Audit Reconciliation" to cross-verify live MT5 state with ledger balances.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
