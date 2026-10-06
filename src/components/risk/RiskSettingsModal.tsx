import React, { useState } from 'react';
import { RiskSettings } from '../../types';
import { tradingEngine } from '../../services/tradingEngine';
import { Sliders, ShieldAlert, CheckCircle2, AlertTriangle, Lock } from 'lucide-react';

interface RiskSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSettings: RiskSettings;
  adminActor: string;
}

export const RiskSettingsModal: React.FC<RiskSettingsModalProps> = ({
  isOpen,
  onClose,
  currentSettings,
  adminActor,
}) => {
  const [minEquity, setMinEquity] = useState(currentSettings.minEquityToTrade.toString());
  const [maxLotSize, setMaxLotSize] = useState(currentSettings.maxLotSize.toString());
  const [maxOpenPositions, setMaxOpenPositions] = useState(
    currentSettings.maxOpenPositions.toString()
  );
  const [maxDailyLoss, setMaxDailyLoss] = useState(currentSettings.maxDailyLossUsd.toString());
  const [maxDrawdown, setMaxDrawdown] = useState(currentSettings.maxDrawdownPercent.toString());
  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    tradingEngine.updateRiskSettings(
      {
        minEquityToTrade: parseFloat(minEquity) || 200,
        maxLotSize: parseFloat(maxLotSize) || 2.0,
        maxOpenPositions: parseInt(maxOpenPositions) || 5,
        maxDailyLossUsd: parseFloat(maxDailyLoss) || 500,
        maxDrawdownPercent: parseFloat(maxDrawdown) || 15,
      },
      adminActor
    );

    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-gradient-to-r from-red-600/20 via-slate-900 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Risk Management Controls</h3>
              <p className="text-xs text-slate-400">Section 9: Core Capital Protection Parameters</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[11px] text-red-200 space-y-1">
            <div className="font-bold text-xs flex items-center gap-1.5 text-red-300">
              <ShieldAlert className="w-4 h-4 text-red-400" />
              <span>Strict Rule Enforcement:</span>
            </div>
            <p>
              New trade copying is immediately blocked when client equity falls below the minimum threshold (default <strong>$200.00</strong>). If open trades exist below this floor, withdrawals are locked completely.
            </p>
          </div>

          {saved && (
            <div className="p-3 text-xs rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Risk configuration updated & audit log recorded.</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Minimum Equity to Allow Trade Copying ($ USD)
            </label>
            <input
              type="number"
              step="10"
              required
              min="100"
              value={minEquity}
              onChange={(e) => setMinEquity(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-700 rounded-xl focus:border-red-500 text-white"
            />
            <span className="text-[10px] text-slate-500 mt-0.5 block">
              Default $200.00. Mandatory safety stop.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Max Copied Lot Size
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={maxLotSize}
                onChange={(e) => setMaxLotSize(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-700 rounded-xl focus:border-red-500 text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Max Open Positions
              </label>
              <input
                type="number"
                required
                value={maxOpenPositions}
                onChange={(e) => setMaxOpenPositions(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-700 rounded-xl focus:border-red-500 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Max Daily Loss Floor ($)
              </label>
              <input
                type="number"
                step="25"
                required
                value={maxDailyLoss}
                onChange={(e) => setMaxDailyLoss(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-700 rounded-xl focus:border-red-500 text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Max Drawdown (%)
              </label>
              <input
                type="number"
                step="1"
                required
                value={maxDrawdown}
                onChange={(e) => setMaxDrawdown(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-700 rounded-xl focus:border-red-500 text-white"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 font-semibold text-xs text-white shadow-md shadow-red-600/30 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Apply & Enforce Risk Parameters</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
