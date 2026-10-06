import React from 'react';
import { RobotState } from '../../services/aiRobotState';

interface HumanoidAiRobotProps {
  state: RobotState;
  currentMarket: string;
  confidence: number;
  direction?: 'BUY' | 'SELL';
  className?: string;
}

export const HumanoidAiRobot: React.FC<HumanoidAiRobotProps> = ({
  state,
  currentMarket,
  confidence,
  direction = 'BUY',
  className = '',
}) => {
  const isSignal = state === 'SIGNAL_DETECTED' || state === 'CONFIRMING';
  const isAnalyzing = state === 'ANALYZING';

  return (
    <div
      className={`relative w-full h-[360px] sm:h-[400px] flex items-center justify-center select-none overflow-hidden ${className}`}
      role="img"
      aria-label={`Castimo Humanoid AI Trading Robot - Status: ${state}`}
    >
      {/* 1. Deep Space Cybernetic Atmosphere Glow */}
      <div
        className={`absolute inset-0 pointer-events-none transition-all duration-700 ${
          isSignal
            ? 'bg-radial from-cyan-500/20 via-blue-900/10 to-transparent'
            : isAnalyzing
            ? 'bg-radial from-cyan-400/15 via-slate-900/20 to-transparent'
            : 'bg-radial from-blue-500/10 via-transparent to-transparent'
        }`}
      />

      {/* 2. 3D Perspective Digital Cyber Grid Floor */}
      <div className="absolute -bottom-8 left-0 right-0 h-32 opacity-30 pointer-events-none [mask-image:linear-gradient(to_bottom,transparent,black)]">
        <div
          className="w-full h-full"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(56, 189, 248, 0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(56, 189, 248, 0.25) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            transform: 'perspective(220px) rotateX(62deg)',
          }}
        />
      </div>

      {/* 3. Concentric Holographic Radar & Scanner Rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className={`rounded-full border transition-all duration-700 ${
            isSignal
              ? 'w-72 h-72 border-cyan-400/50 shadow-[0_0_30px_rgba(6,182,212,0.3)]'
              : 'w-64 h-64 border-cyan-500/25'
          }`}
        />
        <div className="absolute w-80 h-80 rounded-full border border-dashed border-slate-700/40 animate-spin" style={{ animationDuration: '35s' }} />
        <div className="absolute w-96 h-96 rounded-full border border-slate-800/30" />
      </div>

      {/* 4. THE HUMANOID CYBERNETIC AI ROBOT (Master SVG Architecture) */}
      <div className="relative z-10 w-[280px] sm:w-[320px] h-[340px] flex items-center justify-center">
        <svg
          viewBox="0 0 340 380"
          className="w-full h-full drop-shadow-[0_12px_24px_rgba(0,0,0,0.8)]"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Gradients for Titanium / White Metallic Armor Plate */}
            <linearGradient id="armorWhite" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="50%" stopColor="#e2e8f0" />
              <stop offset="100%" stopColor="#cbd5e1" />
            </linearGradient>

            <linearGradient id="armorChrome" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="40%" stopColor="#94a3b8" />
              <stop offset="100%" stopColor="#475569" />
            </linearGradient>

            <linearGradient id="carbonDark" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1e293b" />
              <stop offset="100%" stopColor="#0f172a" />
            </linearGradient>

            <linearGradient id="cyanNeon" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="50%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>

            <radialGradient id="reactorGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="1" />
              <stop offset="60%" stopColor="#06b6d4" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
            </radialGradient>

            <filter id="cyanGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* ========================================================
              ROBOT TORSO & CORE (Center Base)
              ======================================================== */}
          <g id="torso-group" className="transition-all duration-300">
            {/* Dark Graphite Carbon-Fiber Inner Chassis */}
            <path
              d="M 120 180 L 220 180 L 210 310 L 130 310 Z"
              fill="url(#carbonDark)"
              stroke="#334155"
              strokeWidth="2"
            />

            {/* Spine & Hydraulic Articulation Conduits */}
            <rect x="164" y="180" width="12" height="120" rx="3" fill="#475569" />
            <line x1="156" y1="210" x2="184" y2="210" stroke="#64748b" strokeWidth="2" />
            <line x1="156" y1="235" x2="184" y2="235" stroke="#64748b" strokeWidth="2" />
            <line x1="156" y1="260" x2="184" y2="260" stroke="#64748b" strokeWidth="2" />

            {/* Left & Right Sculpted White Breastplates */}
            <path
              d="M 115 175 L 165 175 L 165 240 L 125 250 L 110 215 Z"
              fill="url(#armorWhite)"
              stroke="#94a3b8"
              strokeWidth="1.5"
            />
            <path
              d="M 225 175 L 175 175 L 175 240 L 215 250 L 230 215 Z"
              fill="url(#armorWhite)"
              stroke="#94a3b8"
              strokeWidth="1.5"
            />

            {/* Specular Highlights on White Armor */}
            <path d="M 120 180 L 155 180 L 155 195 L 120 200 Z" fill="#ffffff" opacity="0.6" />
            <path d="M 220 180 L 185 180 L 185 195 L 220 200 Z" fill="#ffffff" opacity="0.6" />

            {/* Cybernetic Neural Core / Arc Reactor (Pulsing Cyan Heart) */}
            <g id="neural-core" transform="translate(170, 215)">
              <circle r="22" fill="#0f172a" stroke="#334155" strokeWidth="2" />
              <circle r="18" fill="url(#reactorGlow)" filter="url(#cyanGlow)" />
              <circle
                r="15"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="2"
                strokeDasharray="4 2"
                className="animate-spin"
                style={{ animationDuration: '8s' }}
              />
              <circle r="8" fill="#ffffff" filter="url(#cyanGlow)" />
            </g>

            {/* Lower Abdominal Titanium Plating */}
            <path
              d="M 130 258 L 210 258 L 200 300 L 140 300 Z"
              fill="url(#armorChrome)"
              stroke="#64748b"
              strokeWidth="1.5"
            />
            <line x1="140" y1="278" x2="200" y2="278" stroke="#06b6d4" strokeWidth="1" opacity="0.8" />
          </g>

          {/* ========================================================
              LEFT MECHANICAL ARM & ARTICULATED HAND (Interacting Left)
              ======================================================== */}
          <g id="left-arm" className="animate-humanoid-left-hand">
            {/* Shoulder Ball Joint */}
            <circle cx="100" cy="180" r="16" fill="url(#armorChrome)" stroke="#64748b" strokeWidth="2" />
            <circle cx="100" cy="180" r="8" fill="#0f172a" />
            <circle cx="100" cy="180" r="3" fill="#06b6d4" />

            {/* Upper Arm Bicep Chassis */}
            <path
              d="M 92 195 L 108 195 L 102 245 L 88 245 Z"
              fill="url(#armorWhite)"
              stroke="#94a3b8"
              strokeWidth="1.5"
            />

            {/* Elbow Joint */}
            <circle cx="95" cy="250" r="10" fill="url(#armorChrome)" stroke="#475569" strokeWidth="1.5" />

            {/* Forearm (Raised toward holographic workspace) */}
            <path
              d="M 90 258 L 102 255 L 75 305 L 62 298 Z"
              fill="url(#armorWhite)"
              stroke="#94a3b8"
              strokeWidth="1.5"
            />
            {/* Hydraulic Piston Rod */}
            <line x1="88" y1="262" x2="72" y2="295" stroke="#06b6d4" strokeWidth="2" />

            {/* Wrist Rotary Pivot */}
            <circle cx="68" cy="305" r="7" fill="url(#armorChrome)" />

            {/* Articulated Fingers (Typing / Scrolling in air) */}
            {/* Thumb */}
            <line x1="68" y1="305" x2="60" y2="315" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
            <line x1="60" y1="315" x2="52" y2="320" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
            {/* Index Finger */}
            <line x1="66" y1="309" x2="62" y2="325" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
            <line x1="62" y1="325" x2="58" y2="336" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
            <circle cx="58" cy="336" r="2" fill="#06b6d4" />
            {/* Middle Finger */}
            <line x1="70" y1="310" x2="72" y2="328" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
            <line x1="72" y1="328" x2="72" y2="340" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
            {/* Ring & Pinky */}
            <line x1="74" y1="308" x2="80" y2="324" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" />
          </g>

          {/* ========================================================
              RIGHT MECHANICAL ARM & ARTICULATED HAND (Interacting Right)
              ======================================================== */}
          <g id="right-arm" className="animate-humanoid-right-hand">
            {/* Shoulder Ball Joint */}
            <circle cx="240" cy="180" r="16" fill="url(#armorChrome)" stroke="#64748b" strokeWidth="2" />
            <circle cx="240" cy="180" r="8" fill="#0f172a" />
            <circle cx="240" cy="180" r="3" fill="#06b6d4" />

            {/* Upper Arm */}
            <path
              d="M 232 195 L 248 195 L 252 245 L 238 245 Z"
              fill="url(#armorWhite)"
              stroke="#94a3b8"
              strokeWidth="1.5"
            />

            {/* Elbow Joint */}
            <circle cx="245" cy="250" r="10" fill="url(#armorChrome)" stroke="#475569" strokeWidth="1.5" />

            {/* Forearm (Reaching toward right market chart) */}
            <path
              d="M 250 258 L 238 255 L 265 305 L 278 298 Z"
              fill="url(#armorWhite)"
              stroke="#94a3b8"
              strokeWidth="1.5"
            />
            {/* Hydraulic Piston Rod */}
            <line x1="252" y1="262" x2="268" y2="295" stroke="#06b6d4" strokeWidth="2" />

            {/* Wrist Rotary Pivot */}
            <circle cx="272" cy="305" r="7" fill="url(#armorChrome)" />

            {/* Fingers Interacting with Hologram */}
            {/* Thumb */}
            <line x1="272" y1="305" x2="280" y2="315" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
            <line x1="280" y1="315" x2="288" y2="320" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
            {/* Index Finger Tapping */}
            <line x1="274" y1="309" x2="278" y2="325" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
            <line x1="278" y1="325" x2="282" y2="336" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
            <circle cx="282" cy="336" r="2" fill="#06b6d4" />
            {/* Middle Finger */}
            <line x1="270" y1="310" x2="268" y2="328" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
            <line x1="268" y1="328" x2="268" y2="340" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
          </g>

          {/* ========================================================
              CERVICAL NECK ARTICULATION
              ======================================================== */}
          <g id="neck-group">
            <rect x="160" y="145" width="20" height="35" rx="4" fill="url(#carbonDark)" stroke="#475569" strokeWidth="1.5" />
            <line x1="152" y1="155" x2="160" y2="165" stroke="#64748b" strokeWidth="3" strokeLinecap="round" />
            <line x1="188" y1="155" x2="180" y2="165" stroke="#64748b" strokeWidth="3" strokeLinecap="round" />
            <circle cx="170" cy="155" r="4" fill="#06b6d4" opacity="0.8" />
          </g>

          {/* ========================================================
              SOPHISTICATED CYBERNETIC HEAD (Pans Left/Right)
              ======================================================== */}
          <g id="humanoid-head" className="animate-humanoid-head">
            {/* Outer Head Armor Shell (Sculpted Titanium White) */}
            <path
              d="M 125 100 C 125 50, 215 50, 215 100 C 215 135, 195 155, 170 155 C 145 155, 125 135, 125 100 Z"
              fill="url(#armorWhite)"
              stroke="#94a3b8"
              strokeWidth="2"
            />

            {/* Specular Chrome Highlight on Cranium */}
            <path
              d="M 140 68 C 150 58, 190 58, 200 68 C 190 62, 150 62, 140 68 Z"
              fill="#ffffff"
              opacity="0.85"
            />

            {/* Temporal Lateral Seam Lines */}
            <path d="M 130 95 Q 145 105 145 130" stroke="#94a3b8" strokeWidth="1.5" fill="none" />
            <path d="M 210 95 Q 195 105 195 130" stroke="#94a3b8" strokeWidth="1.5" fill="none" />

            {/* Ear Acoustic Sensor Pods with Cyan LED Accents */}
            <rect x="120" y="90" width="8" height="24" rx="3" fill="url(#armorChrome)" stroke="#475569" strokeWidth="1.5" />
            <circle cx="124" cy="102" r="2" fill="#06b6d4" />
            <rect x="212" y="90" width="8" height="24" rx="3" fill="url(#armorChrome)" stroke="#475569" strokeWidth="1.5" />
            <circle cx="216" cy="102" r="2" fill="#06b6d4" />

            {/* Sculpted Lower Jaw & Chin Plate */}
            <path
              d="M 150 140 L 190 140 L 180 154 L 160 154 Z"
              fill="url(#armorChrome)"
              stroke="#64748b"
              strokeWidth="1.5"
            />

            {/* CYBERNETIC VISOR & OPTICAL SENSOR (Dark Curved Glass + Neon Cyan Scanner) */}
            <g id="visor-optic">
              <rect x="135" y="85" width="70" height="26" rx="6" fill="#090d16" stroke="#1e293b" strokeWidth="2" />
              {/* Visor Glare Accent */}
              <path d="M 138 88 L 202 88 L 198 94 L 142 94 Z" fill="#ffffff" opacity="0.15" />

              {/* Glowing Cyan Optical Scanner Aperture (Sweeps across) */}
              <g className="animate-humanoid-optic">
                <rect x="162" y="93" width="16" height="10" rx="3" fill="url(#cyanNeon)" filter="url(#cyanGlow)" />
                <circle cx="170" cy="98" r="3" fill="#ffffff" />
                {/* Horizontal Laser Sweep Streak */}
                <line x1="140" y1="98" x2="200" y2="98" stroke="#38bdf8" strokeWidth="1" opacity="0.6" />
              </g>
            </g>
          </g>

          {/* ========================================================
              FLOATING HOLOGRAPHIC CANDLESTICK CHART & MARKET DATA
              (Positioned Directly in Front of Robot's Hands)
              ======================================================== */}
          <g id="hologram-chart" transform="translate(70, 240)" className="pointer-events-none">
            {/* Holographic Projection Glass Background */}
            <rect
              x="0"
              y="0"
              width="200"
              height="100"
              rx="10"
              fill="rgba(8, 14, 26, 0.75)"
              stroke={isSignal ? '#06b6d4' : '#334155'}
              strokeWidth={isSignal ? 2 : 1}
              strokeDasharray={isSignal ? 'none' : '4 2'}
              className="backdrop-blur-xs transition-all duration-500"
            />

            {/* Holographic Header Bar */}
            <rect x="0" y="0" width="200" height="18" rx="10" fill="rgba(6, 182, 212, 0.15)" />
            <text x="10" y="13" fill="#38bdf8" fontSize="9" fontFamily="monospace" fontWeight="bold">
              CASTIMO AI // {currentMarket}
            </text>
            <text x="150" y="13" fill="#10b981" fontSize="9" fontFamily="monospace" fontWeight="bold">
              {direction}
            </text>

            {/* Grid Lines inside Hologram */}
            <line x1="10" y1="40" x2="190" y2="40" stroke="rgba(56, 189, 248, 0.15)" strokeWidth="1" />
            <line x1="10" y1="65" x2="190" y2="65" stroke="rgba(56, 189, 248, 0.15)" strokeWidth="1" />

            {/* Glowing Candlesticks */}
            {/* Candle 1 (Green) */}
            <line x1="30" y1="30" x2="30" y2="70" stroke="#10b981" strokeWidth="1.5" />
            <rect x="26" y="38" width="8" height="22" rx="1" fill="#10b981" />
            {/* Candle 2 (Red) */}
            <line x1="55" y1="35" x2="55" y2="75" stroke="#f43f5e" strokeWidth="1.5" />
            <rect x="51" y="45" width="8" height="18" rx="1" fill="#f43f5e" />
            {/* Candle 3 (Green) */}
            <line x1="80" y1="28" x2="80" y2="65" stroke="#10b981" strokeWidth="1.5" />
            <rect x="76" y="32" width="8" height="24" rx="1" fill="#10b981" />
            {/* Candle 4 (Green Breakout) */}
            <line x1="105" y1="22" x2="105" y2="60" stroke="#10b981" strokeWidth="1.5" />
            <rect x="101" y="26" width="8" height="28" rx="1" fill="#10b981" filter="url(#cyanGlow)" />
            {/* Candle 5 (Current Volatile Setup) */}
            <line x1="130" y1="20" x2="130" y2="58" stroke="#38bdf8" strokeWidth="1.5" />
            <rect x="126" y="24" width="8" height="24" rx="1" fill="#38bdf8" />

            {/* Trend Wave Line Overlay */}
            <path
              d="M 20 60 Q 55 50 80 40 T 130 28 T 180 20"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2"
              filter="url(#cyanGlow)"
            />

            {/* Moving Laser Scan Line Sweeping down the Chart */}
            <line x1="5" y1="50" x2="195" y2="50" stroke="#06b6d4" strokeWidth="1.5" opacity="0.85" className="animate-pulse" />

            {/* Target Acquisition Bracket when Signal Detected */}
            {isSignal && (
              <g className="animate-beacon-pulse">
                <rect x="95" y="20" width="45" height="40" rx="3" fill="none" stroke="#06b6d4" strokeWidth="2" strokeDasharray="6 3" />
                <text x="100" y="75" fill="#38bdf8" fontSize="8" fontFamily="monospace" fontWeight="bold">
                  {confidence}% CONF
                </text>
              </g>
            )}
          </g>
        </svg>
      </div>

      {/* 5. Live State Overlay Badge below the Robot */}
      <div className="absolute bottom-2 z-20 flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950/90 border border-slate-800 shadow-lg backdrop-blur-md">
        <span
          className={`w-2 h-2 rounded-full ${
            isSignal
              ? 'bg-amber-400 animate-ping'
              : isAnalyzing
              ? 'bg-cyan-400 animate-pulse'
              : 'bg-emerald-400'
          }`}
        />
        <span className="text-[10px] font-mono tracking-wider font-bold text-slate-300 uppercase">
          {state.replace('_', ' ')}
        </span>
        <span className="text-slate-600 font-mono text-[9px]">•</span>
        <span className="text-[10px] font-mono font-semibold text-cyan-400">{currentMarket}</span>
      </div>
    </div>
  );
};
