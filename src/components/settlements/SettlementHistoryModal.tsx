import React from 'react';
import { ProfitShareSettlement } from '../../types';
import { Award, TrendingUp, Calendar, CheckCircle2, ShieldCheck, DollarSign } from 'lucide-react';

interface SettlementHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  settlements: ProfitShareSettlement[];
  currentHwm: number;
}

export const SettlementHistoryModal: React.FC<SettlementHistoryModalProps> = ({
  isOpen,
  onClose,
  settlements,
  currentHwm,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[85vh]">
        <div className="p-5 border-b border-slate-800 bg-gradient-to-r from-amber-600/20 via-slate-900 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Daily Profit-Share & High-Water Mark</h3>
              <p className="text-xs text-slate-400">Section 12: Automated UTC Performance Settlement</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {/* HWM Status Banner */}
          <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-slate-950 border border-slate-800">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Current High-Water Mark
              </span>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
                ${currentHwm.toFixed(2)}
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Performance Fee
              </span>
              <div className="text-xl font-bold font-mono text-amber-400 mt-0.5">
                50.0%
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Settlement Window
              </span>
              <div className="text-xs font-semibold text-slate-300 mt-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>23:59:59 UTC Daily</span>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 space-y-1">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Strict High-Water Mark Integrity:</span>
            </div>
            <p>
              Performance fees are levied <strong>only on net new gains</strong> that surpass the historic High-Water Mark. Losses in previous periods must be fully recouped before any fee becomes payable.
            </p>
          </div>

          {/* Settlements Table */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Settlement Records & Invoices
            </h4>

            <div className="border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/80 bg-slate-950/40">
              {settlements.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No previous settlement periods recorded yet.
                </div>
              ) : (
                settlements.map((s) => (
                  <div key={s.id} className="p-4 hover:bg-slate-800/30 transition space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-white">{s.id}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                          {s.status}
                        </span>
                      </div>
                      <span className="text-xs font-mono text-slate-400">
                        Invoice: <span className="text-emerald-400">{s.invoiceId}</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-2 pt-1 text-[11px] font-mono">
                      <div className="bg-slate-900 p-2 rounded-lg">
                        <span className="text-slate-500 block text-[10px]">Realized Profit</span>
                        <span className="text-emerald-400 font-bold">+${s.realizedProfit.toFixed(2)}</span>
                      </div>
                      <div className="bg-slate-900 p-2 rounded-lg">
                        <span className="text-slate-500 block text-[10px]">Previous HWM</span>
                        <span className="text-slate-300">${s.previousHwm.toFixed(2)}</span>
                      </div>
                      <div className="bg-slate-900 p-2 rounded-lg">
                        <span className="text-slate-500 block text-[10px]">New HWM</span>
                        <span className="text-slate-200 font-bold">${s.newHwm.toFixed(2)}</span>
                      </div>
                      <div className="bg-slate-900 p-2 rounded-lg">
                        <span className="text-slate-500 block text-[10px]">{s.profitSharePct || 50}% Fee Settled</span>
                        <span className="text-amber-400 font-bold">-${s.feeAmount.toFixed(2)} USDT</span>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-500 flex justify-between pt-1">
                      <span>Period: {new Date(s.periodStart).toLocaleDateString()} to {new Date(s.periodEnd).toLocaleDateString()}</span>
                      <span>Settled: {new Date(s.settledAt).toUTCString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
