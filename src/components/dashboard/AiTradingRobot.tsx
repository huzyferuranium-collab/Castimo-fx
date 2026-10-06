import React, { useState, useEffect, useRef } from 'react';
import { CopiedTrade } from '../../types';

interface AiTradingRobotProps {
  openTrades?: CopiedTrade[];
  className?: string;
}

type SimulationVisualState = 'SCANNING' | 'DETECTED' | 'MONITORING';

export const AiTradingRobot: React.FC<AiTradingRobotProps> = ({
  openTrades = [],
  className = '',
}) => {
  const [visualState, setVisualState] = useState<SimulationVisualState>('SCANNING');
  const [detectedSymbol, setDetectedSymbol] = useState<string>('');
  const [detectedDirection, setDetectedDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [isHovered, setIsHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track real application signals vs simulated scanning loops
  const hasActiveSignals = openTrades.length > 0;
  const activeTrade = hasActiveSignals ? openTrades[0] : null;

  useEffect(() => {
    if (hasActiveSignals && activeTrade) {
      setVisualState('MONITORING');
      setDetectedSymbol(activeTrade.symbol);
      setDetectedDirection(activeTrade.direction);
      return;
    }

    // When there are no real active signals, run the scanning cycle with occasional candidate detection
    let isMounted = true;
    let timer: NodeJS.Timeout;

    const runScanCycle = () => {
      if (!isMounted) return;
      setVisualState('SCANNING');

      // Every 8-12 seconds, simulate a brief candidate detection that lasts 2.5s before resuming scanning
      timer = setTimeout(() => {
        if (!isMounted) return;
        const candidateSymbols = ['XAUUSD'];
        const randomSym = 'XAUUSD';
        const randomDir = Math.random() > 0.5 ? 'BUY' : 'SELL';

        setDetectedSymbol(randomSym);
        setDetectedDirection(randomDir);
        setVisualState('DETECTED');

        // After 2.6s, return to continuous scanning
        timer = setTimeout(() => {
          if (!isMounted) return;
          runScanCycle();
        }, 2600);
      }, 7500);
    };

    runScanCycle();

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [hasActiveSignals, activeTrade]);

  // Handle hover interactions: scale up, faster radar, and temporary 'Live Analysis' tooltip
  const handleMouseEnter = () => {
    setIsHovered(true);
    setShowTooltip(true);

    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }
    // Temporary overlay: auto-dismisses after 3.2s of continuous hover or on mouse leave
    tooltipTimeoutRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, 3200);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setShowTooltip(false);
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }
  };

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative w-full max-w-[360px] h-[260px] rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl overflow-hidden flex flex-col justify-between p-3.5 select-none transition-all duration-300 ease-out cursor-pointer hover:scale-[1.025] hover:shadow-2xl hover:border-slate-700/90 hover:bg-slate-900 ${className}`}
      role="region"
      aria-label="AI Trading Robot Signal Scanner"
    >
      {/* Background Holographic Glow & Radial Aura */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
          visualState === 'DETECTED'
            ? 'bg-radial from-amber-500/15 via-transparent to-transparent opacity-100'
            : visualState === 'MONITORING'
            ? 'bg-radial from-emerald-500/15 via-transparent to-transparent opacity-100'
            : isHovered
            ? 'bg-radial from-cyan-500/15 via-transparent to-transparent opacity-95'
            : 'bg-radial from-cyan-500/10 via-transparent to-transparent opacity-80'
        }`}
      />

      {/* Subtle Digital Grid Ground Plane */}
      <div className="absolute -bottom-6 left-0 right-0 h-24 opacity-25 pointer-events-none [mask-image:linear-gradient(to_bottom,transparent,black)]">
        <div
          className="w-full h-full"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(56, 189, 248, 0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(56, 189, 248, 0.2) 1px, transparent 1px)',
            backgroundSize: '16px 16px',
            transform: 'perspective(140px) rotateX(55deg)',
          }}
        />
      </div>

      {/* TOP HEADER: Minimal Status Indicator */}
      <div className="relative z-10 flex items-center justify-between gap-2 border-b border-slate-800/60 pb-2">
        <div className="flex items-center gap-2">
          {/* Status Dot */}
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                visualState === 'DETECTED'
                  ? 'bg-amber-400'
                  : visualState === 'MONITORING'
                  ? 'bg-emerald-400'
                  : 'bg-cyan-400'
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                visualState === 'DETECTED'
                  ? 'bg-amber-400'
                  : visualState === 'MONITORING'
                  ? 'bg-emerald-400'
                  : 'bg-cyan-400'
              }`}
            />
          </span>

          {/* Status Label (Clean & Concise) */}
          <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider uppercase font-bold">
            {visualState === 'SCANNING' && (
              <span className="text-cyan-400 flex items-center gap-1">
                <span>SCANNING FOR SIGNALS</span>
                <span className="inline-flex gap-0.5 ml-0.5">
                  <span className="animate-pulse delay-75">.</span>
                  <span className="animate-pulse delay-150">.</span>
                  <span className="animate-pulse delay-300">.</span>
                </span>
              </span>
            )}

            {visualState === 'DETECTED' && (
              <span className="text-amber-400 animate-pulse">SIGNAL DETECTED</span>
            )}

            {visualState === 'MONITORING' && (
              <span className="text-emerald-400">MONITORING SIGNAL</span>
            )}
          </div>
        </div>

        {/* Small Active Signal Pill */}
        {detectedSymbol && (visualState === 'DETECTED' || visualState === 'MONITORING') && (
          <span
            className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border transition-all ${
              detectedDirection === 'BUY'
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
            }`}
          >
            {detectedSymbol} {detectedDirection}
          </span>
        )}
      </div>

      {/* CENTER ARENA: Compact Robot & Holographic Radar Environment */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        {/* Holographic Radar Concentric Rings */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {/* Inner ring */}
          <div
            className={`w-28 h-28 rounded-full border transition-colors duration-300 ${
              isHovered ? 'border-cyan-500/40' : 'border-slate-800/80'
            }`}
          />
          {/* Mid ring */}
          <div
            className={`w-40 h-40 rounded-full border transition-colors duration-300 ${
              isHovered ? 'border-cyan-500/25' : 'border-slate-800/50'
            }`}
          />
          {/* Outer ring */}
          <div className="w-52 h-52 rounded-full border border-slate-800/30" />

          {/* Rotating Radar Sweep Cone - Speeds up dynamically on hover */}
          <div
            className="absolute w-44 h-44 rounded-full overflow-hidden pointer-events-none animate-radar-sweep"
            style={{
              animationDuration: isHovered ? '1.5s' : '5s',
              transition: 'animation-duration 0.3s ease',
            }}
          >
            <div
              className={`w-full h-full transition-opacity duration-300 ${
                visualState === 'DETECTED'
                  ? 'bg-gradient-to-tr from-transparent via-transparent to-amber-500/25'
                  : visualState === 'MONITORING'
                  ? 'bg-gradient-to-tr from-transparent via-transparent to-emerald-500/25'
                  : isHovered
                  ? 'bg-gradient-to-tr from-transparent via-transparent to-cyan-400/30'
                  : 'bg-gradient-to-tr from-transparent via-transparent to-cyan-500/20'
              }`}
              style={{
                clipPath: 'polygon(50% 50%, 100% 0, 100% 50%)',
              }}
            />
          </div>
        </div>

        {/* Floating Candlestick Chart Elements (Simulated Market Analysis) */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Left Mini Candlestick Pair */}
          <div className="absolute left-3 top-8 flex items-end gap-1 opacity-70 animate-candle-drift">
            <div className="flex flex-col items-center">
              <span className="w-px h-2 bg-emerald-400/60" />
              <span className="w-1.5 h-4 rounded-xs bg-emerald-400/80" />
              <span className="w-px h-1.5 bg-emerald-400/60" />
            </div>
            <div className="flex flex-col items-center">
              <span className="w-px h-1.5 bg-rose-400/60" />
              <span className="w-1.5 h-3 rounded-xs bg-rose-400/80" />
              <span className="w-px h-2 bg-rose-400/60" />
            </div>
          </div>

          {/* Right Mini Candlestick Breakout */}
          <div
            className="absolute right-4 bottom-7 flex items-end gap-1 opacity-70 animate-candle-drift"
            style={{ animationDelay: '1.5s' }}
          >
            <div className="flex flex-col items-center">
              <span className="w-px h-1.5 bg-emerald-400/60" />
              <span className="w-1.5 h-5 rounded-xs bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
              <span className="w-px h-2 bg-emerald-400/60" />
            </div>
            <div className="flex flex-col items-center">
              <span className="w-px h-2 bg-cyan-400/60" />
              <span className="w-1.5 h-3.5 rounded-xs bg-cyan-400/80" />
              <span className="w-px h-1 bg-cyan-400/60" />
            </div>
          </div>

          {/* Floating Data Nodes / Coordinates */}
          <div className="absolute left-6 bottom-4 text-[8px] font-mono text-cyan-400/50 tracking-tighter">
            2,651.80
          </div>
          <div className="absolute right-5 top-5 text-[8px] font-mono text-emerald-400/50 tracking-tighter">
            1.0858
          </div>
        </div>

        {/* Lock-on Beacon / Signal Target when Detected or Monitoring */}
        {(visualState === 'DETECTED' || visualState === 'MONITORING') && (
          <div className="absolute right-8 top-10 flex items-center justify-center animate-beacon-pulse">
            <span
              className={`w-3.5 h-3.5 rounded-full border ${
                visualState === 'DETECTED'
                  ? 'border-amber-400 bg-amber-400/20 shadow-[0_0_12px_#f59e0b]'
                  : 'border-emerald-400 bg-emerald-400/20 shadow-[0_0_12px_#10b981]'
              }`}
            />
            <span
              className={`absolute w-6 h-6 rounded-full border border-dashed animate-spin ${
                visualState === 'DETECTED' ? 'border-amber-400/60' : 'border-emerald-400/60'
              }`}
              style={{ animationDuration: '6s' }}
            />
            {/* Energy connector beam to robot */}
            <div
              className={`absolute -left-10 top-3 h-px w-10 origin-right transition-opacity duration-300 ${
                visualState === 'DETECTED'
                  ? 'bg-gradient-to-r from-amber-400/80 to-transparent'
                  : 'bg-gradient-to-r from-emerald-400/80 to-transparent'
              }`}
              style={{ transform: 'rotate(-25deg)' }}
            />
          </div>
        )}

        {/* THE COMPACT FLOATING FUTURISTIC ROBOT */}
        <div className="relative z-10 animate-robot-float flex flex-col items-center">
          {/* Temporary 'Live Analysis' Tooltip Overlay near the robot's head */}
          {showTooltip && (
            <div className="absolute -top-7 z-30 pointer-events-none animate-in fade-in zoom-in-95 duration-200">
              <div className="relative px-2.5 py-0.5 rounded-full bg-slate-950/95 border border-cyan-500/60 shadow-lg shadow-cyan-950/70 backdrop-blur-md flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                <span className="font-mono text-[9px] font-bold tracking-wider text-cyan-300 uppercase">
                  Live Analysis
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                {/* Downward Caret Arrow */}
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-slate-950 border-r border-b border-cyan-500/60 rotate-45" />
              </div>
            </div>
          )}

          {/* Subtle Ambient Glow Behind Head */}
          <div
            className={`absolute -inset-2 rounded-full blur-md opacity-50 transition-colors duration-500 ${
              visualState === 'DETECTED'
                ? 'bg-amber-400/30'
                : visualState === 'MONITORING'
                ? 'bg-emerald-400/30'
                : isHovered
                ? 'bg-cyan-400/35'
                : 'bg-cyan-400/20'
            }`}
          />

          {/* Futuristic Robotic Head */}
          <div className="relative w-20 h-16 rounded-xl bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 border border-slate-700/80 shadow-2xl flex flex-col items-center justify-center p-1.5">
            {/* Top Head Sensor Plate */}
            <div className="absolute -top-1.5 w-6 h-1 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center">
              <span
                className={`w-1.5 h-0.5 rounded-full transition-colors duration-300 ${
                  visualState === 'DETECTED'
                    ? 'bg-amber-400 animate-pulse'
                    : visualState === 'MONITORING'
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-cyan-400'
                }`}
              />
            </div>

            {/* Cybernetic Visor Display */}
            <div className="relative w-15 h-7 rounded-lg bg-slate-950 border border-slate-800/90 flex items-center justify-center overflow-hidden shadow-inner">
              {/* Reflective Visor Glare Curve */}
              <div className="absolute -top-3 left-1 right-1 h-3 rounded-full bg-white/10 blur-xs pointer-events-none" />

              {/* Glowing Cybernetic Eyes (Smooth Left-Right Scanning Animation) */}
              <div className="flex items-center gap-2.5 z-10 animate-robot-eyes">
                <span
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    visualState === 'DETECTED'
                      ? 'bg-amber-300 scale-125 shadow-[0_0_10px_#f59e0b]'
                      : visualState === 'MONITORING'
                      ? 'bg-emerald-300 scale-110 shadow-[0_0_10px_#10b981]'
                      : isHovered
                      ? 'bg-cyan-300 scale-110 shadow-[0_0_10px_#22d3ee]'
                      : 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]'
                  }`}
                />
                <span
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    visualState === 'DETECTED'
                      ? 'bg-amber-300 scale-125 shadow-[0_0_10px_#f59e0b]'
                      : visualState === 'MONITORING'
                      ? 'bg-emerald-300 scale-110 shadow-[0_0_10px_#10b981]'
                      : isHovered
                      ? 'bg-cyan-300 scale-110 shadow-[0_0_10px_#22d3ee]'
                      : 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]'
                  }`}
                />
              </div>

              {/* Subtle Horizontal Scanning Laser Streak */}
              <div
                className={`absolute top-0 bottom-0 w-1 opacity-70 blur-xs transition-colors duration-300 ${
                  visualState === 'DETECTED'
                    ? 'bg-amber-400'
                    : visualState === 'MONITORING'
                    ? 'bg-emerald-400'
                    : 'bg-cyan-400'
                }`}
                style={{
                  animation: isHovered
                    ? 'robot-eyes-scan 1.4s ease-in-out infinite alternate'
                    : 'robot-eyes-scan 2.8s ease-in-out infinite alternate',
                }}
              />
            </div>

            {/* Lower Chassis: Mini Neural Core */}
            <div className="mt-1.5 flex items-center gap-1">
              <span
                className={`w-1 h-1 rounded-full transition-colors duration-300 ${
                  visualState === 'DETECTED'
                    ? 'bg-amber-400'
                    : visualState === 'MONITORING'
                    ? 'bg-emerald-400'
                    : 'bg-cyan-400/80'
                }`}
              />
              <span className="text-[7px] font-mono tracking-wider text-slate-500 uppercase font-semibold">
                NEURAL CORE
              </span>
              <span
                className={`w-1 h-1 rounded-full transition-colors duration-300 ${
                  visualState === 'DETECTED'
                    ? 'bg-amber-400'
                    : visualState === 'MONITORING'
                    ? 'bg-emerald-400'
                    : 'bg-cyan-400/80'
                }`}
              />
            </div>
          </div>

          {/* Cybernetic Neck / Magnetic Floating Ring */}
          <div className="w-10 h-1.5 rounded-full bg-slate-800/80 border border-slate-700/60 mt-1 shadow-sm" />
        </div>
      </div>

      {/* BOTTOM FOOTER: Compact Data Stream Strip */}
      <div className="relative z-10 border-t border-slate-800/60 pt-1.5 flex items-center justify-between text-[9px] font-mono text-slate-500">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-xs transition-colors duration-300 ${
              isHovered ? 'bg-cyan-400' : 'bg-slate-700'
            } inline-block`}
          />
          <span>RADAR: {isHovered ? 'ACCELERATED SCAN' : '360° FREQ SCAN'}</span>
        </div>

        <div className="flex items-center gap-1 text-slate-400">
          <span>AI BRIDGE</span>
          <span className="text-emerald-400 font-bold">ONLINE</span>
        </div>
      </div>
    </div>
  );
};
