import React from 'react';
import { Volume2, VolumeX, Cpu, Activity, Zap, CheckCircle2, Shield } from 'lucide-react';
import { AiRobotState } from '../../services/aiRobotState';

interface AiStatusPanelProps {
  state: AiRobotState;
  onToggleSound: () => void;
  className?: string;
}

export const AiStatusPanel: React.FC<AiStatusPanelProps> = ({
  state,
  onToggleSound,
  className = '',
}) => {
  return (
    <div
      className={`rounded-2xl bg-slate-900/95 border border-slate-800 p-4 sm:p-5 shadow-xl flex flex-col justify-between backdrop-blur-md ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-black tracking-wider uppercase text-white font-mono flex items-center gap-1.5">
              <span>CASTIMO AI</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </h3>
            <span className="text-[10px] text-emerald-400 font-mono font-semibold">● ONLINE</span>
          </div>
        </div>

        {/* Mute / Unmute Audio Toggle (Muted by default) */}
        <button
          type="button"
          onClick={onToggleSound}
          className={`p-1.5 rounded-lg border text-xs transition cursor-pointer flex items-center gap-1 ${
            state.soundEnabled
              ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400'
              : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
          }`}
          title={state.soundEnabled ? 'Mute AI Audio Telemetry' : 'Unmute AI Audio Telemetry (Synthesized)'}
          aria-label={state.soundEnabled ? 'Mute audio' : 'Unmute audio'}
        >
          {state.soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span className="text-[9px] font-mono hidden sm:inline">
            {state.soundEnabled ? 'AUDIO ON' : 'MUTED'}
          </span>
        </button>
      </div>

      {/* Main Status Metrics Body */}
      <div className="py-3.5 space-y-3 font-mono text-xs">
        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 text-[11px] uppercase">STATUS</span>
          <span className="text-cyan-400 font-bold flex items-center gap-1">
            <Activity className="w-3.5 h-3.5 animate-pulse" />
            <span>Scanning Markets...</span>
          </span>
        </div>

        {/* Current Task */}
        <div>
          <span className="text-slate-500 text-[10px] uppercase block mb-1">CURRENT TASK</span>
          <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] text-slate-200 font-semibold truncate flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping shrink-0" />
            <span className="truncate">{state.currentTask}</span>
          </div>
        </div>

        {/* Market & Timeframe */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <span className="text-slate-500 text-[9px] uppercase block">TARGET MARKET</span>
            <span className="text-white font-bold text-xs">{state.currentMarket}</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <span className="text-slate-500 text-[9px] uppercase block">TIMEFRAME</span>
            <span className="text-cyan-300 font-bold text-xs">{state.timeframe}</span>
          </div>
        </div>

        {/* Processing Progress Bar */}
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-slate-500 uppercase">PROCESSING</span>
            <span className="text-cyan-400 font-bold">{state.progress}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400 transition-all duration-300 ease-out"
              style={{ width: `${state.progress}%` }}
            />
          </div>
        </div>

        {/* Signal Confidence */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/70 border border-slate-800">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400 text-[11px] uppercase">SIGNAL CONFIDENCE</span>
          </div>
          <span className="text-amber-400 font-black text-sm">{state.confidence}%</span>
        </div>
      </div>

      {/* Footer System Status */}
      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500">
        <span className="flex items-center gap-1">
          <Shield className="w-3 h-3 text-emerald-400" />
          <span>SYSTEM STATUS:</span>
        </span>
        <span className="text-emerald-400 font-bold flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          <span>ONLINE • OPTIMAL</span>
        </span>
      </div>
    </div>
  );
};
