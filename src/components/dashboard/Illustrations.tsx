import React, { useId } from 'react';

/**
 * Original SVG artwork for the client dashboard: one distinct piece per section, drawn from the
 * brand palette. Everything here is decorative (aria-hidden) and carries NO data: figures and
 * charts live elsewhere and are always computed from the account's real numbers.
 */

const useUid = () => useId().replace(/[^a-zA-Z0-9]/g, '');

type ArtProps = { size?: number; className?: string };

const Stops: React.FC<{ id: string; stops: Array<[number, string, number?]>; x2?: number; y2?: number; radial?: boolean; cx?: string; cy?: string; r?: string }> = ({
  id, stops, x2 = 1, y2 = 1, radial, cx = '35%', cy = '30%', r = '80%',
}) =>
  radial ? (
    <radialGradient id={id} cx={cx} cy={cy} r={r}>
      {stops.map(([o, c, a]) => <stop key={o} offset={o} stopColor={c} stopOpacity={a ?? 1} />)}
    </radialGradient>
  ) : (
    <linearGradient id={id} x1="0" y1="0" x2={x2} y2={y2}>
      {stops.map(([o, c, a]) => <stop key={o} offset={o} stopColor={c} stopOpacity={a ?? 1} />)}
    </linearGradient>
  );

/* ---------------------------------------------------------------- wallet: champagne-gold coin stack + electric-blue orb */
export const CoinStackArt: React.FC<ArtProps> = ({ size = 120, className = '' }) => {
  const u = useUid();
  const coin = (cy: number) => (
    <g key={cy}>
      <path d={`M26 ${cy} v9 a34 11 0 0 0 68 0 v-9 z`} fill={`url(#${u}s)`} />
      <ellipse cx="60" cy={cy} rx="34" ry="11" fill={`url(#${u}t)`} />
      <ellipse cx="60" cy={cy} rx="24" ry="6.6" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.4" />
      <ellipse cx="60" cy={cy + 1.2} rx="24" ry="6.6" fill="none" stroke="#8a6a12" strokeOpacity=".25" strokeWidth="1" />
    </g>
  );
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 120 120" className={`art ${className}`}>
      <defs>
        <Stops id={`${u}s`} x2={1} y2={0} stops={[[0, '#a77a1c'], [0.45, '#f6dfa6'], [1, '#a77a1c']]} />
        <Stops id={`${u}t`} stops={[[0, '#fff6d6'], [1, '#e9be62']]} />
        <Stops id={`${u}o`} radial stops={[[0, '#bfe6ff'], [0.45, '#176bff'], [1, '#1746d2']]} />
        <radialGradient id={`${u}h`}><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx="88" cy="36" r="22" fill={`url(#${u}o)`} />
      <ellipse cx="80" cy="27" rx="9" ry="5" fill={`url(#${u}h)`} transform="rotate(-30 80 27)" />
      {[96, 82, 68, 54].map(coin)}
      <path d="M30 20 l2.2 5.6 5.6 2.2 -5.6 2.2 -2.2 5.6 -2.2 -5.6 -5.6 -2.2 5.6 -2.2z" fill="#fff" fillOpacity=".95" />
    </svg>
  );
};

/* ---------------------------------------------------------------- equity: faceted violet-magenta gem */
export const GemArt: React.FC<ArtProps> = ({ size = 120, className = '' }) => {
  const u = useUid();
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 120 120" className={`art ${className}`}>
      <defs>
        <Stops id={`${u}a`} stops={[[0, '#fbe3ff'], [1, '#e83eff']]} />
        <Stops id={`${u}b`} stops={[[0, '#c39bff'], [1, '#853bff']]} />
        <Stops id={`${u}c`} stops={[[0, '#7a37f0'], [1, '#4a1ab3']]} />
        <Stops id={`${u}d`} stops={[[0, '#e83eff'], [1, '#853bff']]} />
        <Stops id={`${u}e`} stops={[[0, '#9a52ff'], [1, '#5a22c8']]} />
        <Stops id={`${u}f`} stops={[[0, '#6c2ed8'], [1, '#2e0f85']]} />
      </defs>
      <polygon points="38,30 82,30 74,52 46,52" fill={`url(#${u}a)`} />
      <polygon points="38,30 46,52 22,52" fill={`url(#${u}b)`} />
      <polygon points="82,30 98,52 74,52" fill={`url(#${u}c)`} />
      <polygon points="22,52 46,52 60,100" fill={`url(#${u}e)`} />
      <polygon points="46,52 74,52 60,100" fill={`url(#${u}d)`} />
      <polygon points="74,52 98,52 60,100" fill={`url(#${u}f)`} />
      <polyline points="22,52 38,30 82,30 98,52 60,100 22,52" fill="none" stroke="#fff" strokeOpacity=".55" strokeLinejoin="round" />
      <line x1="46" y1="52" x2="74" y2="52" stroke="#fff" strokeOpacity=".45" />
      <path d="M96 14 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#06d6e9" />
      <circle cx="18" cy="30" r="3" fill="#fff" fillOpacity=".8" />
    </svg>
  );
};

/* ---------------------------------------------------------------- free margin: turquoise shield */
export const ShieldArt: React.FC<ArtProps> = ({ size = 120, className = '' }) => {
  const u = useUid();
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 120 120" className={`art ${className}`}>
      <defs>
        <Stops id={`${u}a`} stops={[[0, '#7af0e2'], [0.5, '#08c9b5'], [1, '#176bff']]} />
        <Stops id={`${u}b`} stops={[[0, '#d9fffb'], [1, '#38bdf8']]} />
        <Stops id={`${u}c`} x2={1} y2={0} stops={[[0, '#e9be62'], [1, '#f6dfa6']]} />
      </defs>
      <ellipse cx="60" cy="62" rx="52" ry="16" fill="none" stroke={`url(#${u}c)`} strokeWidth="3.5" transform="rotate(-18 60 62)" opacity=".9" />
      <path d="M60 10 L100 24 V56 C100 82 82 101 60 110 C38 101 20 82 20 56 V24 Z" fill={`url(#${u}a)`} />
      <path d="M60 19 L92 30 V56 C92 77 78 92 60 100 C42 92 28 77 28 56 V30 Z" fill={`url(#${u}b)`} fillOpacity=".38" />
      <path d="M60 10 L100 24 V40 C84 34 70 30 60 30 C50 30 36 34 20 40 V24 Z" fill="#fff" fillOpacity=".28" />
      <path d="M42 58 l13 13 l25 -27" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="104" cy="92" r="5" fill="#e9be62" />
    </svg>
  );
};

/* ---------------------------------------------------------------- floating P/L: glowing orb with two orbits */
export const OrbitArt: React.FC<ArtProps> = ({ size = 120, className = '' }) => {
  const u = useUid();
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 120 120" className={`art ${className}`}>
      <defs>
        <Stops id={`${u}o`} radial stops={[[0, '#d8fbff'], [0.4, '#06d6e9'], [1, '#176bff']]} />
        <Stops id={`${u}r`} x2={1} y2={0} stops={[[0, '#38bdf8'], [1, '#853bff']]} />
        <Stops id={`${u}q`} x2={1} y2={0} stops={[[0, '#f52236'], [1, '#e83eff']]} />
      </defs>
      <ellipse cx="60" cy="60" rx="54" ry="19" fill="none" stroke={`url(#${u}r)`} strokeWidth="5" transform="rotate(24 60 60)" opacity=".9" />
      <circle cx="60" cy="60" r="24" fill={`url(#${u}o)`} />
      <ellipse cx="52" cy="50" rx="9" ry="5" fill="#fff" fillOpacity=".75" transform="rotate(-30 52 50)" />
      <ellipse cx="60" cy="60" rx="54" ry="19" fill="none" stroke={`url(#${u}q)`} strokeWidth="5" strokeDasharray="60 400" strokeDashoffset="-150" strokeLinecap="round" transform="rotate(24 60 60) scale(1 1)" />
      <circle cx="106" cy="78" r="6" fill="#e9be62" />
      <circle cx="16" cy="40" r="3.5" fill="#fff" fillOpacity=".85" />
    </svg>
  );
};

/* ---------------------------------------------------------------- copy trading: friendly AI robot */
export const RobotArt: React.FC<ArtProps> = ({ size = 120, className = '' }) => {
  const u = useUid();
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 120 120" className={`art ${className}`}>
      <defs>
        <Stops id={`${u}h`} stops={[[0, '#4d8dff'], [0.55, '#176bff'], [1, '#853bff']]} />
        <Stops id={`${u}b`} stops={[[0, '#853bff'], [1, '#e83eff']]} />
        <Stops id={`${u}v`} stops={[[0, '#0c1448'], [1, '#050a2a']]} />
        <Stops id={`${u}e`} stops={[[0, '#ff7a86'], [1, '#f52236']]} />
        <radialGradient id={`${u}k`}><stop offset="0" stopColor="#ffd0d5" /><stop offset=".5" stopColor="#f52236" /><stop offset="1" stopColor="#a00a1f" /></radialGradient>
        <filter id={`${u}g`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.6" /></filter>
      </defs>
      <line x1="60" y1="14" x2="60" y2="26" stroke="#cfd8ff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="10" r="6" fill={`url(#${u}k)`} />
      <rect x="11" y="50" width="12" height="26" rx="6" fill={`url(#${u}e)`} />
      <rect x="97" y="50" width="12" height="26" rx="6" fill={`url(#${u}e)`} />
      <path d="M32 94 Q60 84 88 94 V106 Q60 116 32 106 Z" fill={`url(#${u}b)`} />
      <rect x="20" y="25" width="80" height="64" rx="26" fill={`url(#${u}h)`} />
      <ellipse cx="46" cy="33" rx="22" ry="7" fill="#fff" fillOpacity=".3" transform="rotate(-8 46 33)" />
      <rect x="30" y="40" width="60" height="34" rx="17" fill={`url(#${u}v)`} />
      <g filter={`url(#${u}g)`} opacity=".9"><circle cx="47" cy="56" r="6" fill="#06d6e9" /><circle cx="73" cy="56" r="6" fill="#06d6e9" /></g>
      <circle cx="47" cy="56" r="5" fill="#06d6e9" /><circle cx="73" cy="56" r="5" fill="#06d6e9" />
      <circle cx="45" cy="54" r="1.6" fill="#fff" /><circle cx="71" cy="54" r="1.6" fill="#fff" />
      <path d="M53 66 Q60 71 67 66" fill="none" stroke="#06d6e9" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
};

/* ---------------------------------------------------------------- active trades: sweeping radar */
export const RadarArt: React.FC<ArtProps> = ({ size = 120, className = '' }) => {
  const u = useUid();
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 120 120" className={`art ${className}`}>
      <defs>
        <Stops id={`${u}r`} x2={1} y2={1} stops={[[0, '#06d6e9'], [1, '#176bff']]} />
        <Stops id={`${u}w`} x2={1} y2={1} stops={[[0, '#06d6e9', 0], [1, '#06d6e9', 0.75]]} />
        <radialGradient id={`${u}f`}><stop offset="0" stopColor="#176bff" stopOpacity=".38" /><stop offset="1" stopColor="#06d6e9" stopOpacity=".06" /></radialGradient>
      </defs>
      <circle cx="60" cy="60" r="48" fill={`url(#${u}f)`} />
      <circle cx="60" cy="60" r="48" fill="none" stroke={`url(#${u}r)`} strokeWidth="3.5" />
      <circle cx="60" cy="60" r="32" fill="none" stroke={`url(#${u}r)`} strokeWidth="2" strokeOpacity=".6" />
      <circle cx="60" cy="60" r="16" fill="none" stroke={`url(#${u}r)`} strokeWidth="2" strokeOpacity=".45" />
      <g className="animate-spin-slow" style={{ transformOrigin: '60px 60px', animationDuration: '7s' }}>
        <path d="M60 60 L60 12 A48 48 0 0 1 100 34 Z" fill={`url(#${u}w)`} />
        <line x1="60" y1="60" x2="60" y2="12" stroke="#d8fbff" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      <circle cx="60" cy="60" r="6" fill="#fff" />
      <circle cx="60" cy="60" r="3" fill="#176bff" />
    </svg>
  );
};

/* ---------------------------------------------------------------- history: glossy clock with crimson sweep */
export const ClockArt: React.FC<ArtProps> = ({ size = 120, className = '' }) => {
  const u = useUid();
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 120 120" className={`art ${className}`}>
      <defs>
        <Stops id={`${u}r`} stops={[[0, '#38bdf8'], [0.5, '#176bff'], [1, '#853bff']]} />
        <Stops id={`${u}f`} radial cx="40%" cy="32%" r="80%" stops={[[0, '#ffffff'], [1, '#cfe0ff']]} />
        <Stops id={`${u}s`} x2={1} y2={0} stops={[[0, '#f52236'], [1, '#e83eff']]} />
      </defs>
      <circle cx="60" cy="60" r="46" fill={`url(#${u}r)`} />
      <circle cx="60" cy="60" r="37" fill={`url(#${u}f)`} />
      <path d="M60 28 A32 32 0 0 1 88 76" fill="none" stroke={`url(#${u}s)`} strokeWidth="5" strokeLinecap="round" />
      {[[60, 31], [89, 60], [60, 89], [31, 60]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.4" fill="#1746d2" fillOpacity=".7" />)}
      <line x1="60" y1="60" x2="60" y2="40" stroke="#0b1553" strokeWidth="4.4" strokeLinecap="round" />
      <line x1="60" y1="60" x2="76" y2="68" stroke="#0b1553" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="60" cy="60" r="5" fill="#f52236" />
      <ellipse cx="44" cy="26" rx="14" ry="5" fill="#fff" fillOpacity=".4" transform="rotate(-28 44 26)" />
    </svg>
  );
};

/* ---------------------------------------------------------------- referrals: three-level network */
export const NetworkArt: React.FC<ArtProps> = ({ size = 120, className = '' }) => {
  const u = useUid();
  const orb = (id: string, c: string[]) => (
    <radialGradient id={`${u}${id}`} cx="35%" cy="30%" r="80%">
      <stop offset="0" stopColor={c[0]} /><stop offset=".5" stopColor={c[1]} /><stop offset="1" stopColor={c[2]} />
    </radialGradient>
  );
  const lines: Array<[number, number, number, number]> = [
    [60, 22, 28, 62], [60, 22, 60, 66], [60, 22, 92, 62],
    [28, 62, 14, 100], [28, 62, 40, 102], [60, 66, 50, 104], [60, 66, 72, 104], [92, 62, 82, 102], [92, 62, 106, 100],
  ];
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 120 120" className={`art ${className}`}>
      <defs>
        {orb('a', ['#ffd0d5', '#f52236', '#a00a1f'])}
        {orb('b', ['#ffd3ff', '#e83eff', '#8a14b0'])}
        {orb('c', ['#d9c7ff', '#853bff', '#4a1ab3'])}
        {orb('d', ['#d4f1ff', '#38bdf8', '#176bff'])}
        {orb('e', ['#d8fbff', '#06d6e9', '#0a7f8c'])}
      </defs>
      <g stroke="#9aa8ff" strokeOpacity=".55" strokeWidth="2.4" strokeLinecap="round">
        {lines.map(([a, b, c, d]) => <line key={`${a}${b}${c}${d}`} x1={a} y1={b} x2={c} y2={d} />)}
      </g>
      <circle cx="60" cy="22" r="14" fill={`url(#${u}a)`} />
      <ellipse cx="55" cy="17" rx="5" ry="3" fill="#fff" fillOpacity=".7" transform="rotate(-30 55 17)" />
      <circle cx="28" cy="62" r="10" fill={`url(#${u}b)`} />
      <circle cx="60" cy="66" r="10" fill={`url(#${u}c)`} />
      <circle cx="92" cy="62" r="10" fill={`url(#${u}d)`} />
      {[[14, 100], [40, 102], [50, 104], [72, 104], [82, 102], [106, 100]].map(([x, y], i) => <circle key={`${x}${y}`} cx={x} cy={y} r="6" fill={`url(#${u}${i % 2 ? 'e' : 'd'})`} />)}
    </svg>
  );
};

/* ---------------------------------------------------------------- profile: tilted ID card with verified tick */
export const BadgeArt: React.FC<ArtProps> = ({ size = 120, className = '' }) => {
  const u = useUid();
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 120 120" className={`art ${className}`}>
      <defs>
        <Stops id={`${u}c`} stops={[[0, '#e83eff'], [0.55, '#853bff'], [1, '#176bff']]} />
        <Stops id={`${u}v`} stops={[[0, '#7af0e2'], [1, '#08c9b5']]} />
      </defs>
      <g transform="rotate(-9 60 60)">
        <rect x="14" y="28" width="92" height="64" rx="15" fill={`url(#${u}c)`} />
        <path d="M14 43 a15 15 0 0 1 15 -15 h62 a15 15 0 0 1 15 15 v6 c-30 -14 -62 -14 -92 0z" fill="#fff" fillOpacity=".22" />
        <circle cx="40" cy="58" r="11" fill="#fff" fillOpacity=".95" />
        <path d="M22 84 a18 13 0 0 1 36 0z" fill="#fff" fillOpacity=".95" />
        <rect x="64" y="50" width="30" height="6" rx="3" fill="#fff" fillOpacity=".9" />
        <rect x="64" y="62" width="22" height="6" rx="3" fill="#fff" fillOpacity=".6" />
        <rect x="64" y="74" width="12" height="9" rx="2.5" fill="#e9be62" />
      </g>
      <circle cx="94" cy="90" r="14" fill={`url(#${u}v)`} />
      <path d="M87 90 l5 5 l9 -10" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

/* ---------------------------------------------------------------- plan: gold rosette medal with ribbons */
export const MedalArt: React.FC<ArtProps> = ({ size = 120, className = '' }) => {
  const u = useUid();
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 120 120" className={`art ${className}`}>
      <defs>
        <Stops id={`${u}a`} radial stops={[[0, '#fff6d6'], [0.45, '#e9be62'], [1, '#9c7416']]} />
        <Stops id={`${u}b`} stops={[[0, '#ff6b7a'], [1, '#f52236']]} />
        <Stops id={`${u}c`} stops={[[0, '#4d8dff'], [1, '#1746d2']]} />
      </defs>
      <path d="M34 62 L22 108 L40 98 L52 112 L58 70 Z" fill={`url(#${u}b)`} />
      <path d="M86 62 L98 108 L80 98 L68 112 L62 70 Z" fill={`url(#${u}c)`} />
      <circle cx="60" cy="46" r="36" fill={`url(#${u}a)`} />
      <circle cx="60" cy="46" r="27" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="2.4" />
      <circle cx="60" cy="46" r="27" fill="none" stroke="#7a5c0a" strokeOpacity=".3" strokeWidth="1" transform="translate(1 1.4)" />
      <path d="M60 28 l5.4 11.2 12.2 1.6 -9 8.4 2.4 12.2 -11 -6 -11 6 2.4 -12.2 -9 -8.4 12.2 -1.6z" fill="#fff" fillOpacity=".95" />
      <ellipse cx="46" cy="26" rx="12" ry="5" fill="#fff" fillOpacity=".45" transform="rotate(-30 46 26)" />
    </svg>
  );
};

/* ---------------------------------------------------------------- registry used by section banners and action cards */
export const ART = {
  coins: CoinStackArt,
  gem: GemArt,
  shield: ShieldArt,
  orbit: OrbitArt,
  robot: RobotArt,
  radar: RadarArt,
  clock: ClockArt,
  network: NetworkArt,
  badge: BadgeArt,
  medal: MedalArt,
} as const;
export type ArtName = keyof typeof ART;
