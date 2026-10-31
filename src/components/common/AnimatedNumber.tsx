import React, { useEffect, useRef, useState } from 'react';

/** Counts smoothly from the previous value to the current one. Shows the value straight away for reduced motion. */
export const AnimatedNumber: React.FC<{
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Show an explicit + for positive numbers. */
  signed?: boolean;
  duration?: number;
  className?: string;
}> = ({ value, decimals = 2, prefix = '', suffix = '', signed = false, duration = 900, className }) => {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);

  useEffect(() => {
    if (!Number.isFinite(value)) return;
    if (reduce) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = origin + (value - origin) * eased;
      setShown(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduce]);

  const n = Number.isFinite(shown) ? shown : 0;
  const text = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = n < 0 ? '-' : signed && n > 0 ? '+' : '';
  return (
    <span className={className}>
      {sign}
      {prefix}
      {text}
      {suffix}
    </span>
  );
};
