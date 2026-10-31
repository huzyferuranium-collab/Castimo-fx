import React, { useId } from 'react';

/** Structure diagram of the three referral levels (illustration only; the 5/3/2 rates are the real ones). */
export const ReferralTree: React.FC<{ className?: string }> = ({ className = '' }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const rootX = 300;
  const L1 = [210, 300, 390];
  const L2 = L1.flatMap((x) => [x - 28, x + 28]);
  const L3 = L2.flatMap((x) => [x - 12, x + 12]);
  const Y = { root: 34, l1: 104, l2: 178, l3: 250 };
  const link = (x1: number, y1: number, x2: number, y2: number, c: string, w = 1.6) => (
    <path key={`${x1}-${y1}-${x2}-${y2}`} d={`M${x1} ${y1} C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`} stroke={c} strokeWidth={w} fill="none" strokeOpacity=".65" />
  );
  const rows = [
    { y: Y.l1, label: 'LEVEL 1', pct: '5%', c: '#f43f5e' },
    { y: Y.l2, label: 'LEVEL 2', pct: '3%', c: '#a855f7' },
    { y: Y.l3, label: 'LEVEL 3', pct: '2%', c: '#4d6bff' },
  ];
  return (
    <svg aria-hidden viewBox="0 0 460 290" className={className}>
      <defs>
        <radialGradient id={`${id}root`} cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#fff2c4" /><stop offset=".45" stopColor="#e4c35e" /><stop offset="1" stopColor="#8a6a12" /></radialGradient>
        <radialGradient id={`${id}r`} cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#ffd0d8" /><stop offset=".5" stopColor="#f43f5e" /><stop offset="1" stopColor="#8a1236" /></radialGradient>
        <radialGradient id={`${id}v`} cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#ecd5ff" /><stop offset=".5" stopColor="#a855f7" /><stop offset="1" stopColor="#4c1d95" /></radialGradient>
        <radialGradient id={`${id}b`} cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#cfe0ff" /><stop offset=".5" stopColor="#4d6bff" /><stop offset="1" stopColor="#1b2a8a" /></radialGradient>
      </defs>
      {L1.map((x) => link(rootX, Y.root + 14, x, Y.l1 - 14, '#f43f5e', 2))}
      {L1.flatMap((x, i) => [L2[i * 2], L2[i * 2 + 1]].map((x2) => link(x, Y.l1 + 14, x2, Y.l2 - 10, '#a855f7')))}
      {L2.flatMap((x, i) => [L3[i * 2], L3[i * 2 + 1]].map((x2) => link(x, Y.l2 + 10, x2, Y.l3 - 7, '#4d6bff', 1.2)))}
      <circle cx={rootX} cy={Y.root} r="22" fill={`url(#${id}root)`} />
      <path d={`M${rootX - 10} ${Y.root + 6} L${rootX - 3} ${Y.root - 2} L${rootX + 3} ${Y.root + 3} L${rootX + 12} ${Y.root - 7}`} fill="none" stroke="#fff" strokeOpacity=".9" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      {L1.map((x) => <circle key={x} cx={x} cy={Y.l1} r="15" fill={`url(#${id}r)`} />)}
      {L2.map((x) => <circle key={x} cx={x} cy={Y.l2} r="10" fill={`url(#${id}v)`} />)}
      {L3.map((x) => <circle key={x} cx={x} cy={Y.l3} r="6.5" fill={`url(#${id}b)`} />)}
      {rows.map((r) => (
        <g key={`t${r.label}`}>
          <text x="2" y={r.y - 4} fontSize="9.5" fontWeight="700" fill={r.c} letterSpacing="1.6">{r.label}</text>
          <text x="2" y={r.y + 20} fontSize="22" fontWeight="800" fill={r.c}>{r.pct}</text>
        </g>
      ))}
    </svg>
  );
};
