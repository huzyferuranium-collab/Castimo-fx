import React, { useState } from 'react';
import { BarChart2, Activity } from 'lucide-react';

interface MarketOverviewChartProps {
  selectedSymbol?: string;
  price?: number;
  changePct?: number;
  onSelectSymbol?: (symbol: string) => void;
  className?: string;
}

type Timeframe = 'M1' | 'M5' | 'M15' | 'H1' | 'H4' | 'D1';

export const MarketOverviewChart: React.FC<MarketOverviewChartProps> = ({
  selectedSymbol = 'XAU/USD',
  price = 2651.8,
  changePct = +0.65,
  onSelectSymbol,
  className = '',
}) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('M15');

  const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1'];
  const SYMBOLS = ['XAU/USD'];

  // High-precision candlestick series for Gold (XAU/USD)
  const candles = [
    { o: 2642.5, h: 2646.2, l: 2641.8, c: 2645.8, isUp: true },
    { o: 2645.8, h: 2649.5, l: 2644.2, c: 2648.4, isUp: true },
    { o: 2648.4, h: 2649.2, l: 2646.0, c: 2647.2, isUp: false },
    { o: 2647.2, h: 2652.1, l: 2646.8, c: 2651.5, isUp: true },
    { o: 2651.5, h: 2654.0, l: 2649.8, c: 2653.2, isUp: true },
    { o: 2653.2, h: 2654.8, l: 2651.0, c: 2652.1, isUp: false },
    { o: 2652.1, h: 2656.5, l: 2651.4, c: 2655.8, isUp: true },
    { o: 2655.8, h: 2659.2, l: 2654.5, c: 2658.0, isUp: true },
    { o: 2658.0, h: 2659.8, l: 2656.2, c: 2657.4, isUp: false },
    { o: 2657.4, h: 2662.5, l: 2656.8, c: 2661.0, isUp: true },
    { o: 2661.0, h: 2663.5, l: 2660.1, c: 2662.8, isUp: true },
    { o: 2662.8, h: 2664.0, l: 2659.5, c: 2651.8, isUp: false },
  ];

  const minVal = 2640;
  const maxVal = 2665;
  const range = maxVal - minVal;

  const getY = (val: number) => 170 - ((val - minVal) / range) * 140;

  return (
    <div
      className={`rounded-md bg-[#090D16] border border-white/5 p-2.5 sm:p-3 shadow-sm flex flex-col justify-between select-none ${className}`}
    >
      {/* Header Bar */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2">
          {/* Symbol & Price Metrics */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 font-mono">
              <span className="text-xs sm:text-sm font-bold text-white tracking-wide">XAU/USD</span>
              <span className="text-xs font-semibold text-slate-200">
                {price.toFixed(2)}
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.2 rounded-xs ${
                  changePct >= 0 ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
                }`}
              >
                {changePct >= 0 ? '+' : ''}
                {changePct.toFixed(2)}%
              </span>
            </div>

            {/* Dedicated Pair Badge */}
            <div className="flex items-center gap-1">
              <span className="px-1.5 py-0.5 text-[9px] font-mono rounded-xs bg-slate-800 text-cyan-300 font-bold border border-white/5">
                XAU/USD
              </span>
            </div>
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded-xs border border-white/5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-1.5 py-0.5 text-[9px] font-mono font-semibold rounded-xs transition cursor-pointer ${
                  timeframe === tf
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Minimalist Primary Chart Canvas */}
        <div className="relative mt-2.5 h-[180px] sm:h-[210px] w-full bg-slate-950/60 rounded-xs border border-white/5 p-1.5 overflow-hidden">
          {/* Subtle Grid Lines (5% opacity) */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none p-2 opacity-30">
            <div className="border-b border-slate-800/60 w-full" />
            <div className="border-b border-slate-800/60 w-full" />
            <div className="border-b border-slate-800/60 w-full" />
            <div className="border-b border-slate-800/60 w-full" />
          </div>

          <svg viewBox="0 0 480 180" className="w-full h-full" preserveAspectRatio="none">
            {/* Candlesticks */}
            {candles.map((c, i) => {
              const x = 25 + i * 37;
              const yHigh = getY(c.h);
              const yLow = getY(c.l);
              const yOpen = getY(c.o);
              const yClose = getY(c.c);
              const yBody = Math.min(yOpen, yClose);
              const heightBody = Math.max(2.5, Math.abs(yClose - yOpen));
              const color = c.isUp ? '#10b981' : '#f43f5e';

              return (
                <g key={i}>
                  <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1" opacity="0.8" />
                  <rect
                    x={x - 5}
                    y={yBody}
                    width="10"
                    height={heightBody}
                    rx="1"
                    fill={color}
                    opacity="0.9"
                  />
                </g>
              );
            })}

            {/* EMA 20 Overlay */}
            <path
              d="M 25 140 Q 120 115 200 95 T 360 60 T 450 48"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.5"
              strokeDasharray="3 2"
              opacity="0.85"
            />

            {/* Current Price Dashed Guide */}
            <line x1="0" y1="50" x2="480" y2="50" stroke="#06b6d4" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.6" />
          </svg>

          {/* Micro Price Pill on Right Edge */}
          <div className="absolute right-1.5 top-11 px-1.5 py-0.2 rounded-xs bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 font-mono text-[9px] font-bold">
            {price.toFixed(4)}
          </div>
        </div>
      </div>

      {/* Micro Status Footer */}
      <div className="mt-2 pt-1.5 border-t border-white/5 text-[10px] font-mono text-slate-500 flex items-center justify-between">
        <span className="flex items-center gap-1">
          <Activity className="w-3 h-3 text-cyan-400" />
          <span>EMA(20) • LIQUIDITY SWEEP</span>
        </span>
        <span>{timeframe} INTERVAL • REAL-TIME FEED</span>
      </div>
    </div>
  );
};
