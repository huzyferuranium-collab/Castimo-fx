import React, { useId } from 'react';

/**
 * Illustration of the three referral levels: you at the centre, the people you invite around you,
 * and the people they invite further out. The 5% / 3% / 2% rates are the real ones; the number of
 * people drawn is only for the picture. Drawn once, with no figures of earnings.
 */
const C = 245; // centre of the drawing
const R = { l1: 92, l2: 158, l3: 218 };
const SIZE = { l0: 34, l1: 17, l2: 11.5, l3: 7 };
const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (r: number, deg: number) => ({ x: C + r * Math.cos(rad(deg)), y: C + r * Math.sin(rad(deg)) });

type Tone = 'gold' | 'rose' | 'violet' | 'blue';

// Level 1: five people spread round you, leaving the top free for the labels.
const L1 = [-54, 18, 90, 162, 234].map((a) => ({ a }));
const L2 = L1.flatMap((p) => [p.a - 15, p.a + 15].map((a) => ({ a, parent: p.a })));
const L3 = L2.flatMap((p) => [p.a - 6.5, p.a + 6.5].map((a) => ({ a, parent: p.a })));

export const ReferralTree: React.FC<{ className?: string }> = ({ className = '' }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const g = (t: string) => `url(#${id}${t})`;

  /** Smooth outward curve from a parent ring to a child ring. */
  const link = (rp: number, ap: number, rc: number, ac: number) => {
    const p0 = polar(rp, ap);
    const p3 = polar(rc, ac);
    const mid = rp + (rc - rp) * 0.5;
    const p1 = polar(mid, ap);
    const p2 = polar(mid, ac);
    return `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)} C${p1.x.toFixed(1)} ${p1.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} ${p3.x.toFixed(1)} ${p3.y.toFixed(1)}`;
  };

  /** A person: glossy sphere with a head-and-shoulders mark. */
  const person = (key: string, cx: number, cy: number, r: number, tone: Tone, mark: boolean) => {
    const ink = tone === 'gold' ? '#5a3d00' : '#ffffff';
    return (
      <g key={key}>
        <circle cx={cx + r * 0.08} cy={cy + r * 0.3} r={r} fill="#000" opacity=".14" />
        <circle cx={cx} cy={cy} r={r} fill={g(tone)} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#fff" strokeOpacity={r > 10 ? '.75' : '.55'} strokeWidth={r > 10 ? 1.6 : 1} />
        {mark && (
          <>
            <circle cx={cx} cy={cy - r * 0.22} r={r * 0.27} fill={ink} fillOpacity=".95" />
            <path
              d={`M${cx - r * 0.5} ${cy + r * 0.56} a${r * 0.5} ${r * 0.44} 0 0 1 ${r} 0 Z`}
              fill={ink}
              fillOpacity=".95"
            />
          </>
        )}
        <ellipse cx={cx - r * 0.3} cy={cy - r * 0.5} rx={r * 0.42} ry={r * 0.2} fill="#fff" opacity=".35" transform={`rotate(-28 ${cx - r * 0.3} ${cy - r * 0.5})`} />
      </g>
    );
  };

  const pill = (label: string, pct: string, y: number, tone: 'rose' | 'violet' | 'blue') => (
    <g key={label}>
      <rect x={C - 31} y={y - 19} width="62" height="40" rx="14" fill="#000" opacity=".12" transform="translate(0 2.5)" />
      <rect x={C - 31} y={y - 20} width="62" height="40" rx="14" fill={g(`p${tone}`)} />
      <rect x={C - 31} y={y - 20} width="62" height="40" rx="14" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.2" />
      <text x={C} y={y - 7} textAnchor="middle" fontSize="9.5" fontWeight="700" letterSpacing="1.6" fill="#fff" fillOpacity=".92">{label}</text>
      <text x={C} y={y + 13} textAnchor="middle" fontSize="19" fontWeight="800" fill="#fff">{pct}</text>
    </g>
  );

  // coins travelling in towards you, one on each of your direct links
  const coin = (a: number) => {
    const { x, y } = polar(55, a);
    return (
      <g key={`coin${a}`}>
        <circle cx={x} cy={y} r="7" fill={g('coin')} stroke="#fff" strokeOpacity=".85" strokeWidth="1.2" />
        <circle cx={x} cy={y} r="3.6" fill="none" stroke="#8a6a12" strokeOpacity=".55" strokeWidth="1" />
      </g>
    );
  };

  return (
    <svg
      role="img"
      aria-label="Referral network: you at the centre. People you invite pay you 5%, the people they invite pay 3%, and the next level pays 2%, on verified payments."
      viewBox="0 0 490 490"
      className={className}
    >
      <defs>
        {/* spheres */}
        <radialGradient id={`${id}gold`} cx="35%" cy="28%" r="85%"><stop offset="0" stopColor="#fff3c9" /><stop offset=".45" stopColor="#e9b82e" /><stop offset="1" stopColor="#8a6a12" /></radialGradient>
        <radialGradient id={`${id}rose`} cx="35%" cy="28%" r="85%"><stop offset="0" stopColor="#ffb1bd" /><stop offset=".5" stopColor="#f43f5e" /><stop offset="1" stopColor="#8a1236" /></radialGradient>
        <radialGradient id={`${id}violet`} cx="35%" cy="28%" r="85%"><stop offset="0" stopColor="#ebd0ff" /><stop offset=".5" stopColor="#a855f7" /><stop offset="1" stopColor="#4c1d95" /></radialGradient>
        <radialGradient id={`${id}blue`} cx="35%" cy="28%" r="85%"><stop offset="0" stopColor="#c6d8ff" /><stop offset=".5" stopColor="#4d6bff" /><stop offset="1" stopColor="#1b2a8a" /></radialGradient>
        <radialGradient id={`${id}coin`} cx="35%" cy="28%" r="85%"><stop offset="0" stopColor="#fff6d6" /><stop offset=".55" stopColor="#f0c040" /><stop offset="1" stopColor="#b8860b" /></radialGradient>
        {/* label pills */}
        <linearGradient id={`${id}prose`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fb4a68" /><stop offset="1" stopColor="#b3122f" /></linearGradient>
        <linearGradient id={`${id}pviolet`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#b25cf8" /><stop offset="1" stopColor="#6a2bd0" /></linearGradient>
        <linearGradient id={`${id}pblue`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5f7dff" /><stop offset="1" stopColor="#2a3fc4" /></linearGradient>
        {/* soft glow behind you */}
        <radialGradient id={`${id}halo`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#f5c542" stopOpacity=".55" /><stop offset="1" stopColor="#f5c542" stopOpacity="0" /></radialGradient>
      </defs>

      {/* the three levels as soft discs, widest at the back */}
      <circle cx={C} cy={C} r="236" fill="#4d6bff" fillOpacity=".07" />
      <circle cx={C} cy={C} r="187" fill="#a855f7" fillOpacity=".09" />
      <circle cx={C} cy={C} r="124" fill="#f43f5e" fillOpacity=".11" />
      <circle cx={C} cy={C} r="74" fill={g('halo')} />

      {/* ring guides */}
      <circle cx={C} cy={C} r={R.l3} fill="none" stroke="#4d6bff" strokeOpacity=".4" strokeWidth="1.2" strokeDasharray="2 6" strokeLinecap="round" />
      <circle cx={C} cy={C} r={R.l2} fill="none" stroke="#a855f7" strokeOpacity=".45" strokeWidth="1.2" strokeDasharray="2 6" strokeLinecap="round" />
      <circle cx={C} cy={C} r={R.l1} fill="none" stroke="#f43f5e" strokeOpacity=".5" strokeWidth="1.2" strokeDasharray="2 6" strokeLinecap="round" />

      {/* links: drawn in from the centre outwards */}
      <g fill="none" strokeLinecap="round">
        {L1.map((n) => (
          <path key={`a${n.a}`} d={link(0, n.a, R.l1, n.a)} stroke="#f43f5e" strokeOpacity=".75" strokeWidth="2.4" pathLength={1} strokeDasharray="1" className="animate-draw" style={{ animationDelay: '.2s' }} />
        ))}
        {L2.map((n) => (
          <path key={`b${n.a}`} d={link(R.l1, n.parent, R.l2, n.a)} stroke="#a855f7" strokeOpacity=".65" strokeWidth="1.9" pathLength={1} strokeDasharray="1" className="animate-draw" style={{ animationDelay: '.7s' }} />
        ))}
        {L3.map((n) => (
          <path key={`c${n.a}`} d={link(R.l2, n.parent, R.l3, n.a)} stroke="#4d6bff" strokeOpacity=".6" strokeWidth="1.4" pathLength={1} strokeDasharray="1" className="animate-draw" style={{ animationDelay: '1.2s' }} />
        ))}
      </g>

      {/* people, outermost first so the inner ones sit on top */}
      {L3.map((n) => { const p = polar(R.l3, n.a); return person(`n3${n.a}`, p.x, p.y, SIZE.l3, 'blue', false); })}
      {L2.map((n) => { const p = polar(R.l2, n.a); return person(`n2${n.a}`, p.x, p.y, SIZE.l2, 'violet', true); })}
      {L1.map((n) => { const p = polar(R.l1, n.a); return person(`n1${n.a}`, p.x, p.y, SIZE.l1, 'rose', true); })}

      {/* commission coins on your direct links */}
      {L1.map((n) => coin(n.a))}

      {/* you */}
      {person('you', C, C, SIZE.l0, 'gold', true)}

      {/* level labels, on the free space at the top of each ring */}
      {pill('LEVEL 3', '2%', C - R.l3, 'blue')}
      {pill('LEVEL 2', '3%', C - R.l2, 'violet')}
      {pill('LEVEL 1', '5%', C - R.l1, 'rose')}
    </svg>
  );
};
