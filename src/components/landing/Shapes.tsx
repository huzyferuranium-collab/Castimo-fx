import React, { useId } from 'react';

/** Decorative 3D-style shapes drawn in SVG with gradients: glossy, light, and crisp at any size. */

const useUid = () => useId().replace(/[^a-zA-Z0-9]/g, '');

export const Orb: React.FC<{ size?: number; from?: string; mid?: string; to?: string; className?: string }> = ({
  size = 90,
  from = '#bcd0ff',
  mid = '#4d6bff',
  to = '#1b2a8a',
  className = '',
}) => {
  const id = useUid();
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 100 100" className={className}>
      <defs>
        <radialGradient id={`${id}g`} cx="34%" cy="28%" r="78%">
          <stop offset="0" stopColor={from} />
          <stop offset=".42" stopColor={mid} />
          <stop offset="1" stopColor={to} />
        </radialGradient>
        <radialGradient id={`${id}s`}>
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill={`url(#${id}g)`} />
      <ellipse cx="37" cy="27" rx="17" ry="9" fill={`url(#${id}s)`} transform="rotate(-32 37 27)" />
      <circle cx="50" cy="50" r="43.5" fill="none" stroke="#fff" strokeOpacity=".18" />
    </svg>
  );
};

export const Cube: React.FC<{ size?: number; top?: string; left?: string; right?: string; className?: string }> = ({
  size = 96,
  top = '#e7b8ff',
  left = '#8b5cf6',
  right = '#4c1d95',
  className = '',
}) => {
  const id = useUid();
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 100 100" className={className}>
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset="1" stopColor={top} /></linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={left} /><stop offset="1" stopColor={right} /></linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={right} /><stop offset="1" stopColor="#0b0b2e" /></linearGradient>
      </defs>
      <polygon points="50,8 90,28 50,48 10,28" fill={`url(#${id}t)`} />
      <polygon points="10,28 50,48 50,92 10,72" fill={`url(#${id}l)`} />
      <polygon points="50,48 90,28 90,72 50,92" fill={`url(#${id}r)`} />
      <polyline points="10,28 50,48 90,28" fill="none" stroke="#fff" strokeOpacity=".5" />
      <line x1="50" y1="48" x2="50" y2="92" stroke="#fff" strokeOpacity=".22" />
    </svg>
  );
};

export const Ring: React.FC<{ size?: number; className?: string; a?: string; b?: string }> = ({
  size = 120,
  className = '',
  a = '#22d3ee',
  b = '#6366f1',
}) => {
  const id = useUid();
  return (
    <svg aria-hidden width={size} height={size * 0.62} viewBox="0 0 120 74" className={className}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" x2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
      </defs>
      <ellipse cx="60" cy="37" rx="50" ry="22" fill="none" stroke={`url(#${id}g)`} strokeWidth="11" transform="rotate(-18 60 37)" />
      <ellipse cx="60" cy="37" rx="50" ry="22" fill="none" stroke="#fff" strokeOpacity=".4" strokeWidth="1.5" transform="translate(0 -3.5) rotate(-18 60 37)" />
    </svg>
  );
};

export const Coin: React.FC<{ size?: number; className?: string }> = ({ size = 64, className = '' }) => {
  const id = useUid();
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 100 100" className={className}>
      <defs>
        <radialGradient id={`${id}g`} cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#fff6cf" /><stop offset=".4" stopColor="#e4c35e" /><stop offset="1" stopColor="#8a6a12" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill={`url(#${id}g)`} />
      <circle cx="50" cy="50" r="33" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2" />
      <circle cx="50" cy="50" r="33" fill="none" stroke="#7a5c0a" strokeOpacity=".35" strokeWidth="1" transform="translate(1 1)" />
      <path d="M30 62 L42 46 L52 54 L70 34" fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};
