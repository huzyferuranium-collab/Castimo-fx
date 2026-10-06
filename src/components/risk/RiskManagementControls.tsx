import React, { useState, useEffect } from 'react';
import { tradingEngine } from '../../services/tradingEngine';
import { RiskSettings, Mt5Account } from '../../types';
import {
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Gauge,
  Percent,
  TrendingDown,
  Layers,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Info,
  DollarSign,
  Zap,
} from 'lucide-react';

interface RiskManagementControlsProps {
  account: Mt5Account;
  className?: string;
  onSettingsSaved?: (settings: RiskSettings) => void;
}

export const RiskManagementControls: React.FC<RiskManagementControlsProps> = ({
  account,
  className = '',
  onSettingsSaved,
}) => {
  const [currentSettings, setCurrentSettings] = useState<RiskSettings>(
    tradingEngine.getRiskSettings()
  );

  // Form State
  const [lotMultiplier, setLotMultiplier] = useState<number>(
    currentSettings.lotSizeMultiplier || 1.0
  );
  const [maxDrawdownPct, setMaxDrawdownPct] = useState<number>(
    currentSettings.maxDrawdownPercent || 15
  );
  const [maxDailyLoss, setMaxDailyLoss] = useState<number>(
    currentSettings.maxDailyLossUsd || 500
  );
  const [maxOpenPositions, setMaxOpenPositions] = useState<number>(
    currentSettings.maxOpenPositions || 5
  );
  const [autoCloseOnBreach, setAutoCloseOnBreach] = useState<boolean>(
    currentSettings.autoCloseOnDrawdown ?? true
  );
  const [copySl, setCopySl] = useState<boolean>(currentSettings.copyStopLoss ?? true);
  const [copyTp, setCopyTp] = useState<boolean>(currentSettings.copyTakeProfit ?? true);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    const unsub = tradingEngine.subscribe(() => {
      const live = tradingEngine.getRiskSettings();
      setCurrentSettings(live);
    });
    return () => unsub();
  }, []);

  // Compute calculated drawdown in dollar value based on current account equity
  const calculatedDrawdownUsd = (account.equity * (maxDrawdownPct / 100)).toFixed(2);
  const safetyBufferAboveFloor = Math.max(0, account.equity - 200).toFixed(2);

  // Apply Predefined Risk Profiles
  const applyPreset = (preset: 'conservative' | 'balanced' | 'aggressive') => {
    if (preset === 'conservative') {
      setLotMultiplier(0.5);
      setMaxDrawdownPct(10);
      setMaxDailyLoss(300);
      setMaxOpenPositions(3);
      setAutoCloseOnBreach(true);
    } else if (preset === 'balanced') {
      setLotMultiplier(1.0);
      setMaxDrawdownPct(15);
      setMaxDailyLoss(500);
      setMaxOpenPositions(5);
      setAutoCloseOnBreach(true);
    } else if (preset === 'aggressive') {
      setLotMultiplier(1.5);
      setMaxDrawdownPct(25);
      setMaxDailyLoss(800);
      setMaxOpenPositions(7);
      setAutoCloseOnBreach(false);
    }
  };

  const handleSave = (e?: React.FormEvent) => {
    e?.preventDefault();
    setIsSaving(true);

    const updated: Partial<RiskSettings> = {
      lotSizeMultiplier: parseFloat(lotMultiplier.toFixed(2)),
      maxDrawdownPercent: maxDrawdownPct,
      maxDrawdownLimitUsd: parseFloat(calculatedDrawdownUsd),
      maxDailyLossUsd: maxDailyLoss,
      maxOpenPositions: maxOpenPositions,
      autoCloseOnDrawdown: autoCloseOnBreach,
      copyStopLoss: copySl,
      copyTakeProfit: copyTp,
    };

    setTimeout(() => {
      const saved = tradingEngine.updateClientRiskSettings(updated);
      setCurrentSettings(saved);
      setIsSaving(false);
      setSaveSuccess(true);
      if (onSettingsSaved) onSettingsSaved(saved);
      setTimeout(() => setSaveSuccess(false), 3000);
    }, 350);
  };

  const handleResetDefaults = () => {
    applyPreset('balanced');
  };

  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden text-slate-100 ${className}`}>
      {/* Header */}
      <div className="p-5 border-b border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm sm:text-base text-white">
                Client Risk Management Controls
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Live Guard Active
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Customize trade replication volume, drawdown stop triggers, and protection thresholds.
            </p>
          </div>
        </div>

        {/* Quick Profile Presets */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <span className="text-[10px] text-slate-500 font-bold px-2 uppercase">Presets:</span>
          <button
            type="button"
            onClick={() => applyPreset('conservative')}
            className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
              lotMultiplier === 0.5 && maxDrawdownPct === 10
                ? 'bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            Conservative
          </button>
          <button
            type="button"
            onClick={() => applyPreset('balanced')}
            className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
              lotMultiplier === 1.0 && maxDrawdownPct === 15
                ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            Balanced
          </button>
          <button
            type="button"
            onClick={() => applyPreset('aggressive')}
            className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
              lotMultiplier === 1.5 && maxDrawdownPct === 25
                ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            Aggressive
          </button>
        </div>
      </div>

      {/* Safety Floor Gauge Banner */}
      <div className="p-4 bg-slate-950/60 border-b border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-900 border border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
            <Gauge className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Current Equity</span>
            <span className="text-sm font-black text-white font-mono">${account.equity.toFixed(2)} USD</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-900 border border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Safety Floor Margin</span>
            <span className="text-sm font-black text-emerald-400 font-mono">+${safetyBufferAboveFloor} USD</span>
            <span className="text-[10px] text-slate-500 block">Above $200 mandatory stop</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-900 border border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
            <TrendingDown className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Computed Drawdown Stop</span>
            <span className="text-sm font-black text-amber-400 font-mono">-${calculatedDrawdownUsd} USD</span>
            <span className="text-[10px] text-slate-500 block">({maxDrawdownPct}% of total equity)</span>
          </div>
        </div>
      </div>

      {/* Main Parameters Configuration Form */}
      <form onSubmit={handleSave} className="p-5 sm:p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Parameter 1: Lot Size Multiplier */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>Lot Size Multiplier</span>
                  <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                    {lotMultiplier.toFixed(1)}x
                  </span>
                </label>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Scales the lot volume copied from the institutional master account.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={lotMultiplier}
                onChange={(e) => setLotMultiplier(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>0.1x (Fractional)</span>
                <span>1.0x (1:1 Equal)</span>
                <span>3.0x (Aggressive)</span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 flex items-center justify-between">
              <span className="text-slate-400">Replication Simulation:</span>
              <span className="font-mono text-emerald-400 font-bold">
                1.00 Lot Master → {(1.0 * lotMultiplier).toFixed(2)} Lots Client
              </span>
            </div>
          </div>

          {/* Parameter 2: Max Drawdown Limit */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>Max Drawdown Limit</span>
                  <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                    {maxDrawdownPct}% (~${calculatedDrawdownUsd})
                  </span>
                </label>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Maximum permitted floating unrealized loss before defensive action triggers.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <input
                type="range"
                min="5"
                max="35"
                step="1"
                value={maxDrawdownPct}
                onChange={(e) => setMaxDrawdownPct(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>5% (Strict)</span>
                <span>15% (Standard)</span>
                <span>35% (High Tolerance)</span>
              </div>
            </div>

            {/* Auto Close on Breach Toggle */}
            <div className="flex items-center justify-between pt-1">
              <div>
                <span className="text-xs font-semibold text-slate-200">Auto-Close Open Trades</span>
                <p className="text-[10px] text-slate-500">
                  Instantly close active positions if drawdown ceiling is breached.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoCloseOnBreach}
                  onChange={(e) => setAutoCloseOnBreach(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>
          </div>

          {/* Parameter 3: Max Daily Loss Threshold */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
            <div>
              <label className="text-xs font-bold text-white flex items-center justify-between">
                <span>Max Daily Loss Limit (USD)</span>
                <span className="font-mono text-emerald-400 font-bold">${maxDailyLoss}</span>
              </label>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Stops replication for the remainder of the trading day if net daily loss is reached.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="number"
                min="100"
                max="2500"
                step="50"
                value={maxDailyLoss}
                onChange={(e) => setMaxDailyLoss(Math.max(100, parseInt(e.target.value) || 100))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
              />
              <span className="text-xs text-slate-400 font-mono">USD</span>
            </div>
          </div>

          {/* Parameter 4: Maximum Open Positions */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
            <div>
              <label className="text-xs font-bold text-white flex items-center justify-between">
                <span>Max Concurrent Open Trades</span>
                <span className="font-mono text-blue-400 font-bold">{maxOpenPositions} Orders</span>
              </label>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Caps the total number of simultaneous copied orders on your terminal.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {[2, 3, 5, 7, 10].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setMaxOpenPositions(num)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-bold transition cursor-pointer ${
                    maxOpenPositions === num
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Protection Invariant Notice */}
        <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-200 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold text-purple-300">Platform Mandatory Invariant: </span>
            The <code className="bg-purple-950/60 px-1 py-0.2 rounded font-mono text-purple-200">$200.00 USD</code> minimum equity floor is enforced at the bridge level. If account equity breaches $200.00, copying automatically suspends to ensure complete capital protection regardless of custom parameters.
          </div>
        </div>

        {/* Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>Reset Defaults</span>
          </button>

          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Risk settings applied to MT5 bridge!</span>
              </span>
            )}

            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 font-bold text-xs text-slate-950 shadow-lg shadow-emerald-500/20 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Applying to Bridge...' : 'Save Risk Parameters'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
