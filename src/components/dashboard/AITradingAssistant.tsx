import React, { useState, useRef, useEffect } from 'react';
import { ArrowUpRight, ArrowDownRight, Zap } from 'lucide-react';

export type ConsoleState = 'SEARCHING' | 'TRADE' | 'NO_TRADE' | 'UNAVAILABLE';

export interface MasterTrade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  openedAt: string | null;
}

export interface AITradingAssistantProps {
  state: ConsoleState;
  trades: MasterTrade[];
  className?: string;
}

/**
 * The robot card. The animation is decorative; every word and figure shown comes from the
 * master account's real open positions. No confidence figure is shown because none exists.
 */
export const AITradingAssistant: React.FC<AITradingAssistantProps> = ({ state, trades, className = '' }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    setIsHovered(true);
    setShowTooltip(true);
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    tooltipTimeoutRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, 3200);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setShowTooltip(false);
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
  };

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    };
  }, []);

  const first = trades[0];
  const isSignal = state === 'TRADE' && !!first;
  const isAnalyzing = state === 'SEARCHING';
  const signal = isSignal ? first.side : null;
  const statusLabel =
    state === 'TRADE' ? 'TRADE FOUND' : state === 'NO_TRADE' ? 'NO ACTIVE TRADE' : state === 'UNAVAILABLE' ? 'DATA UNAVAILABLE' : 'SEARCHING';
  const symbol = first?.symbol || '';
  const task =
    state === 'TRADE'
      ? `${trades.length} open on the master account`
      : state === 'NO_TRADE'
      ? 'No active trade found'
      : state === 'UNAVAILABLE'
      ? 'Live trade data could not be read'
      : 'Searching…';

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm backdrop-blur-md relative overflow-hidden flex flex-col sm:flex-row items-center gap-4 select-none transition-all duration-300 hover:scale-[1.015] hover:border-cyan-500/50 hover:shadow-xl hover:shadow-cyan-950/20 ${className}`}
      role="region"
      aria-label="Castimo AI Trading Assistant"
    >
      {/* Background Subtle Cyan / Amber Holographic Aura */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
          isSignal
            ? 'bg-radial from-amber-500/10 via-transparent to-transparent opacity-100'
            : isAnalyzing
            ? 'bg-radial from-cyan-500/10 via-transparent to-transparent opacity-80'
            : 'bg-radial from-blue-500/5 via-transparent to-transparent opacity-50'
        }`}
      />

      {/* 1. COMPACT ROBOT / AI CORE VISUAL (Left/Top) */}
      <div className="relative shrink-0 flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-inner overflow-visible">
        {/* 'Live Analysis' Tooltip Overlay near the robot's head */}
        {showTooltip && (
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-30 pointer-events-none animate-in fade-in zoom-in-95 duration-200">
            <div className="px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-cyan-500 shadow-lg text-[9px] font-mono font-bold text-cyan-800 dark:text-cyan-300 flex items-center gap-1 whitespace-nowrap backdrop-blur-md">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              <span>Live Analysis</span>
            </div>
            {/* Caret pointing down */}
            <div className="w-1.5 h-1.5 bg-white dark:bg-slate-900 border-r border-b border-cyan-500 rotate-45 mx-auto -mt-0.5" />
          </div>
        )}

        {/* Subtle Background Radar Sweep Ring (Accelerates on Hover) */}
        <div className="absolute inset-1 rounded-full border border-slate-200 dark:border-slate-800/50 pointer-events-none" />
        <div
          className={`absolute w-20 h-20 rounded-full border border-dashed pointer-events-none transition-colors duration-500 ${
            isSignal ? 'border-amber-400/50' : 'border-cyan-500/40'
          }`}
          style={{
            animation: isHovered ? 'spin 4s linear infinite' : 'spin 18s linear infinite',
            transition: 'animation-duration 0.3s ease',
          }}
        />

        {/* Minimalist Cybernetic Robot Head & Torso SVG */}
        <div className="relative z-10 w-20 h-20 animate-assistant-head">
          <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md" fill="none">
            <defs>
              <linearGradient id="astArmor" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="60%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#64748b" />
              </linearGradient>
              <linearGradient id="astDark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1e293b" />
                <stop offset="100%" stopColor="#0f172a" />
              </linearGradient>
              <radialGradient id="astCoreGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="70%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
              </radialGradient>
              <filter id="astCyanGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Torso Silhouette & Collar */}
            <path
              d="M 28 85 L 72 85 L 68 98 L 32 98 Z"
              fill="url(#astDark)"
              stroke="#334155"
              strokeWidth="1.5"
            />
            {/* Shoulder Pauldrons */}
            <path d="M 22 88 L 35 84 L 33 98 L 18 98 Z" fill="url(#astArmor)" />
            <path d="M 78 88 L 65 84 L 67 98 L 82 98 Z" fill="url(#astArmor)" />

            {/* Pulsing Chest / Core Light */}
            <circle
              cx="50"
              cy="90"
              r="4.5"
              fill="url(#astCoreGlow)"
              filter="url(#astCyanGlow)"
              className="animate-assistant-core"
            />

            {/* Neck Hydraulics */}
            <rect x="45" y="70" width="10" height="15" rx="2" fill="#334155" />
            <line x1="42" y1="76" x2="45" y2="80" stroke="#64748b" strokeWidth="1.5" />
            <line x1="58" y1="76" x2="55" y2="80" stroke="#64748b" strokeWidth="1.5" />

            {/* Cybernetic Humanoid Head Shell */}
            <path
              d="M 32 40 C 32 20, 68 20, 68 40 C 68 62, 58 72, 50 72 C 42 72, 32 62, 32 40 Z"
              fill="url(#astArmor)"
              stroke="#94a3b8"
              strokeWidth="1.5"
            />
            {/* Specular White Highlight */}
            <path d="M 38 28 C 44 24, 56 24, 62 28" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.85" />

            {/* Side Ear Acoustic Nodes */}
            <rect x="29" y="36" width="4" height="12" rx="1.5" fill="#475569" />
            <circle cx="31" cy="42" r="1.5" fill="#06b6d4" />
            <rect x="67" y="36" width="4" height="12" rx="1.5" fill="#475569" />
            <circle cx="69" cy="42" r="1.5" fill="#06b6d4" />

            {/* Glowing Cybernetic Visor & Optical Sensor */}
            <rect x="36" y="35" width="28" height="14" rx="4" fill="#090d16" stroke="#1e293b" strokeWidth="1.5" />

            {/* Moving Laser Scan Line inside Visor */}
            <g className="animate-assistant-visor">
              <rect
                x="47"
                y="38"
                width="6"
                height="8"
                rx="1.5"
                fill={isSignal ? '#f59e0b' : '#38bdf8'}
                filter="url(#astCyanGlow)"
              />
              <line
                x1="38"
                y1="42"
                x2="62"
                y2="42"
                stroke={isSignal ? '#f59e0b' : '#06b6d4'}
                strokeWidth="1"
                opacity="0.8"
              />
            </g>

            {/* Lower Chin Chassis */}
            <path d="M 43 64 L 57 64 L 54 70 L 46 70 Z" fill="#64748b" />
          </svg>
        </div>

        {/* Live Status Pip */}
        <div className="absolute top-1.5 right-1.5 flex items-center justify-center">
          <span
            className={`w-2 h-2 rounded-full ${
              isSignal
                ? 'bg-amber-400 animate-ping'
                : isAnalyzing
                ? 'bg-cyan-400 animate-pulse'
                : 'bg-emerald-400'
            }`}
          />
        </div>
      </div>

      {/* 2. COMPACT AI MARKET STATUS & STATE MACHINE (Right/Bottom) */}
      <div className="flex-1 w-full min-w-0 space-y-2 font-mono text-xs">
        {/* Header Strip: Title + Dynamic State Badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black uppercase text-slate-900 dark:text-white tracking-wider flex items-center gap-1.5">
              <span>CASTIMO AI</span>
              <span className="text-slate-500 dark:text-slate-400 font-normal hidden sm:inline">| Assistant</span>
            </span>
          </div>

          {/* Cycling State Readout Badge */}
          <span
            className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1 border transition-colors ${
              isSignal
                ? 'bg-amber-50 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-500/40 animate-pulse'
                : isAnalyzing
                ? 'bg-cyan-50 dark:bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/30'
                : 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isSignal ? 'bg-amber-500' : isAnalyzing ? 'bg-cyan-500' : 'bg-emerald-500'
              }`}
            />
            <span>{statusLabel}</span>
          </span>
        </div>

        {/* Middle Line: Active Ticker & Task */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-bold text-slate-900 dark:text-white text-xs shrink-0">
              {symbol}
            </span>
            <span className="text-slate-600 dark:text-slate-300 truncate text-[11px]">
              {task}
            </span>
          </div>

          {/* Trade found (replaces the old confidence figure) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isSignal && signal ? (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-black border ${
                  signal === 'BUY'
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border-rose-500/40'
                }`}
              >
                {signal === 'BUY' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                <span>TRADE FOUND {signal}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <Zap className="w-3 h-3" />
                <span>{state === 'UNAVAILABLE' ? 'Unavailable' : state === 'NO_TRADE' ? 'No trade' : '…'}</span>
              </span>
            )}
          </div>
        </div>

        {isSignal && (
          <ul className="space-y-1 pt-0.5">
            {trades.map((t) => (
              <li key={t.id} className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                <span className={t.side === 'SELL' ? 'font-bold text-rose-500' : 'font-bold text-emerald-500'}>{t.side}</span>
                <span>{t.symbol}</span>
                <span className="text-slate-500">{t.volume} lot @ {t.openPrice}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
