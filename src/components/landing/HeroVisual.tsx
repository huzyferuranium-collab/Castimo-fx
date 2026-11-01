import React, { useId } from 'react';
import { Server, Sparkles, Wallet, Zap } from 'lucide-react';

/**
 * The landing hero's glass visual, in two arrangements built from the same pieces:
 *
 *  - HeroVisual: the right-hand canvas of the two-column hero (tablet and desktop).
 *  - HeroPhone: one glass panel for phones. The copy sits on top, the chart is drawn behind it and the
 *    three cards float over the chart, so the phone shows the same picture as the desktop.
 *
 *  - The candlesticks are artwork only: no prices, no axes, no trend. Violet and gold candles are just the
 *    brand colours, and the canvas says "Illustration".
 *  - The cards state facts about the service (the two plans and custody). They carry no performance
 *    figures, user counts or earnings, because none of those are available to show truthfully here.
 *  - Self-contained: the styles live in the <style> tag under the `hv-` prefix. Dark is the default look;
 *    `html.light` gets the bright variant. Both use the brand violet and gold.
 *  - Nothing moves on its own except a one-time rise of the candles; cards lift on hover. Only the three
 *    cards use backdrop-filter, and the canvas is clipped so they blur the canvas, never the page behind.
 */

// A smooth, trend-free wave, so the picture reads as decoration rather than as performance.
const N = 26;
const wave = (i: number) => 256 + 36 * Math.sin(i * 0.52 + 0.4) + 20 * Math.sin(i * 1.37 + 1.1) + 9 * Math.sin(i * 2.9);
const CANDLES = Array.from({ length: N }, (_, i) => {
  const open = wave(i);
  const close = wave(i + 1);
  const top = Math.min(open, close);
  const bottom = Math.max(open, close);
  return {
    x: 30 + i * 19.6,
    top,
    h: Math.max(6, bottom - top),
    wickTop: top - (6 + ((i * 7) % 11)),
    wickBottom: bottom + (6 + ((i * 5) % 9)),
    up: close < open,
    vol: 8 + ((i * 13) % 22),
  };
});

const CSS = `
.hv-shell { position: relative; border-radius: 1.75rem; box-shadow: 0 30px 70px -30px rgba(139,92,246,.45), 0 0 0 1px rgba(139,92,246,.22); }
.hv-canvas {
  position: relative; border-radius: inherit; isolation: isolate;
  clip-path: inset(0 round 1.75rem);
  background:
    radial-gradient(60% 55% at 88% 8%, rgba(139,92,246,.30), transparent 70%),
    radial-gradient(55% 50% at 6% 96%, rgba(245,158,11,.20), transparent 70%),
    linear-gradient(160deg, rgba(14,14,20,.78), rgba(6,6,10,.9));
}
.hv-bar { position: absolute; left: 0; right: 0; top: 0; height: 40px; z-index: 2; display: flex; align-items: center; gap: 6px; padding: 0 18px; }
.hv-dot { width: 9px; height: 9px; border-radius: 9999px; }
.hv-note { margin-left: auto; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: rgba(248,250,252,.42); }
.hv-grid { stroke: rgba(248,250,252,.07); }
.hv-chart { -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%); mask-image: linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%); }
/* phone: the chart runs behind the words and fades out above and below */
.hv-behind { pointer-events: none; -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 24%, #000 78%, transparent 100%); mask-image: linear-gradient(180deg, transparent 0, #000 24%, #000 78%, transparent 100%); }

.hv-card {
  position: absolute; z-index: 3; color: #f8fafc; border-radius: 1.1rem; padding: 12px 14px;
  background: rgba(10, 10, 16, .5);
  border: 1px solid rgba(139,92,246,.38);
  box-shadow: 0 18px 36px -18px rgba(0,0,0,.85), 0 0 24px rgba(139,92,246,.16), inset 0 1px 0 rgba(255,255,255,.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.25);
          backdrop-filter: blur(12px) saturate(1.25);
}
/* phone: the cards sit in the normal flow (so nothing can overlap when text wraps on a narrow screen) */
.hv-card.hv-flow { position: relative; }
.hv-card:hover {
  border-color: rgba(245,158,11,.6);
  box-shadow: 0 26px 44px -18px rgba(0,0,0,.9), 0 0 34px rgba(245,158,11,.22), inset 0 1px 0 rgba(255,255,255,.16);
}
.hv-tag { display: inline-flex; align-items: center; gap: 5px; font-size: 9.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #fbbf24; }
.hv-big { font-weight: 800; letter-spacing: -.02em; line-height: 1; }
.hv-glow { background-image: linear-gradient(180deg, #fff 10%, #fbbf24 120%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; filter: drop-shadow(0 0 14px rgba(245,158,11,.45)); }
.hv-sub { font-size: 11px; line-height: 1.3; color: rgba(248,250,252,.62); }
.hv-ring-track { stroke: rgba(248,250,252,.14); }
.hv-chip { width: 26px; height: 26px; border-radius: 9999px; display: grid; place-items: center; border: 2px solid rgba(10,10,16,.9); color: #fff; }

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .hv-card { background: rgba(10, 10, 16, .82); }
}

/* ---- light theme ---- */
html.light .hv-shell { box-shadow: 0 30px 70px -34px rgba(107,33,168,.4), 0 0 0 1px rgba(203,213,225,.8); }
html.light .hv-canvas {
  background:
    radial-gradient(60% 55% at 88% 8%, rgba(139,92,246,.2), transparent 70%),
    radial-gradient(55% 50% at 6% 96%, rgba(245,158,11,.18), transparent 70%),
    linear-gradient(160deg, rgba(255,255,255,.9), rgba(241,245,249,.8));
}
html.light .hv-note { color: rgba(15,23,42,.45); }
html.light .hv-grid { stroke: rgba(15,23,42,.08); }
html.light .hv-card {
  color: #0f172a; background: rgba(255,255,255,.72); border-color: rgba(226,232,240,.9);
  box-shadow: 0 18px 36px -20px rgba(76,29,149,.4), 0 0 0 1px rgba(255,255,255,.6) inset;
}
html.light .hv-card:hover { border-color: rgba(217,119,6,.55); box-shadow: 0 26px 44px -20px rgba(76,29,149,.5), 0 0 28px rgba(245,158,11,.2); }
html.light .hv-tag { color: #b45309; }
html.light .hv-glow { background-image: linear-gradient(180deg, #6b21a8 0%, #d97706 130%); filter: none; }
html.light .hv-sub { color: rgba(15,23,42,.62); }
html.light .hv-ring-track { stroke: rgba(15,23,42,.1); }
html.light .hv-chip { border-color: rgba(255,255,255,.95); }

@keyframes hv-rise { from { transform: scaleY(.2); opacity: 0; } to { transform: scaleY(1); opacity: 1; } }
.hv-candle { transform-box: fill-box; transform-origin: center bottom; animation: hv-rise .7s cubic-bezier(.2,.8,.2,1) both; }
@media (prefers-reduced-motion: reduce) {
  .hv-candle { animation: none; }
  .hv-card { transition: none; }
}
`;

/** The abstract candlesticks (decoration only). `shift` moves the whole band up or down. */
const HeroChart: React.FC<{ className?: string; shift?: number }> = ({ className = '', shift = 0 }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg viewBox="0 0 560 440" preserveAspectRatio="xMidYMid slice" className={`hv-chart ${className}`} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}up`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c4b5fd" /><stop offset="1" stopColor="#7c3aed" /></linearGradient>
        <linearGradient id={`${id}down`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fcd34d" /><stop offset="1" stopColor="#d97706" /></linearGradient>
      </defs>
      {[130, 190, 250, 310, 370].map((gy) => (
        <line key={gy} className="hv-grid" x1="14" x2="546" y1={gy} y2={gy} strokeDasharray="2 7" />
      ))}
      <g transform={`translate(0 ${shift})`}>
        {CANDLES.map((c, i) => (
          <g key={i} className="hv-candle" style={{ animationDelay: `${i * 28}ms` }}>
            <rect x={c.x - 7} y={c.top - 2} width="14" height={c.h + 4} rx="4" fill={c.up ? '#8b5cf6' : '#f59e0b'} fillOpacity=".16" />
            <line x1={c.x} x2={c.x} y1={c.wickTop} y2={c.wickBottom} stroke={c.up ? '#a78bfa' : '#fbbf24'} strokeWidth="1.6" strokeLinecap="round" strokeOpacity=".9" />
            <rect x={c.x - 4.5} y={c.top} width="9" height={c.h} rx="2.4" fill={`url(#${id}${c.up ? 'up' : 'down'})`} />
          </g>
        ))}
      </g>
      {CANDLES.map((c, i) => (
        <rect key={`v${i}`} x={c.x - 3.5} y={426 - c.vol} width="7" height={c.vol} rx="2" fill={c.up ? '#8b5cf6' : '#f59e0b'} fillOpacity=".28" />
      ))}
    </svg>
  );
};

const lift = 'transition-all duration-300 hover:-translate-y-1';

const ProfitCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`hv-card ${lift} ${className}`}>
    <div className="hv-tag"><Sparkles className="w-3 h-3" /> Profit share</div>
    <div className="flex items-baseline gap-1.5 mt-2">
      <span className="hv-big hv-glow text-[1.9rem] sm:text-[2.2rem]">$0</span>
      <span className="hv-sub">upfront</span>
    </div>
    <div className="hv-sub mt-1">You pay 50% of new profit only.</div>
  </div>
);

const MonthlyCard: React.FC<{ className?: string }> = ({ className = '' }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <div className={`hv-card ${lift} flex items-center gap-2.5 sm:gap-3 ${className}`}>
      <div className="relative shrink-0 w-[50px] h-[50px] sm:w-[66px] sm:h-[66px]">
        <svg viewBox="0 0 80 80" className="w-full h-full" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}ring`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#f59e0b" /></linearGradient>
          </defs>
          <circle cx="40" cy="40" r="32" fill="none" className="hv-ring-track" strokeWidth="7" strokeLinecap="round" pathLength={1} strokeDasharray=".75 1" transform="rotate(135 40 40)" />
          <circle cx="40" cy="40" r="32" fill="none" stroke={`url(#${id}ring)`} strokeWidth="7" strokeLinecap="round" pathLength={1} strokeDasharray=".75 1" transform="rotate(135 40 40)" />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <span className="hv-big text-[12px] sm:text-[15px]">$100</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="hv-tag">Monthly</div>
        <div className="hv-sub mt-1">Flat, every 30 days.</div>
      </div>
    </div>
  );
};

const FundsCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`hv-card ${lift} flex items-center gap-3 ${className}`}>
    <div className="flex shrink-0 pl-1" aria-hidden="true">
      <span className="hv-chip" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6b21a8)' }}><Server className="w-3.5 h-3.5" /></span>
      <span className="hv-chip -ml-2" style={{ background: 'linear-gradient(135deg,#fbbf24,#d97706)' }}><Zap className="w-3.5 h-3.5" /></span>
      <span className="hv-chip -ml-2" style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)' }}><Wallet className="w-3.5 h-3.5" /></span>
    </div>
    <div className="min-w-0">
      <div className="text-[12.5px] font-bold leading-tight">Your funds, your broker</div>
      <div className="hv-sub mt-0.5">We never hold client deposits.</div>
    </div>
  </div>
);

/** Tablet and desktop: the canvas that sits beside (or under) the copy. */
export const HeroVisual: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`hv ${className}`}>
    <style>{CSS}</style>
    <div className="hv-shell">
      <div className="hv-canvas h-[360px] sm:h-[420px] lg:h-[440px]" role="group" aria-label="CASTIMOFx at a glance">
        <div className="hv-bar" aria-hidden="true">
          <span className="hv-dot" style={{ background: '#8b5cf6' }} />
          <span className="hv-dot" style={{ background: '#f59e0b' }} />
          <span className="hv-dot" style={{ background: 'rgba(148,163,184,.5)' }} />
          <span className="hv-note">Illustration</span>
        </div>
        <HeroChart className="absolute inset-0 w-full h-full" />
        <ProfitCard className="left-3 top-12 sm:left-5 sm:top-14 w-[10.2rem] sm:w-[12rem]" />
        <MonthlyCard className="right-3 top-[8.4rem] sm:right-5 sm:top-[9.2rem] w-[9.4rem] sm:w-[10.6rem]" />
        <FundsCard className="right-3 bottom-3 sm:right-5 sm:bottom-5 w-[14.6rem] sm:w-[16.4rem]" />
      </div>
    </div>
  </div>
);

/**
 * Phones: one glass panel. `children` is the copy (headline and a short line) and `actions` the buttons.
 * The chart runs behind the words and fades out above and below; the cards float over it.
 */
export const HeroPhone: React.FC<{ children: React.ReactNode; actions: React.ReactNode }> = ({ children, actions }) => (
  <div className="hv">
    <style>{CSS}</style>
    <div className="hv-shell">
      <div className="hv-canvas px-5 pt-6 pb-5" role="group" aria-label="CASTIMOFx at a glance">
        <div className="relative z-10 space-y-3">{children}</div>

        <div className="relative z-10 mt-3 min-h-[292px] flex flex-col justify-between gap-2">
          <div className="hv-behind absolute -inset-x-5 -top-28 -bottom-14" aria-hidden="true">
            <HeroChart className="w-full h-full" shift={-20} />
          </div>
          <ProfitCard className="hv-flow self-start w-[10.4rem] min-[400px]:w-[11.4rem] max-w-[66%]" />
          <MonthlyCard className="hv-flow self-end w-[10.3rem] min-[400px]:w-[11.2rem] max-w-[66%] -mt-3" />
          <FundsCard className="hv-flow" />
        </div>

        <div className="relative z-10 mt-4 flex flex-col gap-2.5">{actions}</div>
      </div>
    </div>
  </div>
);
