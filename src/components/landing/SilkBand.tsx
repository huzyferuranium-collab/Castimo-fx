import React, { useId } from 'react';

/** Soft flowing ribbons in the brand colours, used behind the closing call to action. */
export const SilkBand: React.FC<{ className?: string }> = ({ className = '' }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg aria-hidden viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" className={className}>
      <defs>
        <linearGradient id={`${id}a`} x1="0" x2="1"><stop offset="0" stopColor="#2f4bdb" /><stop offset=".5" stopColor="#7c3aed" /><stop offset="1" stopColor="#f43f5e" /></linearGradient>
        <linearGradient id={`${id}b`} x1="0" x2="1"><stop offset="0" stopColor="#22d3ee" /><stop offset=".5" stopColor="#4d6bff" /><stop offset="1" stopColor="#a855f7" /></linearGradient>
        <linearGradient id={`${id}c`} x1="0" x2="1"><stop offset="0" stopColor="#f1dd9a" stopOpacity="0" /><stop offset=".5" stopColor="#fff3c4" /><stop offset="1" stopColor="#f1dd9a" stopOpacity="0" /></linearGradient>
        <filter id={`${id}blur`} x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="16" /></filter>
      </defs>
      <g className="animate-silk">
        <g filter={`url(#${id}blur)`} opacity=".95" fill="none" strokeLinecap="round">
          <path d="M-60 300 C200 120 420 380 700 220 S1100 60 1280 180" stroke={`url(#${id}a)`} strokeWidth="92" />
          <path d="M-60 360 C240 240 460 420 760 300 S1120 200 1280 280" stroke={`url(#${id}b)`} strokeWidth="64" opacity=".85" />
        </g>
        <g fill="none" strokeLinecap="round">
          <path d="M-60 300 C200 120 420 380 700 220 S1100 60 1280 180" stroke="#fff" strokeOpacity=".5" strokeWidth="1.4" transform="translate(0 -30)" />
          <path d="M-60 360 C240 240 460 420 760 300 S1120 200 1280 280" stroke="#fff" strokeOpacity=".4" strokeWidth="1.2" transform="translate(0 -22)" />
          <path d="M-60 330 C220 190 440 410 730 262 S1110 130 1280 232" stroke={`url(#${id}c)`} strokeWidth="1.6" />
        </g>
      </g>
    </svg>
  );
};
